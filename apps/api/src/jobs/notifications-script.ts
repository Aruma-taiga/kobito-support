import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Pool } from "pg";
import { ResendMailSender } from "../integrations/mail/resend.js";
import { LogMailSender } from "../integrations/mail/sender.js";
import { loadConfig } from "../platform/config.js";
import { runNotificationDispatch } from "./notifications.js";

if (process.env.NODE_ENV !== "production") {
  dotenv.config({
    path: fileURLToPath(new URL("../../../../.env", import.meta.url)),
  });
}

const config = loadConfig(process.env);
const pool = new Pool({ connectionString: config.databaseUrl });
try {
  const result = await runNotificationDispatch(new Date(), {
    pool,
    ...(config.mailProvider === "log" ? { sender: new LogMailSender() } : {}),
    ...(config.mailProvider === "resend" &&
    config.resendApiKey &&
    config.mailFrom
      ? { sender: new ResendMailSender(config.resendApiKey, config.mailFrom) }
      : {}),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.failed > 0) process.exitCode = 1;
} finally {
  await pool.end();
}
