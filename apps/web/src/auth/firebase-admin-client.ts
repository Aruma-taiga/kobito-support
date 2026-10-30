import { getApps, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  getMultiFactorResolver,
  type MultiFactorError,
  type MultiFactorInfo,
  onAuthStateChanged,
  PhoneAuthProvider,
  PhoneMultiFactorGenerator,
  type PhoneMultiFactorInfo,
  RecaptchaVerifier,
  signInWithEmailAndPassword,
  signOut,
  TotpMultiFactorGenerator,
  type User,
} from "firebase/auth";
import type { WebConfig } from "../platform/config.js";
import type {
  AdminAuthClient,
  AdminAuthUser,
  AdminFactorId,
  AdminSignInResult,
} from "./admin-session.js";

export class AdminAuthClientError extends Error {
  constructor(
    readonly code:
      | "unsupported_factor"
      | "invalid_code"
      | "no_pending_challenge",
  ) {
    super(code);
  }
}

function wrapUser(user: User): AdminAuthUser {
  return {
    email: user.email,
    getIdToken: () => user.getIdToken(),
  };
}

function factorId(info: MultiFactorInfo): AdminFactorId | null {
  if (info.factorId === TotpMultiFactorGenerator.FACTOR_ID) return "totp";
  if (info.factorId === PhoneMultiFactorGenerator.FACTOR_ID) return "phone";
  return null;
}

export function createFirebaseAdminAuthClient(
  config: WebConfig,
): AdminAuthClient {
  const appName = `kobito-web-${config.firebaseProjectId}-admin`;
  const app =
    getApps().find((candidate) => candidate.name === appName) ??
    initializeApp(
      {
        apiKey: config.firebaseApiKey,
        authDomain: config.firebaseAuthDomain,
        projectId: config.firebaseProjectId,
        appId: config.firebaseAppId,
      },
      appName,
    );
  const auth = getAuth(app);
  const listeners = new Set<(user: AdminAuthUser | null) => void>();
  const authEmulator = Boolean(config.authEmulatorUrl);

  if (config.authEmulatorUrl) {
    connectAuthEmulator(auth, config.authEmulatorUrl, {
      disableWarnings: true,
    });
    auth.settings.appVerificationDisabledForTesting = true;
  }

  let pendingResolver: ReturnType<typeof getMultiFactorResolver> | null = null;
  let pendingFactors = new Map<string, MultiFactorInfo>();
  let selectedFactorUid: string | null = null;
  let smsVerificationId: string | null = null;
  let recaptchaVerifier: RecaptchaVerifier | null = null;

  const clearVerifier = () => {
    const verifier = recaptchaVerifier;
    recaptchaVerifier = null;
    verifier?.clear();
  };

  const clearChallenge = () => {
    clearVerifier();
    pendingResolver = null;
    pendingFactors = new Map();
    selectedFactorUid = null;
    smsVerificationId = null;
  };

  const notify = (user: User | null) => {
    for (const listener of listeners) listener(user ? wrapUser(user) : null);
  };

  return {
    currentUser: () => (auth.currentUser ? wrapUser(auth.currentUser) : null),
    subscribe: (listener) => {
      listeners.add(listener);
      const unsubscribe = onAuthStateChanged(
        auth,
        (user) => listener(user ? wrapUser(user) : null),
        () => listener(null),
      );
      return () => {
        listeners.delete(listener);
        unsubscribe();
      };
    },
    signIn: async (email, password): Promise<AdminSignInResult> => {
      clearChallenge();
      try {
        await signInWithEmailAndPassword(auth, email, password);
        return { status: "signed_in" };
      } catch (error) {
        if (
          (error as { code?: string })?.code !==
          "auth/multi-factor-auth-required"
        )
          throw error;
        const resolver = getMultiFactorResolver(
          auth,
          error as MultiFactorError,
        );
        const allowed = resolver.hints.filter((hint) => {
          const id = factorId(hint);
          return authEmulator ? id === "phone" : id === "totp";
        });
        if (allowed.length === 0) {
          clearChallenge();
          throw new AdminAuthClientError("unsupported_factor");
        }
        pendingResolver = resolver;
        pendingFactors = new Map(allowed.map((hint) => [hint.uid, hint]));
        const factors = allowed.flatMap((hint) => {
          const id = factorId(hint);
          if (!id) return [];
          const phoneNumber =
            id === "phone"
              ? (hint as PhoneMultiFactorInfo).phoneNumber
              : undefined;
          return [
            {
              uid: hint.uid,
              factorId: id,
              displayName: hint.displayName ?? null,
              ...(phoneNumber ? { phoneNumber } : {}),
            },
          ];
        });
        return { status: "mfa_required", factors };
      }
    },
    startSecondFactor: async (uid, recaptchaContainer) => {
      const resolver = pendingResolver;
      const hint = pendingFactors.get(uid);
      const id = hint ? factorId(hint) : null;
      if (!resolver || !hint || !id) {
        throw new AdminAuthClientError("no_pending_challenge");
      }
      selectedFactorUid = uid;
      smsVerificationId = null;
      if (id === "phone") {
        if (!authEmulator) throw new AdminAuthClientError("unsupported_factor");
        if (!recaptchaContainer) {
          throw new AdminAuthClientError("no_pending_challenge");
        }
        clearVerifier();
        recaptchaVerifier = new RecaptchaVerifier(auth, recaptchaContainer, {
          size: "invisible",
        });
        const provider = new PhoneAuthProvider(auth);
        try {
          smsVerificationId = await provider.verifyPhoneNumber(
            {
              multiFactorHint: hint as PhoneMultiFactorInfo,
              session: resolver.session,
            },
            recaptchaVerifier,
          );
        } catch (error) {
          clearVerifier();
          throw error;
        }
      }
    },
    completeSecondFactor: async (uid, code) => {
      const resolver = pendingResolver;
      const hint = pendingFactors.get(uid);
      const id = hint ? factorId(hint) : null;
      if (!resolver || !hint || !id || selectedFactorUid !== uid) {
        throw new AdminAuthClientError("no_pending_challenge");
      }
      if (!/^\d{6}$/.test(code)) throw new AdminAuthClientError("invalid_code");
      let assertion: ReturnType<
        typeof TotpMultiFactorGenerator.assertionForSignIn
      >;
      if (id === "totp") {
        assertion = TotpMultiFactorGenerator.assertionForSignIn(uid, code);
      } else {
        if (!authEmulator || !smsVerificationId)
          throw new AdminAuthClientError("unsupported_factor");
        const credential = PhoneAuthProvider.credential(
          smsVerificationId,
          code,
        );
        assertion = PhoneMultiFactorGenerator.assertion(credential);
      }
      await resolver.resolveSignIn(assertion);
      clearChallenge();
    },
    cancelSecondFactor: clearChallenge,
    signOut: async () => {
      await signOut(auth);
      clearChallenge();
      notify(null);
    },
  };
}
