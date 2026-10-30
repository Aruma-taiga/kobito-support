import { createPool } from "./connection.js";
import { runMigrations } from "./migrator.js";
import { seedDatabase } from "./seed.js";

export interface ResetTarget {
  databaseName: "kobito_support" | "kobito_support_test";
  databaseUrl: string;
  maintenanceUrl: string;
}

interface MaintenancePool {
  query: (sql: string) => Promise<unknown>;
  end: () => Promise<void>;
}

export interface ResetDependencies {
  connectMaintenance: (
    connectionString: string,
  ) => MaintenancePool | Promise<MaintenancePool>;
  migrate: (connectionString: string) => Promise<unknown>;
  seed: (connectionString: string) => Promise<void>;
}

export function validateResetTarget(
  environment: Record<string, string | undefined>,
): ResetTarget {
  const nodeEnvironment = environment.NODE_ENV;
  const connectionString = environment.DATABASE_URL;
  if (
    !connectionString ||
    (nodeEnvironment !== "development" && nodeEnvironment !== "test")
  ) {
    throw new Error(
      "Database reset refused: a local development or test environment is required",
    );
  }

  let url: URL;
  let databaseName: string;
  try {
    url = new URL(connectionString);
    databaseName = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new Error(
      "Database reset refused: DATABASE_URL must be a valid local PostgreSQL URL",
    );
  }

  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  const expectedName =
    nodeEnvironment === "development"
      ? "kobito_support"
      : "kobito_support_test";
  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
    !localHosts.has(url.hostname) ||
    databaseName !== expectedName ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error(
      "Database reset refused: only the local kobito_support database may be reset",
    );
  }

  url.pathname = `/${databaseName}`;
  const databaseUrl = url.toString();
  url.pathname = "/postgres";
  return {
    databaseName,
    databaseUrl,
    maintenanceUrl: url.toString(),
  };
}

const defaultDependencies: ResetDependencies = {
  connectMaintenance: (connectionString) => {
    return createPool(connectionString, {
      max: 1,
      connectionTimeoutMillis: 500,
    });
  },
  migrate: async (connectionString) => {
    const pool = createPool(connectionString);
    try {
      return await runMigrations(
        pool,
        new URL("../migrations/", import.meta.url),
      );
    } finally {
      await pool.end();
    }
  },
  seed: async (connectionString) => {
    const pool = createPool(connectionString);
    try {
      await seedDatabase(pool);
    } finally {
      await pool.end();
    }
  },
};

function isTransientConnectionError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  const code = error.code;
  return (
    typeof code === "string" &&
    (code.startsWith("ECONN") ||
      code === "EHOSTUNREACH" ||
      code === "ETIMEDOUT" ||
      code === "57P03")
  );
}

async function waitForMaintenanceConnection(
  connectionString: string,
  connect: ResetDependencies["connectMaintenance"],
): Promise<MaintenancePool> {
  const attempts = 30;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let maintenance: MaintenancePool | undefined;
    try {
      maintenance = await connect(connectionString);
      await maintenance.query("select 1");
      return maintenance;
    } catch (error) {
      await maintenance?.end();
      if (!isTransientConnectionError(error) || attempt === attempts - 1) {
        throw new Error(
          "Local PostgreSQL did not become ready; no database reset was performed",
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(
    "Local PostgreSQL did not become ready; no database reset was performed",
  );
}

export async function resetDatabase(
  environment: Record<string, string | undefined>,
  dependencies: ResetDependencies = defaultDependencies,
): Promise<void> {
  // Validate before constructing any pool or opening a connection.
  const target = validateResetTarget(environment);
  const maintenance = await waitForMaintenanceConnection(
    target.maintenanceUrl,
    dependencies.connectMaintenance,
  );
  try {
    const quotedName = `"${target.databaseName}"`;
    await maintenance.query(
      `drop database if exists ${quotedName} with (force)`,
    );
    await maintenance.query(`create database ${quotedName}`);
  } finally {
    await maintenance.end();
  }
  await dependencies.migrate(target.databaseUrl);
  await dependencies.seed(target.databaseUrl);
}
