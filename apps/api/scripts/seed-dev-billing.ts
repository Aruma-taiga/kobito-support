import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Pool } from "pg";
import { isLocalInvoicePreviewEnvironment } from "../src/modules/invoices/repository.js";
import { loadConfig } from "../src/platform/config.js";

dotenv.config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
});

const config = loadConfig(process.env);
if (!isLocalInvoicePreviewEnvironment(config)) {
  throw new Error(
    "Invoice preview requires a guarded local development target",
  );
}

const pool = new Pool({ connectionString: config.databaseUrl });
try {
  await pool.query(
    `insert into settings (key, value) values ('invoice_preview_enabled', 'true'::jsonb)
     on conflict (key) do update set value = 'true'::jsonb, updated_at = now()`,
  );
  process.stdout.write(
    "Local invoice preview enabled. Company, registration, and bank details were not changed.\n",
  );
} finally {
  await pool.end();
}
