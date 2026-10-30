import { createPool } from "../src/connection.js";
import { loadRootEnvironment } from "../src/load-env.js";
import { runMigrations } from "../src/migrator.js";

loadRootEnvironment();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const pool = createPool(connectionString);
try {
  const result = await runMigrations(
    pool,
    new URL("../migrations/", import.meta.url),
  );
  console.info(`Database migrations complete (${result.applied} applied).`);
} catch {
  console.error(
    "Database migration failed. Connection details were not logged.",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
