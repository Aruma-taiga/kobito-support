import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createFirebaseVerifier, requireAdmin } from "./auth.js";
import type { Principal } from "./types.js";
import { ApiError } from "./types.js";

function adminHarness(principal: Principal) {
  const app = new Hono<{ Variables: { principal: Principal } }>();
  app.use("*", async (context, next) => {
    context.set("principal", principal);
    await next();
  });
  app.use("/admin/*", requireAdmin());
  app.get("/admin/write-probe", (context) => context.body(null, 204));
  app.onError((error, context) =>
    context.body(null, error instanceof ApiError ? error.status : 500),
  );
  return app;
}

describe("admin authorization", () => {
  it("hides admin routes from customer accounts", async () => {
    const response = await adminHarness({
      authUserId: "customer-uid",
      role: "customer",
      customerId: "customer-a",
      secondFactor: "totp",
    }).request("/admin/write-probe");
    expect(response.status).toBe(404);
  });

  it("requires a second factor even for a database admin role", async () => {
    const response = await adminHarness({
      authUserId: "admin-uid",
      role: "admin",
      customerId: null,
      secondFactor: null,
    }).request("/admin/write-probe");
    expect(response.status).toBe(403);
  });

  it("allows only a DB admin with verified second-factor evidence", async () => {
    const response = await adminHarness({
      authUserId: "admin-uid",
      role: "admin",
      customerId: null,
      secondFactor: "phone",
    }).request("/admin/write-probe");
    expect(response.status).toBe(204);
  });
});

describe("Firebase verifier environment guards", () => {
  const baseConfig = {
    nodeEnv: "production" as const,
    databaseUrl: "postgres://localhost/test",
    firebaseProjectId: "production-project",
    webOrigin: "https://example.test",
    port: 8080,
    invoicePrefix: "KS",
  };

  it("refuses emulator initialization in production", () => {
    expect(() =>
      createFirebaseVerifier({
        ...baseConfig,
        authEmulatorHost: "127.0.0.1:9099",
      }),
    ).toThrow("Firebase Auth Emulator is forbidden in production");
  });

  it("refuses demo Firebase projects outside local development", () => {
    expect(() =>
      createFirebaseVerifier({
        ...baseConfig,
        nodeEnv: "test",
        firebaseProjectId: "demo-kobito-support",
      }),
    ).toThrow("Demo Firebase projects are local-development only");
  });
});
