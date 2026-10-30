import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient } from "pg";

const LOCK_NAMESPACE = 1_264_057_666;
const LOCK_ID = 1;

interface MigrationFile {
  version: string;
  name: string;
  checksum: string;
  sql: string;
}

interface AppliedMigration {
  version: string;
  name: string;
  checksum: string;
}

async function readMigrations(
  directory: string | URL,
): Promise<MigrationFile[]> {
  const directoryPath =
    directory instanceof URL ? fileURLToPath(directory) : directory;
  const files = (await readdir(directoryPath))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const migrations: MigrationFile[] = [];
  for (const file of files) {
    const match = /^(\d{3,})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/.exec(file);
    if (!match?.[1] || !match[2]) {
      throw new Error(`Invalid migration filename: ${file}`);
    }
    const contents = await readFile(join(directoryPath, file));
    migrations.push({
      version: match[1],
      name: match[2],
      checksum: createHash("sha256").update(contents).digest("hex"),
      sql: contents.toString("utf8"),
    });
  }
  if (
    new Set(migrations.map(({ version }) => version)).size !== migrations.length
  ) {
    throw new Error("Migration versions must be unique");
  }
  return migrations;
}

async function ensureHistoryTable(client: PoolClient): Promise<void> {
  await client.query(`
    create table if not exists schema_migrations (
      version text primary key,
      name text not null,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);
}

export async function runMigrations(
  pool: Pool,
  directory: string | URL,
): Promise<{ applied: number }> {
  const migrations = await readMigrations(directory);
  const client = await pool.connect();
  let lockAcquired = false;
  let applied = 0;

  try {
    await client.query("select pg_advisory_lock($1, $2)", [
      LOCK_NAMESPACE,
      LOCK_ID,
    ]);
    lockAcquired = true;
    await ensureHistoryTable(client);

    const history = await client.query<AppliedMigration>(
      "select version, name, checksum from schema_migrations order by version",
    );
    const currentByVersion = new Map(
      migrations.map((migration) => [migration.version, migration]),
    );
    for (const record of history.rows) {
      const current = currentByVersion.get(record.version);
      if (!current) {
        throw new Error(
          `Applied migration ${record.version} is missing from the migration directory`,
        );
      }
      if (
        record.name !== current.name ||
        record.checksum !== current.checksum
      ) {
        throw new Error(
          `Migration checksum mismatch for ${record.version}_${record.name}`,
        );
      }
    }

    const appliedVersions = new Set(history.rows.map(({ version }) => version));
    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) continue;

      await client.query("begin");
      try {
        await client.query(migration.sql);
        await client.query(
          "insert into schema_migrations (version, name, checksum) values ($1, $2, $3)",
          [migration.version, migration.name, migration.checksum],
        );
        await client.query("commit");
        applied += 1;
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }
    return { applied };
  } finally {
    if (lockAcquired) {
      await client.query("select pg_advisory_unlock($1, $2)", [
        LOCK_NAMESPACE,
        LOCK_ID,
      ]);
    }
    client.release();
  }
}
