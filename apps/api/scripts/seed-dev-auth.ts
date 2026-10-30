import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { getApps } from "firebase-admin/app";
import { getAuth, type UserRecord } from "firebase-admin/auth";
import { Pool } from "pg";
import { createFirebaseVerifier } from "../src/platform/auth.js";
import { loadConfig } from "../src/platform/config.js";
import { withTransaction } from "../src/platform/db/transaction.js";

dotenv.config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
});
const config = loadConfig(process.env);
const email = process.env.DEV_AUTH_EMAIL?.trim();
const password = process.env.DEV_AUTH_PASSWORD;
if (
  config.nodeEnv !== "development" ||
  !config.firebaseProjectId.startsWith("demo-") ||
  !config.authEmulatorHost ||
  !email ||
  !password
) {
  throw new Error(
    "Dev auth seed requires development mode, a demo project, local auth emulator, and DEV_AUTH_EMAIL/PASSWORD",
  );
}
const emulator = new URL(`http://${config.authEmulatorHost}`);
if (!["localhost", "127.0.0.1", "[::1]"].includes(emulator.hostname)) {
  throw new Error("Dev auth seed requires a loopback emulator host");
}
const database = new URL(config.databaseUrl);
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) ||
  decodeURIComponent(database.pathname.slice(1)) !== "kobito_support" ||
  database.search.length > 0 ||
  database.hash.length > 0
) {
  throw new Error("Dev auth seed requires the local kobito_support database");
}

createFirebaseVerifier(config);
const firebaseApp = getApps().find(
  (candidate) => candidate.name === "kobito-api",
);
if (!firebaseApp)
  throw new Error("Firebase development app initialization failed");
const auth = getAuth(firebaseApp);
let user: UserRecord;
try {
  user = await auth.getUserByEmail(email);
} catch (error) {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    error.code !== "auth/user-not-found"
  ) {
    throw new Error(
      "Local Firebase emulator could not find the development user",
    );
  }
  try {
    user = await auth.createUser({ email, password, emailVerified: true });
  } catch {
    throw new Error("Local Firebase emulator user creation failed");
  }
}

const pool = new Pool({ connectionString: config.databaseUrl });
try {
  await withTransaction(pool, async (client) => {
    const existingAccount = await client.query<{
      customer_id: string | null;
      role: string;
    }>("select customer_id, role from user_accounts where auth_user_id = $1", [
      user.uid,
    ]);
    if (existingAccount.rows[0]?.role === "admin") {
      throw new Error("Refusing to replace a local admin account");
    }
    let customerId = existingAccount.rows[0]?.customer_id;
    if (!customerId) {
      const matchingCustomer = await client.query<{ id: string }>(
        "select id from customers where email = $1 order by created_at limit 1",
        [email],
      );
      customerId = matchingCustomer.rows[0]?.id;
    }
    if (!customerId) {
      const customer = await client.query<{ id: string }>(
        `insert into customers (shop_name, contact_name, billing_name, billing_address, email)
         values ($1, $2, $3, $4, $5) returning id`,
        [
          "ローカル開発用店舗",
          "ローカル開発用担当者",
          "ローカル開発用",
          "ローカル開発用住所",
          email,
        ],
      );
      const insertedCustomerId = customer.rows[0]?.id;
      if (!insertedCustomerId)
        throw new Error("Local customer insert returned no ID");
      customerId = insertedCustomerId;
    }
    await client.query(
      `insert into user_accounts (auth_user_id, customer_id, role)
       values ($1, $2, 'customer')
       on conflict (auth_user_id) do update
         set customer_id = excluded.customer_id, role = 'customer'`,
      [user.uid, customerId],
    );
  });
  console.info("Local emulator user is linked to a development customer.");
} catch {
  console.error(
    "Local emulator account seed failed; database details were not logged.",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
