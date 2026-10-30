import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { customerScopeFor } from "../../../platform/scope.js";
import { PostgresLineRepository } from "./repository.js";

const pool = new Pool({
  connectionString:
    process.env.TEST_DATABASE_URL ??
    "postgres://kobito:kobito@127.0.0.1:5432/kobito_support_test",
  options: "-c timezone=Asia/Tokyo",
});
const prefix = `line-${randomUUID()}`;
const customerIds: string[] = [];
const authUserIds: string[] = [];
const repo = new PostgresLineRepository(pool);
async function customer() {
  const result = await pool.query<{ id: string }>(
    "insert into customers(shop_name,contact_name,billing_name,billing_address,email) values($1,'担当者','請求先','住所',$2) returning id",
    [`${prefix}-${randomUUID()}`, `${randomUUID()}@example.test`],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Expected customer fixture row");
  const id = row.id;
  customerIds.push(id);
  return {
    id,
    scope: customerScopeFor({
      authUserId: `uid-${id}`,
      role: "customer",
      customerId: id,
      secondFactor: null,
    }),
  };
}

describe("LINE customer linking transaction", () => {
  it("allows an idempotent relink but refuses a different LINE identity", async () => {
    const c = await customer();
    await repo.link(c.scope, `${prefix}-one`);
    await expect(repo.link(c.scope, `${prefix}-one`)).resolves.toBeUndefined();
    await expect(repo.link(c.scope, `${prefix}-two`)).rejects.toMatchObject({
      status: 409,
      code: "conflict",
    });
    expect(await repo.status(c.scope)).toBe(true);
  });

  it("maps a different customer's unique LINE identity collision to conflict", async () => {
    const [a, b] = await Promise.all([customer(), customer()]);
    const sharedId = `${prefix}-shared`;
    const results = await Promise.allSettled([
      repo.link(a.scope, sharedId),
      repo.link(b.scope, sharedId),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter(
        (result) =>
          result.status === "rejected" &&
          "code" in result.reason &&
          result.reason.code === "conflict",
      ),
    ).toHaveLength(1);
  });

  it("serializes concurrent attempts to link two identities to one customer", async () => {
    const c = await customer();
    const results = await Promise.allSettled([
      repo.link(c.scope, `${prefix}-left`),
      repo.link(c.scope, `${prefix}-right`),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter(
        (result) =>
          result.status === "rejected" &&
          "code" in result.reason &&
          result.reason.code === "conflict",
      ),
    ).toHaveLength(1);
  });

  it("re-reads the locked customer row after a competing transaction commits a different LINE ID", async () => {
    const c = await customer();
    const blocker = await pool.connect();
    let waitingLink: Promise<void> | undefined;
    try {
      await blocker.query("begin");
      await blocker.query("select id from customers where id=$1 for update", [
        c.id,
      ]);
      waitingLink = repo.link(c.scope, `${prefix}-waiting`);
      let observedLockWait = false;
      const deadline = Date.now() + 5_000;
      while (!observedLockWait && Date.now() < deadline) {
        const activity = await pool.query<{ waiting: boolean }>(
          `select exists(
             select 1 from pg_stat_activity
             where wait_event_type='Lock'
               and query like 'select line_user_id from customers%'
               and pid <> pg_backend_pid()
           ) as waiting`,
        );
        observedLockWait = activity.rows[0]?.waiting ?? false;
        if (!observedLockWait)
          await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(observedLockWait).toBe(true);
      await blocker.query("update customers set line_user_id=$2 where id=$1", [
        c.id,
        `${prefix}-winner`,
      ]);
      await blocker.query("commit");
      await expect(waitingLink).rejects.toMatchObject({
        status: 409,
        code: "conflict",
      });
      expect(await repo.status(c.scope)).toBe(true);
    } catch (error) {
      await blocker.query("rollback");
      await waitingLink?.catch(() => undefined);
      throw error;
    } finally {
      blocker.release();
    }
  });

  it("rejects linking an anonymized customer", async () => {
    const c = await customer();
    await pool.query("update customers set anonymized_at=now() where id=$1", [
      c.id,
    ]);
    await expect(repo.link(c.scope, `${prefix}-anon`)).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
  });

  it("only resolves customer-role accounts for non-anonymized linked customers, deterministically", async () => {
    const c = await customer();
    const lineId = `${prefix}-resolve`;
    await repo.link(c.scope, lineId);
    const alpha = `${prefix}-alpha`;
    const zeta = `${prefix}-zeta`;
    authUserIds.push(alpha, zeta);
    await pool.query(
      "insert into user_accounts(auth_user_id,customer_id,role,created_at) values($1,$2,'customer','2025-01-01'),($3,$2,'customer','2025-01-01'),($4,$2,'admin','2025-01-01')",
      [zeta, c.id, alpha, `${prefix}-admin`],
    );
    authUserIds.push(`${prefix}-admin`);
    expect(await repo.findLinkedAccount(lineId)).toEqual({ authUserId: alpha });
    await pool.query("update customers set anonymized_at=now() where id=$1", [
      c.id,
    ]);
    expect(await repo.findLinkedAccount(lineId)).toBeUndefined();
  });
});

afterAll(async () => {
  if (authUserIds.length)
    await pool.query(
      "delete from user_accounts where auth_user_id = any($1::text[])",
      [authUserIds],
    );
  if (customerIds.length)
    await pool.query("delete from customers where id = any($1::uuid[])", [
      customerIds,
    ]);
  await pool.end();
});
