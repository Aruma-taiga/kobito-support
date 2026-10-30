import { createPool } from "../src/connection.js";
import { loadRootEnvironment } from "../src/load-env.js";
import { seedDatabase } from "../src/seed.js";

loadRootEnvironment();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const pool = createPool(connectionString);
try {
  await seedDatabase(pool);
  console.info("Database seed complete.");
} catch {
  console.error("Database seed failed. Connection details were not logged.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
