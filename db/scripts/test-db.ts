import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnvironment, repositoryRoot } from "../src/load-env.js";
import { resetDatabase } from "../src/reset.js";

loadRootEnvironment();

function getTestConnectionString(environment: NodeJS.ProcessEnv): string {
  if (environment.TEST_DATABASE_URL?.trim()) {
    return environment.TEST_DATABASE_URL;
  }

  const baseConnectionString =
    environment.DATABASE_URL ??
    `postgres://${encodeURIComponent(environment.POSTGRES_USER || "kobito")}:${encodeURIComponent(environment.POSTGRES_PASSWORD || "kobito")}@127.0.0.1:${environment.POSTGRES_PORT || "5432"}/kobito_support`;
  let url: URL;
  try {
    url = new URL(baseConnectionString);
  } catch {
    throw new Error(
      "Cannot prepare database tests: DATABASE_URL is not a valid PostgreSQL URL",
    );
  }
  url.pathname = "/kobito_support_test";
  return url.toString();
}

const testConnectionString = getTestConnectionString(process.env);
try {
  await resetDatabase({
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL: testConnectionString,
  });
} catch {
  console.error(
    "Database test setup failed. Verify the loopback PostgreSQL service; connection details were not logged.",
  );
  throw new Error("Database test setup failed");
}

const vitestCli = fileURLToPath(import.meta.resolve("vitest/vitest.mjs"));
const child = spawn(
  process.execPath,
  [
    vitestCli,
    "run",
    "--config",
    resolve(repositoryRoot, "vitest.db.config.ts"),
  ],
  {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      TEST_DATABASE_URL: testConnectionString,
    },
    stdio: "inherit",
  },
);

const exitCode = await new Promise<number>((resolveExit) => {
  child.once("error", () => resolveExit(1));
  child.once("close", (code) => resolveExit(code ?? 1));
});
process.exitCode = exitCode;
