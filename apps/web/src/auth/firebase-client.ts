import { getApps, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import type { WebConfig } from "../platform/config.js";
import type { AuthClient, AuthUser } from "./session.js";

export function createFirebaseAuthClient(config: WebConfig): AuthClient {
  const appName = `kobito-web-${config.firebaseProjectId}`;
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
  const listeners = new Set<(user: AuthUser | null) => void>();

  if (config.authEmulatorUrl) {
    connectAuthEmulator(auth, config.authEmulatorUrl, {
      disableWarnings: true,
    });
  }

  const wrapUser = (user: User): AuthUser => ({
    getIdToken: () => user.getIdToken(),
  });

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
    signIn: async (email, password) => {
      await signInWithEmailAndPassword(auth, email, password);
    },
    signOut: async () => {
      try {
        await signOut(auth);
      } finally {
        for (const listener of listeners) listener(null);
      }
    },
  };
}
