import { getApps, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithCustomToken,
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
    uid: user.uid,
    email: user.email,
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
      const credential = await signInWithEmailAndPassword(
        auth,
        email,
        password,
      );
      const user = wrapUser(credential.user);
      if (auth.currentUser?.uid === user.uid) {
        for (const listener of listeners) listener(user);
      }
      return user;
    },
    signInWithCustomToken: async (token) => {
      const credential = await signInWithCustomToken(auth, token);
      const user = wrapUser(credential.user);
      if (auth.currentUser?.uid === user.uid) {
        for (const listener of listeners) listener(user);
      }
      return user;
    },
    signUp: async (email, password) => {
      const credential = await createUserWithEmailAndPassword(
        auth,
        email,
        password,
      );
      return wrapUser(credential.user);
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
