import { describe, expect, it, vi } from "vitest";
import { type AppDependencies, createApp } from "./app.js";

type TestAccount = NonNullable<
  Awaited<ReturnType<AppDependencies["accounts"]["findByAuthUserId"]>>
>;
type AppOverrides = Partial<Omit<AppDependencies, "accounts">> & {
  accounts?: Partial<AppDependencies["accounts"]>;
};

const userForToken = {
  uid: "auth-customer-a",
  firebase: { sign_in_second_factor: "phone" },
};

function makeApp(overrides: AppOverrides = {}) {
  const defaults: AppDependencies = {
    config: {
      nodeEnv: "test",
      databaseUrl: "postgres://test",
      firebaseProjectId: "demo-kobito-support",
      webOrigin: "http://localhost:5173",
      port: 3000,
      invoicePrefix: "KS",
    },
    verifier: { verifyIdToken: vi.fn(async () => userForToken) },
    accounts: {
      findByAuthUserId: vi.fn(async (uid: string) =>
        uid === userForToken.uid
          ? {
              authUserId: uid,
              role: "customer" as const,
              customerId: "customer-a",
            }
          : undefined,
      ),
      findCustomer: vi.fn(async () => ({
        id: "customer-a",
        shopName: "A store",
        contactName: "A user",
      })),
    },
    publicSettings: { getServiceName: vi.fn(async () => "コビトサポート") },
    logger: { info: vi.fn(), error: vi.fn() },
  };
  return createApp({
    ...defaults,
    ...overrides,
    accounts: { ...defaults.accounts, ...overrides.accounts },
  });
}

describe("API routes and auth pipeline", () => {
  it("serves health and only the settings-backed public service name", async () => {
    const app = makeApp();
    const health = await app.request("/healthz");
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });

    const config = await app.request("/api/v1/public/config");
    expect(config.status).toBe(200);
    expect(await config.json()).toEqual({ serviceName: "コビトサポート" });
  });

  it.each([
    undefined,
    "Basic abc",
    "Bearer ",
    "Bearer invalid",
  ])("rejects missing, malformed, and invalid bearer credentials (%s)", async (authorization) => {
    const app = makeApp({
      verifier: {
        verifyIdToken: vi.fn(async () => {
          throw new Error("private verifier detail");
        }),
      },
    });
    const response = await app.request("/api/v1/me", {
      ...(authorization ? { headers: { authorization } } : {}),
    });
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error: { code: "unauthorized" } });
    expect(JSON.stringify(body)).not.toContain("private verifier detail");
  });

  it("requires authentication for the entire /api/v1/me namespace", async () => {
    const response = await makeApp().request("/api/v1/me/future-resource");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "unauthorized" } });
  });

  it("loads only the authenticated customer and returns the minimal profile", async () => {
    const app = makeApp();
    const response = await app.request("/api/v1/me", {
      headers: { authorization: "Bearer good-token" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      customer: {
        id: "customer-a",
        shopName: "A store",
        contactName: "A user",
      },
    });
  });

  it("returns role-mismatch as not found and rejects an unscoped account", async () => {
    const app = makeApp({
      accounts: {
        findByAuthUserId: vi.fn(async () => ({
          authUserId: "admin",
          role: "admin" as const,
          customerId: null,
        })),
        findCustomer: vi.fn(),
      },
    });
    const response = await app.request("/api/v1/me", {
      headers: { authorization: "Bearer good-token" },
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "not_found" } });
  });

  it("rejects unknown UIDs and customer accounts without a database customer ID", async () => {
    for (const account of [
      undefined,
      {
        authUserId: "auth-customer-a",
        role: "customer" as const,
        customerId: null,
      },
    ]) {
      const app = makeApp({
        accounts: {
          findByAuthUserId: vi.fn(
            async (): Promise<TestAccount | undefined> => account,
          ),
        },
      });
      const response = await app.request("/api/v1/me", {
        headers: { authorization: "Bearer good-token" },
      });
      expect(response.status).toBe(401);
    }
  });

  it("applies exact configured CORS origin and logs only route templates", async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const app = makeApp({ logger });
    const response = await app.request(
      "/api/v1/public/config?secret=query-secret",
      {
        headers: {
          origin: "http://localhost:5173",
          "x-request-id": "user-value",
        },
      },
    );
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173",
    );
    const logged = JSON.stringify(logger.info.mock.calls);
    expect(logged).not.toContain("query-secret");
    expect(logged).not.toContain("user-value");
    expect(logged).not.toContain("/api/v1/public/config?");

    const hostileOrigin = await app.request("/api/v1/public/config", {
      headers: { origin: "https://attacker.example" },
    });
    expect(hostileOrigin.headers.get("access-control-allow-origin")).not.toBe(
      "https://attacker.example",
    );

    await app.request("/private/path?token=query-secret");
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(
      "/private/path",
    );
  });

  it("applies admin MFA gates on the real API namespace", async () => {
    const app = makeApp({
      verifier: { verifyIdToken: vi.fn(async () => ({ uid: "admin-uid" })) },
      accounts: {
        findByAuthUserId: vi.fn(async () => ({
          authUserId: "admin-uid",
          role: "admin" as const,
          customerId: null,
        })),
      },
    });
    const response = await app.request("/api/v1/admin/private-operation", {
      headers: { authorization: "Bearer valid" },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "forbidden" } });

    const customerApp = makeApp();
    const hidden = await customerApp.request(
      "/api/v1/admin/private-operation",
      { headers: { authorization: "Bearer good-token" } },
    );
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toEqual({ error: { code: "not_found" } });
  });

  it("returns generic 500 and never logs body, header, query, or DB error secrets", async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const app = makeApp({
      accounts: {
        findByAuthUserId: vi.fn(async () => {
          throw new Error(
            "DB password=pg-secret email=private@example.test token=db-token-secret",
          );
        }),
      },
      logger,
    });
    const response = await app.request("/api/v1/me?private=query-secret", {
      method: "POST",
      headers: {
        authorization: "Bearer bearer-secret",
        "x-private-header": "header-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ note: "body-secret" }),
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "internal_error" },
    });
    const logs = JSON.stringify({
      info: logger.info.mock.calls,
      error: logger.error.mock.calls,
    });
    for (const sentinel of [
      "pg-secret",
      "private@example.test",
      "db-token-secret",
      "query-secret",
      "bearer-secret",
      "header-secret",
      "body-secret",
    ]) {
      expect(logs).not.toContain(sentinel);
    }
  });
});
