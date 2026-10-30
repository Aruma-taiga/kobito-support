import type { Pool } from "pg";

const PLAN_START_DATE = "2026-10-25";

const plans = [
  { code: "light", name: "ライト", price: 5000, credits: 1, custom: false },
  {
    code: "standard",
    name: "スタンダード",
    price: 10_000,
    credits: 3,
    custom: false,
  },
  {
    code: "premium",
    name: "プレミアム",
    price: 15_000,
    credits: 5,
    custom: false,
  },
  {
    code: "custom",
    name: "個別見積り",
    price: null,
    credits: null,
    custom: true,
  },
] as const;

const settingDefaults: ReadonlyArray<readonly [string, unknown]> = [
  ["service_name", "コビトサポート（kobITo Support）"],
  ["company_name", ""],
  ["company_address", ""],
  ["invoice_registration_no", ""],
  ["invoice_prefix", "KS"],
  [
    "bank_account",
    {
      bank_name: "",
      branch_name: "",
      account_type: "",
      account_number: "",
      account_holder: "",
    },
  ],
  ["konbini_fee_yen", null],
];

export async function seedDatabase(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const plan of plans) {
      await client.query(
        `insert into plans (code, name, price_incl_tax, credits, is_custom, valid_from)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (code, valid_from) do nothing`,
        [
          plan.code,
          plan.name,
          plan.price,
          plan.credits,
          plan.custom,
          PLAN_START_DATE,
        ],
      );
    }
    for (const [key, value] of settingDefaults) {
      await client.query(
        `insert into settings (key, value)
         values ($1, $2::jsonb)
         on conflict (key) do nothing`,
        [key, JSON.stringify(value)],
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
