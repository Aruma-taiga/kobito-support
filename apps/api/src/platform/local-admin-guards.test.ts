import { describe, expect, it } from "vitest";
import type { RuntimeConfig } from "./config.js";
import { validateLocalAdminSeedTarget } from "./local-admin-guards.js";

const config: RuntimeConfig = {
  nodeEnv: "development",
  databaseUrl: "postgres://kobito:kobito@127.0.0.1:55433/kobito_support",
  firebaseProjectId: "demo-kobito-support",
  authEmulatorHost: "127.0.0.1:9099",
  webOrigin: "http://localhost:5173",
  port: 3000,
  invoicePrefix: "KS",
};
const credentials = {
  email: "admin@example.test",
  password: "local-admin-password-should-be-long",
  phone: "+16505550123",
};

describe("local admin MFA tool guards", () => {
  it("accepts only the demo project and exact loopback auth/database targets", () => {
    expect(validateLocalAdminSeedTarget(config, credentials)).toEqual({
      authEmulatorOrigin: "http://127.0.0.1:9099",
    });
  });

  it.each([
    { config: { ...config, nodeEnv: "production" as const } },
    { config: { ...config, firebaseProjectId: "real-project" } },
    { config: { ...config, authEmulatorHost: "auth.example.test:9099" } },
    { config: { ...config, authEmulatorHost: "127.0.0.1:9098" } },
    {
      config: {
        ...config,
        databaseUrl: "postgres://kobito:kobito@db.example.test/kobito_support",
      },
    },
    {
      config: {
        ...config,
        databaseUrl:
          "postgres://kobito:kobito@127.0.0.1/kobito_support?host=db.example.test",
      },
    },
    {
      config: {
        ...config,
        databaseUrl: "postgres://kobito:kobito@127.0.0.1/customer_data",
      },
    },
  ])("rejects unsafe local target settings", ({ config: candidate }) => {
    expect(() => validateLocalAdminSeedTarget(candidate, credentials)).toThrow(
      "Local admin tools require the demo emulator and loopback kobito_support database",
    );
  });

  it("rejects missing or malformed admin factors without including submitted values in errors", () => {
    for (const invalid of [
      { ...credentials, email: "not-an-email" },
      { ...credentials, password: "short" },
      { ...credentials, phone: "+1 bad" },
    ]) {
      expect(() => validateLocalAdminSeedTarget(config, invalid)).toThrow(
        "Local admin tools require development credentials",
      );
    }
  });
});
