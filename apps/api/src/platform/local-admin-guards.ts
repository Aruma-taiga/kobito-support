import { z } from "zod";
import type { RuntimeConfig } from "./config.js";

const credentialsSchema = z
  .object({
    email: z.string().trim().email(),
    password: z.string().min(12).max(128),
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
  })
  .strict();

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function validateLocalAdminSeedTarget(
  config: RuntimeConfig,
  credentials: { email: string; password: string; phone: string },
): { authEmulatorOrigin: string } {
  if (!credentialsSchema.safeParse(credentials).success) {
    throw new Error("Local admin tools require development credentials");
  }

  let emulator: URL;
  let database: URL;
  try {
    emulator = new URL(`http://${config.authEmulatorHost ?? ""}`);
    database = new URL(config.databaseUrl);
  } catch {
    throw new Error(
      "Local admin tools require the demo emulator and loopback kobito_support database",
    );
  }

  const safeEmulator =
    loopbackHosts.has(emulator.hostname) &&
    emulator.port === "9099" &&
    emulator.pathname === "/" &&
    !emulator.username &&
    !emulator.password &&
    !emulator.search &&
    !emulator.hash;
  const databaseName = decodeURIComponent(database.pathname.slice(1));
  const safeDatabase =
    (database.protocol === "postgres:" ||
      database.protocol === "postgresql:") &&
    loopbackHosts.has(database.hostname) &&
    databaseName === "kobito_support" &&
    !database.search &&
    !database.hash;

  if (
    config.nodeEnv !== "development" ||
    !config.firebaseProjectId.startsWith("demo-") ||
    !safeEmulator ||
    !safeDatabase
  ) {
    throw new Error(
      "Local admin tools require the demo emulator and loopback kobito_support database",
    );
  }
  return { authEmulatorOrigin: emulator.origin };
}
