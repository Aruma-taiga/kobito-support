import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { getApps } from "firebase-admin/app";
import { getAuth, type UserRecord } from "firebase-admin/auth";
import { Pool } from "pg";
import { createFirebaseVerifier } from "../src/platform/auth.js";
import { loadConfig } from "../src/platform/config.js";
import { withTransaction } from "../src/platform/db/transaction.js";
import { validateLocalAdminSeedTarget } from "../src/platform/local-admin-guards.js";
import { localAdminMfaSettings } from "../src/platform/local-admin-mfa.js";

dotenv.config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
});

let failureStage = "configuration";
let failureCode = "unknown";

function safeProviderCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Za-z0-9_/-]{1,80}$/.test(error.code)
  ) {
    return error.code;
  }
  return "unknown";
}

async function seedLocalAdmin(): Promise<void> {
  const config = loadConfig(process.env);
  const credentials = {
    email: process.env.DEV_ADMIN_EMAIL?.trim() ?? "",
    password: process.env.DEV_ADMIN_PASSWORD ?? "",
    phone: process.env.DEV_ADMIN_PHONE?.trim() ?? "",
  };
  validateLocalAdminSeedTarget(config, credentials);
  failureStage = "Firebase emulator initialization";
  createFirebaseVerifier(config);
  const firebaseApp = getApps().find(
    (candidate) => candidate.name === "kobito-api",
  );
  if (!firebaseApp)
    throw new Error("Local Firebase admin initialization failed");
  const auth = getAuth(firebaseApp);
  let user: UserRecord;
  failureStage = "Firebase emulator user lookup";
  try {
    user = await auth.getUserByEmail(credentials.email);
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      error.code !== "auth/user-not-found"
    ) {
      throw new Error("Local Firebase admin lookup failed");
    }
    try {
      user = await auth.createUser({
        email: credentials.email,
        password: credentials.password,
        emailVerified: true,
      });
    } catch {
      throw new Error("Local Firebase admin creation failed");
    }
  }
  if (user.disabled)
    throw new Error("Local Firebase admin account is disabled");

  failureStage = "local database role guard";
  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    const existing = await pool.query<{
      role: string;
      customer_id: string | null;
    }>("select role, customer_id from user_accounts where auth_user_id = $1", [
      user.uid,
    ]);
    const account = existing.rows[0];
    if (account && (account.role !== "admin" || account.customer_id !== null)) {
      throw new Error("Refusing to change a customer account into an admin");
    }

    failureStage = "Firebase emulator MFA setup";
    try {
      await auth.updateUser(user.uid, {
        password: credentials.password,
        emailVerified: true,
        multiFactor: localAdminMfaSettings(credentials.phone),
      });
    } catch (error) {
      failureCode = safeProviderCode(error);
      throw new Error("Local Firebase admin MFA provisioning failed");
    }

    failureStage = "local database admin link";
    await withTransaction(pool, async (client) => {
      await client.query(
        `insert into user_accounts (auth_user_id, customer_id, role)
         values ($1, null, 'admin')
         on conflict (auth_user_id) do nothing`,
        [user.uid],
      );
      const linked = await client.query<{
        role: string;
        customer_id: string | null;
      }>(
        "select role, customer_id from user_accounts where auth_user_id = $1",
        [user.uid],
      );
      if (
        linked.rows[0]?.role !== "admin" ||
        linked.rows[0].customer_id !== null
      ) {
        throw new Error("Local admin account is not linked safely");
      }
    });
    console.info("Local admin account and phone MFA are ready.");
  } finally {
    await pool.end();
  }
}

try {
  await seedLocalAdmin();
} catch {
  console.error(
    `Local admin setup failed during ${failureStage} (${failureCode}); credentials and provider details were not logged.`,
  );
  process.exitCode = 1;
}
