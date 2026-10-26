import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import dotenv from "dotenv";
import { Pool } from "pg";
import { createApp } from "./app.js";
import { AccountsRepository } from "./modules/accounts/repository.js";
import { AdminRepository } from "./modules/admin/repository.js";
import { AdminService } from "./modules/admin/service.js";
import { ApplicationsRepository } from "./modules/applications/repository.js";
import { ApplicationsService } from "./modules/applications/service.js";
import { createFirebaseVerifier } from "./platform/auth.js";
import { loadConfig } from "./platform/config.js";
import { consoleLogger } from "./platform/logger.js";
import { PublicSettingsRepository } from "./platform/settings.js";

if (process.env.NODE_ENV !== "production") {
  dotenv.config({
    path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  });
}

const config = loadConfig(process.env);
const verifier = createFirebaseVerifier(config);
const pool = new Pool({ connectionString: config.databaseUrl });
const accounts = new AccountsRepository(pool);
const applications = new ApplicationsService(
  new ApplicationsRepository(pool),
  config,
);
const app = createApp({
  config,
  verifier,
  accounts,
  applications,
  admin: new AdminService(new AdminRepository(pool)),
  publicSettings: new PublicSettingsRepository(pool),
  logger: consoleLogger,
});

const server = serve({
  fetch: app.fetch,
  hostname: "0.0.0.0",
  port: config.port,
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      void pool.end().finally(() => process.exit(0));
    });
  });
}
