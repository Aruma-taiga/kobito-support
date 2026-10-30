import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const validEnvironment = {
  NODE_ENV: "development",
  DATABASE_URL: "postgres://kobito:kobito@localhost:5432/kobito_support",
  FIREBASE_PROJECT_ID: "demo-kobito-support",
  WEB_ORIGIN: "http://localhost:5173",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
};

describe("loadConfig", () => {
  it("requires the database, Firebase project, and browser origin", () => {
    expect(() => loadConfig({})).toThrow();
    expect(() =>
      loadConfig({ ...validEnvironment, DATABASE_URL: "" }),
    ).toThrow();
    expect(() =>
      loadConfig({ ...validEnvironment, FIREBASE_PROJECT_ID: "" }),
    ).toThrow();
    expect(() => loadConfig({ ...validEnvironment, WEB_ORIGIN: "" })).toThrow();
  });

  it("never includes submitted secret values in startup errors", () => {
    const secret = "postgres://private-user:very-secret@db.internal/kobito";
    try {
      loadConfig({
        ...validEnvironment,
        DATABASE_URL: secret,
        WEB_ORIGIN: "not a URL",
      });
      throw new Error("expected configuration error");
    } catch (error) {
      expect(String(error)).not.toContain("very-secret");
      expect(String(error)).toContain("WEB_ORIGIN");
    }
  });

  it("accepts local emulator config outside production", () => {
    expect(loadConfig(validEnvironment).authEmulatorHost).toBe(
      "127.0.0.1:9099",
    );
  });

  it("preserves the configured KOMOJU secret bytes and treats blank as unset", () => {
    expect(
      loadConfig({ ...validEnvironment, KOMOJU_WEBHOOK_SECRET: " secret " })
        .komojuWebhookSecret,
    ).toBe(" secret ");
    expect(
      loadConfig({ ...validEnvironment, KOMOJU_WEBHOOK_SECRET: "" })
        .komojuWebhookSecret,
    ).toBeUndefined();
    expect(
      loadConfig({ ...validEnvironment, KOMOJU_WEBHOOK_SECRET: "   " })
        .komojuWebhookSecret,
    ).toBeUndefined();
  });

  it("does not echo an invalid KOMOJU secret value", () => {
    const secret = "SECRET_SENTINEL";
    expect(() =>
      loadConfig({
        ...validEnvironment,
        KOMOJU_WEBHOOK_SECRET: secret,
        PORT: "bad",
      }),
    ).toThrow();
    try {
      loadConfig({
        ...validEnvironment,
        KOMOJU_WEBHOOK_SECRET: secret,
        PORT: "bad",
      });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it("rejects an auth emulator in production", () => {
    expect(() =>
      loadConfig({ ...validEnvironment, NODE_ENV: "production" }),
    ).toThrow();
  });

  it("validates port as a safe integer in range", () => {
    expect(loadConfig({ ...validEnvironment, PORT: "8080" }).port).toBe(8080);
    expect(() => loadConfig({ ...validEnvironment, PORT: "0" })).toThrow();
    expect(() => loadConfig({ ...validEnvironment, PORT: "1.5" })).toThrow();
    expect(() =>
      loadConfig({ ...validEnvironment, PORT: "9007199254740992" }),
    ).toThrow();
  });

  it("provides operational invoice defaults without hardcoding company identity", () => {
    const config = loadConfig(validEnvironment);
    expect(config.invoicePrefix).toBe("KS");
    expect(config.serviceName).toBeUndefined();
    expect(config.companyName).toBeUndefined();
  });

  it("uses the invoice prefix default when the example env value is blank", () => {
    expect(
      loadConfig({ ...validEnvironment, INVOICE_PREFIX: "" }).invoicePrefix,
    ).toBe("KS");
  });

  it("allows invoice previews only as an explicit local-development setting", () => {
    expect(loadConfig(validEnvironment).devInvoicePreview).toBe(false);
    expect(
      loadConfig({ ...validEnvironment, DEV_INVOICE_PREVIEW: "1" })
        .devInvoicePreview,
    ).toBe(true);
    expect(() =>
      loadConfig({
        ...validEnvironment,
        NODE_ENV: "production",
        FIREBASE_AUTH_EMULATOR_HOST: "",
        DEV_INVOICE_PREVIEW: "1",
      }),
    ).toThrow();
  });

  it("accepts an optional valid operations notification recipient", () => {
    expect(loadConfig(validEnvironment).operationsEmail).toBeUndefined();
    expect(
      loadConfig({
        ...validEnvironment,
        OPERATIONS_EMAIL: "ops@example.test",
      }).operationsEmail,
    ).toBe("ops@example.test");
  });

  it("rejects malformed operations recipient values without echoing them", () => {
    const invalidAddress = "ops-private-sentinel";
    try {
      loadConfig({
        ...validEnvironment,
        OPERATIONS_EMAIL: invalidAddress,
      });
      throw new Error("expected configuration error");
    } catch (error) {
      expect(String(error)).toContain("OPERATIONS_EMAIL");
      expect(String(error)).not.toContain(invalidAddress);
    }
  });
});
