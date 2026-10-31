import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Pool } from "pg";
import { ChromiumInvoicePdfRenderer } from "../modules/invoices/renderer.js";
import { InvoiceRepository } from "../modules/invoices/repository.js";
import { loadConfig } from "../platform/config.js";
import { runDaily } from "./daily-billing.js";

if (process.env.NODE_ENV !== "production") {
  dotenv.config({
    path: fileURLToPath(new URL("../../../../.env", import.meta.url)),
  });
}

function todayInTokyo(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

const config = loadConfig(process.env);
const pool = new Pool({ connectionString: config.databaseUrl });
try {
  const result = await runDaily(
    todayInTokyo(new Date()),
    pool,
    new InvoiceRepository(pool, config, new ChromiumInvoicePdfRenderer()),
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.billing.failed > 0 || result.lifecycle.failed > 0)
    process.exitCode = 1;
} finally {
  await pool.end();
}
