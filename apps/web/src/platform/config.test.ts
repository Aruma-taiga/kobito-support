import { describe, expect, it } from "vitest";
import { loadWebConfig } from "./config.js";

const localEnvironment = {
  VITE_FIREBASE_API_KEY: "fake-api-key",
  VITE_FIREBASE_AUTH_DOMAIN: "demo-kobito-support.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "demo-kobito-support",
  VITE_FIREBASE_APP_ID: "1:000000000000:web:local-test",
  VITE_API_BASE_URL: "http://127.0.0.1:3000",
  VITE_FIREBASE_AUTH_EMULATOR_URL: "http://127.0.0.1:9099",
};

describe("web public configuration", () => {
  it("accepts loopback-only local API and Firebase Auth Emulator settings", () => {
    expect(loadWebConfig(localEnvironment, "development")).toMatchObject({
      apiBaseUrl: "http://127.0.0.1:3000",
      firebaseProjectId: "demo-kobito-support",
      authEmulatorUrl: "http://127.0.0.1:9099",
    });
  });

  it("keeps LIFF optional and exposes only its public LIFF id", () => {
    expect(
      loadWebConfig(localEnvironment, "development").lineLiffId,
    ).toBeUndefined();
    expect(
      loadWebConfig(
        { ...localEnvironment, VITE_LINE_LIFF_ID: "2000000000-AbCdEfGh" },
        "development",
      ).lineLiffId,
    ).toBe("2000000000-AbCdEfGh");
  });

  it("does not echo an invalid LIFF id in configuration errors", () => {
    expect(() =>
      loadWebConfig(
        { ...localEnvironment, VITE_LINE_LIFF_ID: "secret-value" },
        "development",
      ),
    ).toThrowError("Invalid web configuration: VITE_LINE_LIFF_ID");
  });

  it("accepts a production build config only with HTTPS and no demo/emulator", () => {
    expect(
      loadWebConfig(
        {
          ...localEnvironment,
          VITE_FIREBASE_API_KEY: "public-ci-key",
          VITE_FIREBASE_AUTH_DOMAIN: "web-ci-project.firebaseapp.com",
          VITE_FIREBASE_PROJECT_ID: "web-ci-project",
          VITE_FIREBASE_AUTH_EMULATOR_URL: "",
          VITE_API_BASE_URL: "https://api.example.invalid",
        },
        "production",
      ).apiBaseUrl,
    ).toBe("https://api.example.invalid");
  });

  it.each([
    [
      "demo Firebase project",
      { ...localEnvironment, VITE_API_BASE_URL: "https://api.example.invalid" },
    ],
    [
      "emulator URL",
      {
        ...localEnvironment,
        VITE_FIREBASE_AUTH_EMULATOR_URL: "http://127.0.0.1:9099",
        VITE_API_BASE_URL: "https://api.example.invalid",
        VITE_FIREBASE_PROJECT_ID: "web-ci-project",
      },
    ],
    [
      "fake API key",
      {
        ...localEnvironment,
        VITE_FIREBASE_API_KEY: "fake-api-key",
        VITE_API_BASE_URL: "https://api.example.invalid",
        VITE_FIREBASE_PROJECT_ID: "web-ci-project",
        VITE_FIREBASE_AUTH_EMULATOR_URL: "",
      },
    ],
  ])("rejects unsafe production %s configuration", (_label, environment) => {
    expect(() => loadWebConfig(environment, "production")).toThrow();
  });

  it("rejects non-loopback HTTP endpoints during local development", () => {
    expect(() =>
      loadWebConfig(
        { ...localEnvironment, VITE_API_BASE_URL: "http://api.example.test" },
        "development",
      ),
    ).toThrow();
  });

  it("does not echo invalid credential-like config values in errors", () => {
    expect(() =>
      loadWebConfig(
        {
          ...localEnvironment,
          VITE_FIREBASE_API_KEY: "should-not-leak-this",
          VITE_FIREBASE_AUTH_DOMAIN: "",
        },
        "development",
      ),
    ).toThrowError("Invalid web configuration: VITE_FIREBASE_AUTH_DOMAIN");
  });
});
