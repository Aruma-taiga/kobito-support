import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebConfig } from "../platform/config.js";

const mocks = vi.hoisted(() => ({
  getApps: vi.fn(() => [] as Array<{ name: string }>),
  initializeApp: vi.fn((_options: unknown, name: string) => ({ name })),
  getAuth: vi.fn(() => ({
    currentUser: null as unknown,
    settings: {} as Record<string, unknown>,
  })),
  connectAuthEmulator: vi.fn(),
  onAuthStateChanged: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(async () => undefined),
  getMultiFactorResolver: vi.fn(),
  totpAssertionForSignIn: vi.fn((factorUid: string, code: string) => ({
    factorUid,
    code,
    kind: "totp",
  })),
  phoneVerify: vi.fn(async () => "verification-id"),
  phoneCredential: vi.fn((id: string, code: string) => ({ id, code })),
  phoneAssertion: vi.fn((credential: unknown) => ({
    credential,
    kind: "phone",
  })),
  recaptchaVerifier: vi.fn(),
  recaptchaClear: vi.fn(),
}));

vi.mock("firebase/app", () => ({
  getApps: mocks.getApps,
  initializeApp: mocks.initializeApp,
}));

vi.mock("firebase/auth", () => ({
  connectAuthEmulator: mocks.connectAuthEmulator,
  getAuth: mocks.getAuth,
  getMultiFactorResolver: mocks.getMultiFactorResolver,
  onAuthStateChanged: mocks.onAuthStateChanged,
  PhoneAuthProvider: class {
    verifyPhoneNumber = mocks.phoneVerify;
    static credential = mocks.phoneCredential;
  },
  RecaptchaVerifier: class {
    constructor(...args: unknown[]) {
      mocks.recaptchaVerifier(...args);
    }
    clear = mocks.recaptchaClear;
  },
  PhoneMultiFactorGenerator: {
    FACTOR_ID: "phone",
    assertion: mocks.phoneAssertion,
  },
  signInWithEmailAndPassword: mocks.signInWithEmailAndPassword,
  signOut: mocks.signOut,
  TotpMultiFactorGenerator: {
    FACTOR_ID: "totp",
    assertionForSignIn: mocks.totpAssertionForSignIn,
  },
}));

import { createFirebaseAdminAuthClient } from "./firebase-admin-client.js";

const config: WebConfig = {
  firebaseApiKey: "fake-api-key",
  firebaseAuthDomain: "demo-kobito.firebaseapp.com",
  firebaseProjectId: "demo-kobito",
  firebaseAppId: "1:123456789:web:abcdef",
  apiBaseUrl: "http://127.0.0.1:3000",
  authEmulatorUrl: "http://127.0.0.1:9099",
  lineEnabled: false,
};
const productionConfig: WebConfig = {
  firebaseApiKey: config.firebaseApiKey,
  firebaseAuthDomain: config.firebaseAuthDomain,
  firebaseProjectId: config.firebaseProjectId,
  firebaseAppId: config.firebaseAppId,
  apiBaseUrl: config.apiBaseUrl,
  lineEnabled: false,
};

function makeResolver(hint: { uid: string; factorId: string }) {
  return {
    hints: [hint],
    session: { id: "pending-session" },
    resolveSignIn: vi.fn(async () => ({ user: { email: "admin@example.jp" } })),
  };
}

