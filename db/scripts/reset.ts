import { loadRootEnvironment } from "../src/load-env.js";
import { resetDatabase } from "../src/reset.js";

loadRootEnvironment();
try {
  await resetDatabase(process.env);
  console.info("Local database reset, migration, and seed complete.");
} catch {
  console.error(
    "Database reset refused or failed. Review local settings; connection details were not logged.",
  );
  process.exitCode = 1;
}
