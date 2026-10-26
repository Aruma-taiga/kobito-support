import { describe, expect, it, vi } from "vitest";
import { type AppDependencies, createApp } from "./app.js";

type TestAccount = NonNullable<
  Awaited<ReturnType<AppDependencies["accounts"]["findByAuthUserId"]>>
>;
type AppOverrides = Partial<
  Omit<AppDependencies, "accounts" | "applications" | "invoices">
> & {
  accounts?: Partial<AppDependencies["accounts"]>;
  applications?: Partial<AppDependencies["applications"]>;
  admin?: Partial<AppDependencies["admin"]>;
  invoices?: Partial<AppDependencies["invoices"]>;
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
    applications: {
      getPublicCatalog: vi.fn(async () => ({
        plans: [],
        displayVersion: "a".repeat(64),
        application: null,
      })),
      getPublicPartner: vi.fn(async (code: string) => ({
        code,
        name: "Referral partner",
      })),
      submit: vi.fn(async () => ({
        applicationId: "00000000-0000-4000-8000-000000000001",
        contractId: "00000000-0000-4000-8000-000000000002",
        status: "under_review" as const,
        replayed: false,
      })),
    },
    admin: {
      listApplications: vi.fn(async () => ({
        items: [],
        page: 1,
        pageSize: 25,
        total: 0,
      })),
      getCustomerDetail: vi.fn(async () => {
        throw new Error("not found in test admin detail");
      }),
      declineApplication: vi.fn(async () => ({
        applicationId: "00000000-0000-4000-8000-000000000001",
        contractId: "00000000-0000-4000-8000-000000000002",
        status: "declined" as const,
        replayed: false,
      })),
    },
    invoices: {
      getReadiness: vi.fn(async () => ({
        canIssue: false,
        mode: "unavailable" as const,
        reason: "issuer_not_configured" as const,
      })),
      approveApplication: vi.fn(async () => ({
        applicationId: "00000000-0000-4000-8000-000000000001",
        contractId: "00000000-0000-4000-8000-000000000002",
        status: "awaiting_payment" as const,
        invoice: null,
        replayed: false,
      })),
      listCustomer: vi.fn(async () => ({ invoices: [] })),
      getCustomer: vi.fn(async () => {
        throw new Error("not found");
      }),
      getCustomerPdf: vi.fn(async () => ({
        invoiceNo: "KS-2026-00001",
        content: Buffer.from("%PDF-1.7 test"),
      })),
      listAdmin: vi.fn(async () => ({ invoices: [] })),
      getAdmin: vi.fn(async () => {
        throw new Error("not found");
      }),
      getAdminPdf: vi.fn(async () => ({
        invoiceNo: "KS-2026-00001",
        content: Buffer.from("%PDF-1.7 test"),
      })),
    },
    publicSettings: { getServiceName: vi.fn(async () => "コビトサポート") },
    logger: { info: vi.fn(), error: vi.fn() },
  };
  return createApp({
    ...defaults,
    ...overrides,
    accounts: { ...defaults.accounts, ...overrides.accounts },
    applications: { ...defaults.applications, ...overrides.applications },
    admin: { ...defaults.admin, ...overrides.admin },
    invoices: { ...defaults.invoices, ...overrides.invoices },
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
    expect(await config.json()).toEqual({
      serviceName: "コビトサポート",
      application: null,
    });

    const plans = await app.request("/api/v1/public/plans");
    expect(plans.status).toBe(200);
    expect(await plans.json()).toEqual({
      plans: [],
      displayVersion: "a".repeat(64),
    });
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
    const preflight = await app.request("/api/v1/applications", {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "POST",
        "access-control-request-headers":
          "Authorization,Content-Type,Idempotency-Key",
      },
    });
    expect(preflight.headers.get("access-control-allow-headers")).toContain(
      "Idempotency-Key",
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

  it("exposes the admin session only to a database admin with a verified factor", async () => {
    const verifyIdToken = vi.fn(async () => ({
      uid: "admin-uid",
      firebase: { sign_in_second_factor: "phone" },
    }));
    const adminApp = makeApp({
      verifier: { verifyIdToken },
      accounts: {
        findByAuthUserId: vi.fn(async () => ({
          authUserId: "admin-uid",
          role: "admin" as const,
          customerId: null,
        })),
      },
    });

    const noToken = await adminApp.request("/api/v1/admin/session");
    expect(noToken.status).toBe(401);

    const session = await adminApp.request("/api/v1/admin/session", {
      headers: { authorization: "Bearer verified-admin" },
    });
    expect(session.status).toBe(200);
    expect(await session.json()).toEqual({ role: "admin" });
    expect(verifyIdToken).toHaveBeenCalledWith("verified-admin", true);
  });

  it.each([
    "auth/id-token-revoked",
    "auth/user-disabled",
  ])("checks revocation before exposing the admin namespace (%s)", async (providerCode) => {
    const findByAuthUserId = vi.fn();
    const verifyIdToken = vi.fn(
      async (_token: string, _checkRevoked?: boolean) => {
        throw new Error(providerCode);
      },
    );
    const app = makeApp({
      verifier: { verifyIdToken },
      accounts: { findByAuthUserId },
    });
    const response = await app.request("/api/v1/admin/session", {
      headers: { authorization: "Bearer revoked-admin" },
    });
    expect(response.status).toBe(401);
    expect(verifyIdToken).toHaveBeenCalledWith("revoked-admin", true);
    expect(findByAuthUserId).not.toHaveBeenCalled();
  });

  it("requires MFA on all admin routes while returning an obscured not-found for customers", async () => {
    const adminWithoutMfa = makeApp({
      verifier: { verifyIdToken: vi.fn(async () => ({ uid: "admin-uid" })) },
      accounts: {
        findByAuthUserId: vi.fn(async () => ({
          authUserId: "admin-uid",
          role: "admin" as const,
          customerId: null,
        })),
      },
    });
    expect(
      (
        await adminWithoutMfa.request("/api/v1/admin/customers", {
          headers: { authorization: "Bearer first-factor-only" },
        })
      ).status,
    ).toBe(403);

    const customerApp = makeApp();
    expect(
      (
        await customerApp.request("/api/v1/admin/customers", {
          headers: { authorization: "Bearer customer-token" },
        })
      ).status,
    ).toBe(404);
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

  it("verifies an unlinked Firebase identity and passes only the password-free submission to the module", async () => {
    const identity = { uid: "new-firebase-uid", email: "new@example.test" };
    const verifier = { verifyIdToken: vi.fn(async () => identity) };
    const submit = vi.fn(async () => ({
      applicationId: "00000000-0000-4000-8000-000000000001",
      contractId: "00000000-0000-4000-8000-000000000002",
      status: "under_review" as const,
      replayed: false,
    }));
    const app = makeApp({ verifier, applications: { submit } });
    const response = await app.request("/api/v1/applications", {
      method: "POST",
      headers: {
        authorization: "Bearer verified-token",
        "content-type": "application/json",
        "idempotency-key": "00000000-0000-4000-8000-000000000003",
      },
      body: JSON.stringify({
        shopName: "店舗",
        contactName: "担当者",
        email: "new@example.test",
        planCode: "light",
        billingName: "請求先",
        billingAddress: "住所",
        paymentMethod: "bank_transfer",
        consentBusinessUse: true,
        consentTerms: true,
        displayVersion: "a".repeat(64),
      }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      applicationId: "00000000-0000-4000-8000-000000000001",
      contractId: "00000000-0000-4000-8000-000000000002",
      status: "under_review",
      replayed: false,
    });
    expect(submit).toHaveBeenCalledWith({
      identity,
      idempotencyKey: "00000000-0000-4000-8000-000000000003",
      submission: expect.objectContaining({ email: "new@example.test" }),
      requestContext: {},
    });
  });

  it("rejects password-bearing and identity-mismatched application submissions without calling the module", async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const submit = vi.fn();
    const app = makeApp({
      verifier: {
        verifyIdToken: vi.fn(async () => ({
          uid: "uid",
          email: "person@example.test",
        })),
      },
      applications: { submit },
      logger,
    });
    const submission = {
      shopName: "店舗",
      contactName: "担当者",
      email: "person@example.test",
      planCode: "light",
      billingName: "請求先",
      billingAddress: "住所",
      paymentMethod: "bank_transfer",
      consentBusinessUse: true,
      consentTerms: true,
      displayVersion: "a".repeat(64),
    };
    const sentPassword = "password-must-not-be-logged-or-stored";
    const passwordResponse = await app.request("/api/v1/applications", {
      method: "POST",
      headers: {
        authorization: "Bearer verified-token",
        "content-type": "application/json",
        "idempotency-key": "00000000-0000-4000-8000-000000000004",
      },
      body: JSON.stringify({ ...submission, password: sentPassword }),
    });
    expect(passwordResponse.status).toBe(422);
    expect(submit).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(sentPassword);

    const mismatchResponse = await app.request("/api/v1/applications", {
      method: "POST",
      headers: {
        authorization: "Bearer verified-token",
        "content-type": "application/json",
        "idempotency-key": "00000000-0000-4000-8000-000000000005",
      },
      body: JSON.stringify({ ...submission, email: "other@example.test" }),
    });
    expect(mismatchResponse.status).toBe(401);
    expect(submit).not.toHaveBeenCalled();
  });

  it.each([
    "auth/id-token-revoked",
    "auth/user-disabled",
  ])("checks revoked and disabled Firebase account state before public application writes (%s)", async (providerCode) => {
    const verifyIdToken = vi.fn(
      async (_token: string, _checkRevoked?: boolean) => {
        throw new Error(`${providerCode}:private-provider-detail`);
      },
    );
    const submit = vi.fn();
    const logger = { info: vi.fn(), error: vi.fn() };
    const app = makeApp({
      verifier: { verifyIdToken },
      applications: { submit },
      logger,
    });
    const response = await app.request("/api/v1/applications", {
      method: "POST",
      headers: {
        authorization: "Bearer revoked-token",
        "content-type": "application/json",
        "idempotency-key": "00000000-0000-4000-8000-000000000006",
      },
      body: JSON.stringify({
        shopName: "店舗",
        contactName: "担当者",
        email: "person@example.test",
        planCode: "light",
        billingName: "請求先",
        billingAddress: "住所",
        paymentMethod: "bank_transfer",
        consentBusinessUse: true,
        consentTerms: true,
        displayVersion: "a".repeat(64),
      }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "unauthorized" },
    });
    expect(verifyIdToken).toHaveBeenCalledWith("revoked-token", true);
    expect(submit).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(
      "private-provider-detail",
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      "private-provider-detail",
    );
  });
});
