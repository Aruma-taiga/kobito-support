import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  lineLinkResponseSchema,
  lineLinkStatusResponseSchema,
  lineSignInResponseSchema,
  meResponseSchema,
} from "@kobito/shared";
import dotenv from "dotenv";
import {
  deleteApp as deleteFirebaseClientApp,
  initializeApp as initializeFirebaseClientApp,
} from "firebase/app";
import {
  connectAuthEmulator,
  initializeAuth,
  inMemoryPersistence,
  signInWithCustomToken,
  signOut,
} from "firebase/auth";
import { getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { Pool } from "pg";
import type { AppDependencies } from "../src/app.js";
import { createApp } from "../src/app.js";
import { LineIdTokenVerifier } from "../src/integrations/line/verify-id-token.js";
import { PostgresLineRepository } from "../src/modules/accounts/line/repository.js";
import { LineService } from "../src/modules/accounts/line/service.js";
import { AccountsRepository } from "../src/modules/accounts/repository.js";
import {
  createFirebaseCustomTokenIssuer,
  createFirebaseVerifier,
} from "../src/platform/auth.js";
import type { RuntimeConfig } from "../src/platform/config.js";

dotenv.config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
});
if (process.env.NODE_ENV === "production") {
  throw new Error("LINE local smoke is forbidden in production");
}