describe("separate Firebase admin auth client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getApps.mockReturnValue([]);
    mocks.getAuth.mockReturnValue({ currentUser: null, settings: {} });
  });

  it("uses an isolated Firebase app name for administrator sign-in", () => {
    createFirebaseAdminAuthClient(config);
    expect(mocks.initializeApp).toHaveBeenCalledWith(
      expect.any(Object),
      "kobito-web-demo-kobito-admin",
    );
  });

  it("holds a TOTP resolver until a valid second factor is completed", async () => {
    const resolver = makeResolver({ uid: "totp-1", factorId: "totp" });
    mocks.getMultiFactorResolver.mockReturnValue(resolver);
    mocks.signInWithEmailAndPassword.mockRejectedValue({
      code: "auth/multi-factor-auth-required",
    });
    const client = createFirebaseAdminAuthClient(productionConfig);

    await expect(
      client.signIn("admin@example.jp", "secret"),
    ).resolves.toMatchObject({
      status: "mfa_required",
      factors: [{ uid: "totp-1", factorId: "totp" }],
    });
    expect(client.currentUser()).toBeNull();
    await client.startSecondFactor("totp-1");
    await client.completeSecondFactor("totp-1", "123456");
    expect(mocks.totpAssertionForSignIn).toHaveBeenCalledWith(
      "totp-1",
      "123456",
    );
    expect(resolver.resolveSignIn).toHaveBeenCalledWith({
      factorUid: "totp-1",
      code: "123456",
      kind: "totp",
    });
  });

  it("uses and clears an invisible verifier for emulator SMS MFA", async () => {
    const resolver = makeResolver({ uid: "phone-1", factorId: "phone" });
    mocks.getMultiFactorResolver.mockReturnValue(resolver);
    mocks.signInWithEmailAndPassword.mockRejectedValue({
      code: "auth/multi-factor-auth-required",
    });
    const client = createFirebaseAdminAuthClient(config);
    await client.signIn("admin@example.jp", "secret");
    const container = {} as HTMLElement;
    await client.startSecondFactor("phone-1", container);
    expect(mocks.recaptchaVerifier).toHaveBeenCalledWith(
      expect.any(Object),
      container,
      { size: "invisible" },
    );
    await client.completeSecondFactor("phone-1", "123456");
    expect(mocks.connectAuthEmulator).toHaveBeenCalled();
    expect(mocks.phoneVerify).toHaveBeenCalledWith(
      {
        multiFactorHint: resolver.hints[0],
        session: resolver.session,
      },
      expect.any(Object),
    );
    expect(mocks.recaptchaClear).toHaveBeenCalledOnce();
    expect(mocks.phoneCredential).toHaveBeenCalledWith(
      "verification-id",
      "123456",
    );
  });

  it("does not offer TOTP through the auth emulator", async () => {
    const resolver = makeResolver({ uid: "totp-1", factorId: "totp" });
    mocks.getMultiFactorResolver.mockReturnValue(resolver);
    mocks.signInWithEmailAndPassword.mockRejectedValue({
      code: "auth/multi-factor-auth-required",
    });
    const client = createFirebaseAdminAuthClient(config);

    await expect(
      client.signIn("admin@example.jp", "secret"),
    ).rejects.toMatchObject({ code: "unsupported_factor" });
    expect(mocks.totpAssertionForSignIn).not.toHaveBeenCalled();
  });

  it("does not offer or invoke phone SMS MFA outside the emulator", async () => {
    const resolver = makeResolver({ uid: "phone-1", factorId: "phone" });
    mocks.getMultiFactorResolver.mockReturnValue(resolver);
    mocks.signInWithEmailAndPassword.mockRejectedValue({
      code: "auth/multi-factor-auth-required",
    });
    const client = createFirebaseAdminAuthClient(productionConfig);

    await expect(
      client.signIn("admin@example.jp", "secret"),
    ).rejects.toMatchObject({
      code: "unsupported_factor",
    });
    expect(mocks.phoneVerify).not.toHaveBeenCalled();
  });

  it("keeps the active auth session when SDK sign-out rejects", async () => {
    const currentUser = {
      email: "admin@example.jp",
      getIdToken: vi.fn(async () => "token"),
    };
    mocks.getAuth.mockReturnValue({ currentUser, settings: {} });
    mocks.signOut.mockRejectedValueOnce(new Error("SDK failure"));
    const client = createFirebaseAdminAuthClient(productionConfig);
    const listener = vi.fn();
    client.subscribe(listener);

    await expect(client.signOut()).rejects.toThrow("SDK failure");

    expect(client.currentUser()?.email).toBe("admin@example.jp");
    expect(listener).not.toHaveBeenCalledWith(null);
  });
});
