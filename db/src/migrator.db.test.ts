import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool } from "./connection.js";
import { runMigrations } from "./migrator.js";
import { seedDatabase } from "./seed.js";

const migrationDirectory = new URL("../migrations/", import.meta.url);
let pool: Pool;

beforeAll(() => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "TEST_DATABASE_URL must point to the isolated kobito_support_test database",
    );
  }
  pool = new Pool({ connectionString });
});

afterAll(async () => {
  await pool?.end();
});

describe("PostgreSQL migrations and seed", () => {
  it("preserves the approved schema source and records a checksum", async () => {
    const source = await readFile(
      new URL("../../docs/schema-v1.sql", import.meta.url),
    );
    const copied = await readFile(
      new URL("../migrations/001_initial.sql", import.meta.url),
    );
    expect(copied.equals(source)).toBe(true);
    const secondMigration = await readFile(
      new URL("../migrations/002_application_submissions.sql", import.meta.url),
    );
    const thirdMigration = await readFile(
      new URL("../migrations/003_initial_invoices.sql", import.meta.url),
    );
    const fourthMigration = await readFile(
      new URL("../migrations/004_komoju_webhook_inbox.sql", import.meta.url),
    );

    const recorded = await pool.query<{ version: string; checksum: string }>(
      "select version, checksum from schema_migrations order by version",
    );
    expect(recorded.rows).toEqual([
      {
        version: "001",
        checksum: createHash("sha256").update(source).digest("hex"),
      },
      {
        version: "002",
        checksum: createHash("sha256").update(secondMigration).digest("hex"),
      },
      {
        version: "003",
        checksum: createHash("sha256").update(thirdMigration).digest("hex"),
      },
      {
        version: "004",
        checksum: createHash("sha256").update(fourthMigration).digest("hex"),
      },
    ]);
  });

  it("reruns safely without applying schema changes twice", async () => {
    const before = await pool.query<{ count: string }>(
      "select count(*)::text as count from schema_migrations",
    );
    expect((await runMigrations(pool, migrationDirectory)).applied).toBe(0);
    expect((await runMigrations(pool, migrationDirectory)).applied).toBe(0);
    const after = await pool.query<{ count: string }>(
      "select count(*)::text as count from schema_migrations",
    );
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });

  it("uses the explicit test URL despite PGHOST and PGDATABASE environment overrides", async () => {
    const originalHost = process.env.PGHOST;
    const originalDatabase = process.env.PGDATABASE;
    process.env.PGHOST = "remote.invalid";
    process.env.PGDATABASE = "customer_data";
    const explicitUrlPool = createPool(process.env.TEST_DATABASE_URL as string);
    try {
      const result = await explicitUrlPool.query<{ database_name: string }>(
        "select current_database() as database_name",
      );
      expect(result.rows[0]?.database_name).toBe("kobito_support_test");
    } finally {
      await explicitUrlPool.end();
      if (originalHost === undefined) delete process.env.PGHOST;
      else process.env.PGHOST = originalHost;
      if (originalDatabase === undefined) delete process.env.PGDATABASE;
      else process.env.PGDATABASE = originalDatabase;
    }
  });

  it("seeds four plans and configurable defaults idempotently", async () => {
    await seedDatabase(pool);
    await seedDatabase(pool);

    const plans = await pool.query(
      "select code, name, price_incl_tax, credits, is_custom from plans order by code",
    );
    expect(plans.rows).toEqual([
      {
        code: "custom",
        name: "個別見積り",
        price_incl_tax: null,
        credits: null,
        is_custom: true,
      },
      {
        code: "light",
        name: "ライト",
        price_incl_tax: 5000,
        credits: 1,
        is_custom: false,
      },
      {
        code: "premium",
        name: "プレミアム",
        price_incl_tax: 15000,
        credits: 5,
        is_custom: false,
      },
      {
        code: "standard",
        name: "スタンダード",
        price_incl_tax: 10000,
        credits: 3,
        is_custom: false,
      },
    ]);

    const settings = await pool.query<{ key: string; value: unknown }>(
      "select key, value from settings order by key",
    );
    expect(
      Object.fromEntries(settings.rows.map(({ key, value }) => [key, value])),
    ).toEqual({
      bank_account: {
        account_holder: "",
        account_number: "",
        account_type: "",
        bank_name: "",
        branch_name: "",
      },
      company_address: "",
      company_name: "",
      invoice_prefix: "KS",
      invoice_registration_no: "",
      konbini_fee_yen: null,
      service_name: "コビトサポート（kobITo Support）",
    });

    try {
      await pool.query(
        "update settings set value = to_jsonb('Owner-edited name'::text) where key = 'service_name'",
      );
      await seedDatabase(pool);
      const preserved = await pool.query<{ value: string }>(
        "select value #>> '{}' as value from settings where key = 'service_name'",
      );
      expect(preserved.rows[0]?.value).toBe("Owner-edited name");
    } finally {
      await pool.query(
        "update settings set value = to_jsonb($1::text) where key = 'service_name'",
        ["コビトサポート（kobITo Support）"],
      );
    }
  });

  it("rolls back every statement in a failed migration transaction", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "kobito-migration-rollback-"),
    );
    try {
      await copyAppliedMigrations(directory);
      await writeFile(
        join(directory, "005_partial_failure.sql"),
        "create table migration_partial_failure (id integer); select 1 / 0;",
      );

      await expect(runMigrations(pool, directory)).rejects.toThrow();
      const marker = await pool.query<{ relation: string | null }>(
        "select to_regclass('migration_partial_failure')::text as relation",
      );
      const history = await pool.query<{ count: string }>(
        "select count(*)::text as count from schema_migrations where version = '005'",
      );
      expect(marker.rows[0]?.relation).toBeNull();
      expect(history.rows[0]?.count).toBe("0");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects checksum drift for an already applied migration", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "kobito-migration-checksum-"),
    );
    try {
      await copyAppliedMigrations(directory);
      const initial = await readFile(
        new URL("../migrations/001_initial.sql", import.meta.url),
        "utf8",
      );
      await writeFile(
        join(directory, "001_initial.sql"),
        `${initial}\n-- changed after applying\n`,
      );
      await expect(runMigrations(pool, directory)).rejects.toThrow(/checksum/i);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("serializes concurrent runners with a PostgreSQL advisory lock", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kobito-migration-lock-"));
    const marker = `migration_lock_${process.pid}`;
    try {
      await copyAppliedMigrations(directory);
      await writeFile(
        join(directory, `999_lock_${process.pid}.sql`),
        `select pg_sleep(0.15); create table ${marker} (id integer primary key); insert into ${marker} values (1);`,
      );
      const [left, right] = await Promise.all([
        runMigrations(pool, directory),
        runMigrations(pool, directory),
      ]);
      expect(left.applied + right.applied).toBe(1);
      const count = await pool.query<{ count: string }>(
        `select count(*)::text as count from ${marker}`,
      );
      expect(count.rows[0]?.count).toBe("1");
    } finally {
      await pool.query("delete from schema_migrations where version = '999'");
      await pool.query(`drop table if exists ${marker}`);
      await rm(directory, { recursive: true, force: true });
    }
  });
});

async function copyAppliedMigrations(directory: string): Promise<void> {
  for (const [version, name] of [
    ["001", "initial"],
    ["002", "application_submissions"],
    ["003", "initial_invoices"],
    ["004", "komoju_webhook_inbox"],
  ]) {
    const filename = `${version}_${name}.sql`;
    const sql = await readFile(
      new URL(`../migrations/${filename}`, import.meta.url),
      "utf8",
    );
    await writeFile(join(directory, filename), sql);
  }
}