function requireLoopbackHost(hostname: string, label: string) {
  if (
    !["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname.toLowerCase())
  ) {
    throw new Error(`${label} must use a loopback host`);
  }
}

function validateDatabaseUrl(value: string | undefined) {
  if (!value) throw new Error("TEST_DATABASE_URL is required");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("TEST_DATABASE_URL must use PostgreSQL");
  requireLoopbackHost(url.hostname, "TEST_DATABASE_URL");
  if (url.pathname !== "/kobito_support_test" || url.search || url.hash) {
    throw new Error(
      "TEST_DATABASE_URL must target the exact local test database",
    );
  }
  return value;
}

function validateEmulatorHost(value: string | undefined) {
  if (!value) throw new Error("FIREBASE_AUTH_EMULATOR_HOST is required");
  const url = new URL(`http://${value}`);
  requireLoopbackHost(url.hostname, "FIREBASE_AUTH_EMULATOR_HOST");
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("FIREBASE_AUTH_EMULATOR_HOST must be a host and port");
  return `${url.hostname}:${url.port || "80"}`;
}

const databaseUrl = validateDatabaseUrl(process.env.TEST_DATABASE_URL);
const emulatorHost = validateEmulatorHost(
  process.env.FIREBASE_AUTH_EMULATOR_HOST,
);
const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
if (!projectId?.startsWith("demo-"))
  throw new Error("FIREBASE_PROJECT_ID must be a demo project");
const channelId =
  process.env.LINE_LOGIN_CHANNEL_ID?.trim() || "smoke-line-channel";

const config: RuntimeConfig = {
  nodeEnv: "development",
  databaseUrl,
  firebaseProjectId: projectId,
  webOrigin: "http://localhost",
  authEmulatorHost: emulatorHost,
  port: 3000,
  invoicePrefix: "KS",
  lineLoginChannelId: channelId,
};
const pool = new Pool({
  connectionString: databaseUrl,
  options: "-c timezone=Asia/Tokyo",
});
const accounts = new AccountsRepository(pool);
const uid = `line-smoke-${randomUUID()}`;
let customerId: string | undefined;
let adminAuth: ReturnType<typeof getAuth> | undefined;
let clientApp: ReturnType<typeof initializeFirebaseClientApp> | undefined;
let firebaseAuth: ReturnType<typeof initializeAuth> | undefined;
let emulatorUserCreated = false;
let smokePassed = false;

try {
  const customer = await pool.query<{ id: string }>(
    "insert into customers(shop_name,contact_name,billing_name,billing_address,email) values($1,'LINE smoke','LINE smoke','local test',$2) returning id",
    [`LINE smoke ${uid}`, `${uid}@example.test`],
  );
  customerId = customer.rows[0]?.id;
  if (!customerId) throw new Error("Could not create the local smoke customer");
  await pool.query(
    "insert into user_accounts(auth_user_id,customer_id,role) values($1,$2,'customer')",
    [uid, customerId],
  );

  createFirebaseVerifier(config);
  const customTokens = createFirebaseCustomTokenIssuer(config);
  const adminApp = getApps().find((app) => app.name === "kobito-api");
  if (!adminApp) throw new Error("Firebase Admin app was not initialized");
  adminAuth = getAuth(adminApp);
  clientApp = initializeFirebaseClientApp(
    { apiKey: "fake-api-key", projectId },
    `line-smoke-${uid}`,
  );
  firebaseAuth = initializeAuth(clientApp, {
    persistence: inMemoryPersistence,
  });
  connectAuthEmulator(firebaseAuth, `http://${emulatorHost}`, {
    disableWarnings: true,
  });

  const lineTokens = new Map([
    ["unlinked-line-token", "line-smoke-unlinked"],
    ["linked-line-token", `line-smoke-sub-${uid}`],
  ]);
  const lineVerifier = new LineIdTokenVerifier(
    channelId,
    async (input, init) => {
      if (
        input !== "https://api.line.me/oauth2/v2.1/verify" ||
        init?.redirect !== "error" ||
        init.credentials !== "omit"
      ) {
        throw new Error("Unexpected LINE verification request");
      }
      const form = new URLSearchParams(String(init.body));
      const subject = lineTokens.get(form.get("id_token") || "");
      if (!subject || form.get("client_id") !== channelId)
        return Response.json({ error: "invalid" }, { status: 400 });
      return Response.json({
        sub: subject,
        aud: channelId,
        iss: "https://access.line.me",
        exp: Math.floor(Date.now() / 1000) + 60,
      });
    },
  );
  const line = new LineService(
    new PostgresLineRepository(pool),
    lineVerifier,
    customTokens,
  );

  const dependencies: AppDependencies = {
    config,
    verifier: createFirebaseVerifier(config),
    accounts,
    applications: {} as AppDependencies["applications"],
    admin: {} as AppDependencies["admin"],
    invoices: {} as AppDependencies["invoices"],
    customerAccess: {
      getAccess: async () => ({
        contractStatus: null,
        landingPath: "/me",
        access: "none",
        welcomeRequired: false,
        invoiceAccess: false,
        invoiceAccessUntil: null,
      }),
      markWelcomeSeen: async () => ({ seenAt: new Date().toISOString() }),
    },
    publicSettings: { getServiceName: async () => "LINE smoke" },
    logger: { info: () => {}, error: () => {} },
    komojuInbox: { receive: async () => "accepted" },
    line,
  };
  const app = createApp(dependencies);
  const postJson = (path: string, body: unknown, idToken?: string) =>
    app.request(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(idToken ? { authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify(body),
    });

  const unlinked = await postJson("/api/v1/auth/line", {
    idToken: "unlinked-line-token",
  });
  if (unlinked.status !== 404)
    throw new Error("Unlinked LINE sign-in did not return 404");

  const initialCustomToken = await customTokens.createCustomToken(uid);
  const initialSignIn = await signInWithCustomToken(
    firebaseAuth,
    initialCustomToken,
  );
  if (initialSignIn.user.uid !== uid)
    throw new Error("Firebase emulator returned an unexpected customer UID");
  emulatorUserCreated = true;
  const initialIdToken = await initialSignIn.user.getIdToken();

  const badScope = await postJson(
    "/api/v1/me/line/link",
    { idToken: "linked-line-token", customerId: randomUUID() },
    initialIdToken,
  );
  if (badScope.status !== 400)
    throw new Error("Client-supplied customer scope was not rejected");
  const link = await postJson(
    "/api/v1/me/line/link",
    { idToken: "linked-line-token" },
    initialIdToken,
  );
  if (!lineLinkResponseSchema.safeParse(await link.json()).success)
    throw new Error("LINE link response was invalid");

  const status = await app.request("/api/v1/me/line", {
    headers: { authorization: `Bearer ${initialIdToken}` },
  });
  const parsedStatus = lineLinkStatusResponseSchema.safeParse(
    await status.json(),
  );
  if (
    status.status !== 200 ||
    !parsedStatus.success ||
    !parsedStatus.data.linked
  )
    throw new Error("LINE link status was invalid");

  const exchange = await postJson("/api/v1/auth/line", {
    idToken: "linked-line-token",
  });
  if (!exchange.ok) throw new Error("Linked LINE sign-in failed");
  const exchangeBody = lineSignInResponseSchema.parse(await exchange.json());
  if (exchangeBody.authUserId !== uid)
    throw new Error("LINE sign-in returned an unexpected UID");
  const returnedSignIn = await signInWithCustomToken(
    firebaseAuth,
    exchangeBody.customToken,
  );
  if (returnedSignIn.user.uid !== uid)
    throw new Error("LINE custom token resolved to an unexpected UID");
  const returnedIdToken = await returnedSignIn.user.getIdToken();
  const meResponse = await app.request("/api/v1/me", {
    headers: { authorization: `Bearer ${returnedIdToken}` },
  });
  const me = meResponseSchema.safeParse(await meResponse.json());
  if (
    meResponse.status !== 200 ||
    !me.success ||
    me.data.customer.id !== customerId
  )
    throw new Error(
      "Firebase ID token did not resolve to the linked customer scope",
    );

  smokePassed = true;
} catch {
  console.error(
    "LINE local smoke failed. No credentials, tokens, or upstream errors were printed.",
  );
  process.exitCode = 1;
} finally {
  let cleanupFailed = false;
  const safely = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch {
      cleanupFailed = true;
    }
  };
  const authForCleanup = firebaseAuth;
  if (authForCleanup) await safely(() => signOut(authForCleanup));
  if (customerId) {
    await safely(() =>
      pool.query("delete from user_accounts where auth_user_id=$1", [uid]),
    );
    await safely(() =>
      pool.query("delete from customers where id=$1", [customerId]),
    );
  }
  const authForAdminCleanup = adminAuth;
  if (authForAdminCleanup && emulatorUserCreated)
    await safely(() => authForAdminCleanup.deleteUser(uid));
  const appForCleanup = clientApp;
  if (appForCleanup) await safely(() => deleteFirebaseClientApp(appForCleanup));
  await safely(() => pool.end());
  if (cleanupFailed) {
    console.error(
      "LINE local smoke cleanup failed; no database or auth error details were printed.",
    );
    process.exitCode = 1;
  }
}

if (smokePassed && process.exitCode !== 1) {
  console.info(
    "LINE local smoke passed: verified link, sign-in, Firebase emulator, and customer scope.",
  );
}
