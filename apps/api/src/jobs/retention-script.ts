import { fileURLToPath } from "node:url";
import { toTokyoDate } from "@kobito/shared";
import dotenv from "dotenv";
import { Pool } from "pg";
import { loadConfig } from "../platform/config.js";
import { runRetentionPurge } from "./retention.js";

if (process.env.NODE_ENV !== "production") {
  dotenv.config({
    path: fileURLToPath(new URL("../../../../.env", import.meta.url)),
  });
}

const config = loadConfig(process.env);
const pool = new Pool({ connectionString: config.databaseUrl });
const dryRun = process.argv.includes("--dry-run");
const contractIds = process.argv
  .filter((argument) => argument.startsWith("--contract-id="))
  .map((argument) => argument.slice("--contract-id=".length));
try {
  const result = await runRetentionPurge(toTokyoDate(new Date()), pool, {
    dryRun,
    ...(contractIds.length ? { contractIds } : {}),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.failed > 0) process.exitCode = 1;
} finally {
  await pool.end();
}
