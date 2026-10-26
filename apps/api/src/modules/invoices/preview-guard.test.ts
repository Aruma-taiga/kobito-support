import { describe, expect, it } from "vitest";
import type { RuntimeConfig } from "../../platform/config.js";
import { isLocalInvoicePreviewEnvironment } from "./repository.js";

const local: RuntimeConfig = {
  nodeEnv: "development",
  databaseUrl: "postgres://test:test@127.0.0.1:5432/kobito_support",
  firebaseProjectId: "demo-kobito-support",
  webOrigin: "http://localhost:5173",
  port: 3000,
  invoicePrefix: "KS",
  authEmulatorHost: "127.0.0.1:9099",
  devInvoicePreview: true,
};

describe("local invoice preview guard", () => {
  it("accepts only explicit demo-auth, emulator, loopback, exact local database settings", () => {
    expect(isLocalInvoicePreviewEnvironment(local)).toBe(true);
    expect(
      isLocalInvoicePreviewEnvironment({ ...local, nodeEnv: "production" }),
    ).toBe(false);
    expect(
      isLocalInvoicePreviewEnvironment({
        ...local,
        firebaseProjectId: "production-project",
      }),
    ).toBe(false);
    const { authEmulatorHost: _authEmulatorHost, ...withoutEmulator } = local;
    expect(isLocalInvoicePreviewEnvironment(withoutEmulator)).toBe(false);
    expect(
      isLocalInvoicePreviewEnvironment({
        ...local,
        databaseUrl:
          "postgres://test:test@localhost/kobito_support?sslmode=disable",
      }),
    ).toBe(false);
    expect(
      isLocalInvoicePreviewEnvironment({
        ...local,
        databaseUrl: "postgres://test:test@127.0.0.1/kobito_support_test",
      }),
    ).toBe(false);
    expect(
      isLocalInvoicePreviewEnvironment({ ...local, devInvoicePreview: false }),
    ).toBe(false);
  });
});
