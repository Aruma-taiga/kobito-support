import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { Pool } from "pg";

dotenv.config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
});

export interface BootstrapFirebase {
  getUserByEmail(email: string): Promise<{ uid: string; disabled: boolean }>;
  createUser(input: {
    email: string;
    password: string;
  }): Promise<{ uid: string; disabled: boolean }>;
  /** メールアドレスを確認済みにする。MFA（TOTP）の登録は、確認済みでないと拒否されるため。 */
  markEmailVerified(uid: string): Promise<void>;
  generatePasswordResetLink(email: string): Promise<string>;
}

export interface BootstrapDatabase {
  ensureAdminAccount(uid: string): Promise<"admin" | "customer">;
}

export interface AdminBootstrapDependencies {
  firebase: BootstrapFirebase;
  db: BootstrapDatabase;
  write(line: string): void;
  randomPassword(): string;
  emulatorHost: string | undefined;
}

export async function bootstrapAdmin(
  email: string,
  dependencies: AdminBootstrapDependencies,
): Promise<void> {
  if (dependencies.emulatorHost) {
    throw new Error(
      "Firebase Auth emulator is configured; use seed-dev-admin instead",
    );
  }
  let user: { uid: string; disabled: boolean };
  try {
    user = await dependencies.firebase.getUserByEmail(email);
  } catch (error) {
    if ((error as { code?: string })?.code !== "auth/user-not-found")
      throw error;
    user = await dependencies.firebase.createUser({
      email,
      password: dependencies.randomPassword(),
    });
  }
  if (user.disabled) throw new Error("Firebase user is disabled");
  const accountType = await dependencies.db.ensureAdminAccount(user.uid);
  if (accountType === "customer") {
    throw new Error("Existing customer account cannot be changed to admin");
  }
  // 管理者の行が確定してから、メールを確認済みにする（無効なユーザー・顧客のアカウントには行わない）。
  await dependencies.firebase.markEmailVerified(user.uid);
  const link = await dependencies.firebase.generatePasswordResetLink(email);
  dependencies.write(
    `管理者アカウントを準備しました。パスワード設定リンク（このリンクは秘密です。チャットやログに貼らないでください）: ${link}`,
  );
}

function createDatabase(
  databaseUrl: string,
): BootstrapDatabase & { close(): Promise<void> } {
  const pool = new Pool({ connectionString: databaseUrl });
  return {
    ensureAdminAccount: async (uid) => {
      const result = await pool.query<{
        role: string;
        customer_id: string | null;
      }>(
        `insert into user_accounts (auth_user_id, customer_id, role)
         values ($1, null, 'admin')
         on conflict (auth_user_id) do nothing
         returning role, customer_id`,
        [uid],
      );
      const row =
        result.rows[0] ??
        (
          await pool.query<{ role: string; customer_id: string | null }>(
            "select role, customer_id from user_accounts where auth_user_id = $1",
            [uid],
          )
        ).rows[0];
      if (!row || row.customer_id !== null || row.role !== "admin")
        return "customer";
      return "admin";
    },
    close: () => pool.end(),
  };
}

function parseEmail(args: string[]): string {
  if (args.length !== 1 || !args[0]?.startsWith("--email=")) {
    throw new Error("Expected --email=<email>");
  }
  const email = args[0].slice("--email=".length).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("A valid --email value is required");
  }
  return email;
}

async function main(): Promise<void> {
  try {
    const email = parseEmail(process.argv.slice(2));
    if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
      throw new Error("Firebase Auth emulator is configured");
    }
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const databaseUrl = process.env.DATABASE_URL;
    if (!projectId || !databaseUrl)
      throw new Error("Required configuration is missing");
    const app =
      getApps().find(
        (candidate) => candidate.name === "kobito-admin-bootstrap",
      ) ??
      initializeApp(
        { credential: applicationDefault(), projectId },
        "kobito-admin-bootstrap",
      );
    const auth = getAuth(app);
    const db = createDatabase(databaseUrl);
    try {
      await bootstrapAdmin(email, {
        firebase: {
          getUserByEmail: (value) => auth.getUserByEmail(value),
          createUser: (input) => auth.createUser(input),
          markEmailVerified: async (uid) => {
            await auth.updateUser(uid, { emailVerified: true });
          },
          generatePasswordResetLink: (value) =>
            auth.generatePasswordResetLink(value),
        },
        db,
        write: (line) => process.stdout.write(`${line}\n`),
        randomPassword: () => randomBytes(48).toString("base64url"),
        emulatorHost: process.env.FIREBASE_AUTH_EMULATOR_HOST,
      });
    } finally {
      await db.close();
    }
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    const errorName = error instanceof Error ? error.name : "Error";
    const providerCode =
      typeof code === "string" && /^[A-Za-z0-9_/-]{1,80}$/.test(code)
        ? ` (${code})`
        : "";
    console.error(
      `管理者の準備に失敗しました: ${errorName}${providerCode}。メールアドレスや認証情報は記録していません。`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
