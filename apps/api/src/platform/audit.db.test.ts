import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { withAdminAudit } from "./audit.js";
import type { Principal } from "./types.js";

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const admin: Principal = {
  authUserId: `api-audit-${crypto.randomUUID()}`,
  role: "admin",
  customerId: null,
  secondFactor: "phone",
};
const keyPrefix = `api_audit_test_${crypto.randomUUID()}`;

afterAll(async () => {
  await pool.query("delete from settings where key like $1", [`${keyPrefix}%`]);
  await pool.query("delete from audit_logs where actor = $1", [
    admin.authUserId,
  ]);
  await pool.end();
});

describe("admin audit transactions", () => {
  it("commits the operation and allowlisted audit detail together", async () => {
    const settingKey = `${keyPrefix}_success`;
    await withAdminAudit(
      pool,
      admin,
      {
        action: "test.setting.update",
        targetType: "setting",
        targetId: settingKey,
        detail: { reasonCode: "approved", requestBody: "must-not-persist" },
      },
      async (client) => {
        await client.query(
          "insert into settings (key, value) values ($1, 'true'::jsonb)",
          [settingKey],
        );
      },
    );

    const result = await pool.query(
      "select s.key, a.actor, a.action, a.detail from settings s join audit_logs a on a.target_id = s.key where s.key = $1",
      [settingKey],
    );
    expect(result.rows).toEqual([
      {
        key: settingKey,
        actor: admin.authUserId,
        action: "test.setting.update",
        detail: { reasonCode: "approved" },
      },
    ]);
  });

  it("rolls back a successful write when audit persistence fails after it", async () => {
    const settingKey = `${keyPrefix}_rollback`;
    let businessWriteCompleted = false;
    const failingPool = {
      connect: async () => {
        const client = await pool.connect();
        return new Proxy(client, {
          get(target, property) {
            if (property === "query") {
              return (query: string, ...args: unknown[]) => {
                if (query.includes("insert into audit_logs")) {
                  throw new Error("simulated audit storage failure");
                }
                return Reflect.apply(target.query, target, [query, ...args]);
              };
            }
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    } as unknown as Pool;
    await expect(
      withAdminAudit(
        failingPool,
        admin,
        {
          action: "test.setting.update",
          targetType: "setting",
          targetId: settingKey,
          detail: {},
        },
        async (client) => {
          await client.query(
            "insert into settings (key, value) values ($1, 'true'::jsonb)",
            [settingKey],
          );
          businessWriteCompleted = true;
        },
      ),
    ).rejects.toThrow("simulated audit storage failure");
    expect(businessWriteCompleted).toBe(true);
    const result = await pool.query(
      "select count(*)::int as count from settings where key = $1",
      [settingKey],
    );
    expect(result.rows[0]?.count).toBe(0);
  });

  it("rejects admins without second-factor evidence before writes", async () => {
    const withoutSecondFactor = { ...admin, secondFactor: null };
    await expect(
      withAdminAudit(
        pool,
        withoutSecondFactor,
        { action: "test.denied", targetType: "setting", targetId: keyPrefix },
        async () => "unexpected",
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});
