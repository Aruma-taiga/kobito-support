import { randomUUID } from "node:crypto";
import { adminReferralsResponseSchema } from "@kobito/shared";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AppDependencies, createApp } from "../../app.js";
import type { VerifiedIdentity } from "../../platform/auth.js";
import type { RuntimeConfig } from "../../platform/config.js";
import { AccountsRepository } from "../accounts/repository.js";
import { AdminRepository } from "../admin/repository.js";
import { AdminService } from "../admin/service.js";
import { PostgresCustomerAccessRepository } from "../customer-access/repository.js";
import { CustomerAccessService } from "../customer-access/service.js";
import { InvoiceRepository } from "../invoices/repository.js";
import { InvoiceService } from "../invoices/service.js";
import { ReferralRepository } from "./repository.js";
import { ReferralService } from "./service.js";

const connectionString =
  process.env.TEST_DATABASE_URL ??
  "postgres://kobito:kobito@127.0.0.1:5432/kobito_support_test";
const pool = new Pool({ connectionString });
const prefix = `referral-${randomUUID()}`;
const identities = new Map<string, VerifiedIdentity>();
const adminUid = `${prefix}-admin`;
const adminToken = `${prefix}-admin-token`;
const noMfaUid = `${prefix}-no-mfa`;
const noMfaToken = `${prefix}-no-mfa-token`;
const customerUid = `${prefix}-customer`;
const customerToken = `${prefix}-customer-token`;
const config: RuntimeConfig = {
  nodeEnv: "test",
  databaseUrl: connectionString,
  firebaseProjectId: "demo-kobito-support",
  webOrigin: "http://localhost:5173",
  port: 3000,
  invoicePrefix: "KS",
  authEmulatorHost: "127.0.0.1:9099",
};
const now = () => new Date("2026-11-14T03:00:00.000Z");
const ids = {
  customers: [] as string[],
  plans: [] as string[],
  applications: [] as string[],
  contracts: [] as string[],
  invoices: [] as string[],
  payments: [] as string[],
  partners: [] as string[],
  referrals: [] as string[],
};

function requireRow<T>(row: T | undefined): T {
  if (!row) throw new Error("Expected test database row");
  return row;
}

function makeApp() {
  const invoiceRepository = new InvoiceRepository(
    pool,
    config,
    { render: async () => Buffer.from("%PDF-test") },
    now,
  );
  const dependencies: AppDependencies = {
    config,
    verifier: {
      verifyIdToken: async (token) => {
        const identity = identities.get(token);
        if (!identity) throw new Error("invalid test token");
        return identity;
      },
    },
    accounts: new AccountsRepository(pool),
    applications: {
      getPublicCatalog: async () => ({
        plans: [],
        displayVersion: "a".repeat(64),
        application: null,
      }),
      getPublicPartner: async (code) => ({ code, name: "partner" }),
      submit: async () => {
        throw new Error("not used");
      },
    },
    admin: new AdminService(new AdminRepository(pool)),
    invoices: new InvoiceService(invoiceRepository),
    referrals: new ReferralService(new ReferralRepository(pool), now),
    customerAccess: new CustomerAccessService(
      new PostgresCustomerAccessRepository(pool, now),
      now,
    ),
    publicSettings: {
      getServiceName: async () => "Test",
      getContactEmail: async () => null,
    },
    logger: { info: () => {}, error: () => {} },
    komojuInbox: { receive: async () => "accepted" },
  };
  return createApp(dependencies);
}

async function makePartner(
  label: string,
  rewardType: "appointment" | "closing",
  rate: string,
) {
  const result = await pool.query<{ id: string }>(
    "insert into partners(name,email,referral_code,reward_type,reward_rate) values($1,$2,$3,$4,$5) returning id",
    [
      `${prefix}-${label}`,
      "secret-partner@example.test",
      `${prefix}-${label}`.slice(-40),
      rewardType,
      rate,
    ],
  );
  const id = requireRow(result.rows[0]).id;
  ids.partners.push(id);
  return { id, name: `${prefix}-${label}`, rewardType, rate };
}

/** 顧客〜入金までを最小限で作り、紹介と報酬の台帳行を入れる。 */
async function makeReward(
  partner: Awaited<ReturnType<typeof makePartner>>,
  shop: string,
  month: string,
  amounts: { base: number; reward: number; tax: number },
  paidOn: string | null = null,
) {
  const suffix = randomUUID();
  const customer = await pool.query<{ id: string }>(
    "insert into customers(shop_name,contact_name,billing_name,billing_address,email) values($1,'担当者名','請求先','住所',$2) returning id",
    [`${prefix}-${shop}`, `${suffix}@example.test`],
  );
  const customerId = requireRow(customer.rows[0]).id;
  ids.customers.push(customerId);
  const plan = await pool.query<{ id: string }>(
    "insert into plans(code,name,price_excl_tax,credits,is_custom,valid_from) values($1,'個別見積り',null,null,true,current_date) returning id",
    [`${prefix}-${suffix}`],
  );
  const planId = requireRow(plan.rows[0]).id;
  ids.plans.push(planId);
  const application = await pool.query<{ id: string }>(
    `insert into applications(customer_id,plan_id,payment_method,terms_version,privacy_version,disclosure_version,consent_business_use,consent_terms,consent_marketing,shown_terms,review_result,reviewed_at)
     values($1,$2,'bank_transfer','t','p','d',true,true,false,'{}','approved',now()) returning id`,
    [customerId, planId],
  );
  const applicationId = requireRow(application.rows[0]).id;
  ids.applications.push(applicationId);
  const contract = await pool.query<{ id: string }>(
    "insert into contracts(customer_id,application_id,plan_id,payment_method,status) values($1,$2,$3,'bank_transfer','active') returning id",
    [customerId, applicationId, planId],
  );
  const contractId = requireRow(contract.rows[0]).id;
  ids.contracts.push(contractId);
  const invoice = await pool.query<{ id: string }>(
    `insert into invoices(invoice_no,contract_id,kind,status,payment_method,issued_on,total_excl_tax,tax_amount,total_incl_tax,billing_name,issuer_snapshot)
     values($1,$2,'initial','paid','bank_transfer',$3,$4,$5,$6,'請求先','{}') returning id`,
    [
      `T-${suffix}`,
      contractId,
      `${month}-01`,
      amounts.base,
      Math.floor(amounts.base / 10),
      amounts.base + Math.floor(amounts.base / 10),
    ],
  );
  const invoiceId = requireRow(invoice.rows[0]).id;
  ids.invoices.push(invoiceId);
  const payment = await pool.query<{ id: string }>(
    "insert into payments(invoice_id,method,amount,paid_on,confirmed_via) values($1,'bank_transfer',$2,$3,'manual') returning id",
    [invoiceId, amounts.base, `${month}-05`],
  );
  const paymentId = requireRow(payment.rows[0]).id;
  ids.payments.push(paymentId);
  const referral = await pool.query<{ id: string }>(
    "insert into referrals(partner_id,contract_id,reward_type,reward_rate) values($1,$2,$3,$4) returning id",
    [partner.id, contractId, partner.rewardType, partner.rate],
  );
  const referralId = requireRow(referral.rows[0]).id;
  ids.referrals.push(referralId);
  await pool.query(
    `insert into partner_rewards(referral_id,payment_id,target_month,month_index,base_amount,reward_amount,tax_amount,paid_on)
     values($1,$2,$3,1,$4,$5,$6,$7)`,
    [
      referralId,
      paymentId,
      `${month}-01`,
      amounts.base,
      amounts.reward,
      amounts.tax,
      paidOn,
    ],
  );
}

const get = (
  app: ReturnType<typeof createApp>,
  query: string,
  token = adminToken,
) =>
  app.request(`/api/v1/admin/referrals${query}`, {
    headers: { authorization: `Bearer ${token}` },
  });

let partnerA: Awaited<ReturnType<typeof makePartner>>;
let partnerB: Awaited<ReturnType<typeof makePartner>>;

beforeAll(async () => {
  identities.set(adminToken, {
    uid: adminUid,
    firebase: { sign_in_second_factor: "phone" },
  });
  identities.set(noMfaToken, { uid: noMfaUid });
  identities.set(customerToken, { uid: customerUid });
  await pool.query(
    "insert into user_accounts(auth_user_id,customer_id,role) values($1,null,'admin'),($2,null,'admin')",
    [adminUid, noMfaUid],
  );
  partnerA = await makePartner("a", "closing", "0.200");
  partnerB = await makePartner("b", "appointment", "0.100");
  await makeReward(partnerA, "ひだまり", "2026-11", {
    base: 5000,
    reward: 1000,
    tax: 100,
  });
  await makeReward(partnerA, "あおば", "2026-11", {
    base: 15000,
    reward: 3000,
    tax: 300,
  });
  await makeReward(
    partnerB,
    "こはる",
    "2026-11",
    { base: 5000, reward: 500, tax: 0 },
    "2026-12-05",
  );
  await pool.query(
    "insert into user_accounts(auth_user_id,customer_id,role) values($1,$2,'customer')",
    [customerUid, ids.customers[0]],
  );
  await makeReward(partnerA, "十月", "2026-10", {
    base: 10000,
    reward: 2000,
    tax: 200,
  });
});

afterAll(async () => {
  await pool.query(
    "delete from partner_rewards where referral_id=any($1::uuid[])",
    [ids.referrals],
  );
  await pool.query("delete from referrals where id=any($1::uuid[])", [
    ids.referrals,
  ]);
  await pool.query("delete from payments where id=any($1::uuid[])", [
    ids.payments,
  ]);
  await pool.query("delete from invoices where id=any($1::uuid[])", [
    ids.invoices,
  ]);
  await pool.query("delete from contracts where id=any($1::uuid[])", [
    ids.contracts,
  ]);
  await pool.query("delete from applications where id=any($1::uuid[])", [
    ids.applications,
  ]);
  await pool.query(
    "delete from user_accounts where auth_user_id=any($1::text[])",
    [[adminUid, noMfaUid, customerUid]],
  );
  await pool.query("delete from customers where id=any($1::uuid[])", [
    ids.customers,
  ]);
  await pool.query("delete from plans where id=any($1::uuid[])", [ids.plans]);
  await pool.query("delete from partners where id=any($1::uuid[])", [
    ids.partners,
  ]);
  await pool.end();
});

describe("GET /api/v1/admin/referrals", () => {
  it("limits rows to the month and groups them by partner with subtotals", async () => {
    const response = await get(makeApp(), "?month=2026-11");
    expect(response.status).toBe(200);
    const body = adminReferralsResponseSchema.parse(await response.json());
    const mine = body.partners.filter((p) => p.partnerName.startsWith(prefix));
    expect(mine.map((p) => p.partnerName)).toEqual([
      partnerA.name,
      partnerB.name,
    ]);
    const a = requireRow(mine[0]);
    expect(a.rows.map((r) => r.shopName).sort()).toEqual([
      `${prefix}-あおば`,
      `${prefix}-ひだまり`,
    ]);
    expect(a.subtotal).toEqual({
      count: 2,
      baseAmount: 20000,
      rewardAmount: 4000,
      taxAmount: 400,
      payableAmount: 4400,
    });
    const hidamari = requireRow(
      a.rows.find((r) => r.shopName.endsWith("ひだまり")),
    );
    expect(hidamari).toMatchObject({
      rewardType: "closing",
      ratePercent: 20,
      baseAmount: 5000,
      rewardAmount: 1000,
      taxAmount: 100,
      payableAmount: 1100,
      status: "unpaid",
    });
    // 税額は台帳の値（0円）を信頼し、500円×10%を計算し直さない
    const b = requireRow(mine[1]);
    expect(b.rows[0]).toMatchObject({
      rewardType: "appointment",
      ratePercent: 10,
      rewardAmount: 500,
      taxAmount: 0,
      payableAmount: 500,
      status: "paid",
      paidOn: "2026-12-05",
    });
    expect(body.month).toBe("2026-11");
  });

  it("includes a month total across partners and excludes other months", async () => {
    const october = adminReferralsResponseSchema.parse(
      await (await get(makeApp(), "?month=2026-10")).json(),
    );
    const mine = october.partners.filter((p) =>
      p.partnerName.startsWith(prefix),
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]?.subtotal.payableAmount).toBe(2200);
    const november = adminReferralsResponseSchema.parse(
      await (await get(makeApp(), "?month=2026-11")).json(),
    );
    const sum = november.partners.reduce(
      (s, p) => s + p.subtotal.payableAmount,
      0,
    );
    expect(november.total.payableAmount).toBe(sum);
    expect(november.total.payableAmount).toBeGreaterThanOrEqual(4900);
  });

  it("defaults to the current month when none is given", async () => {
    const body = adminReferralsResponseSchema.parse(
      await (await get(makeApp(), "")).json(),
    );
    expect(body.month).toBe("2026-11");
  });

  it("returns an empty report for a month without rewards", async () => {
    const response = await get(makeApp(), "?month=2020-01");
    expect(response.status).toBe(200);
    const body = adminReferralsResponseSchema.parse(await response.json());
    expect(body.partners).toEqual([]);
    expect(body.total).toEqual({
      count: 0,
      baseAmount: 0,
      rewardAmount: 0,
      taxAmount: 0,
      payableAmount: 0,
    });
  });

  it("does not expose personal data beyond shop names", async () => {
    const text = await (await get(makeApp(), "?month=2026-11")).text();
    expect(text).not.toContain("secret-partner@example.test");
    expect(text).not.toContain("担当者名");
    expect(text).not.toContain("@example.test");
  });

  it.each([
    "?month=2026-13",
    "?month=abc",
    "?month=2026-11-01",
    "?month=",
  ])("rejects an invalid month (%s) with 400", async (query) => {
    const response = await get(makeApp(), query);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "invalid_request" },
    });
  });

  it("rejects repeated or unknown query parameters with 400", async () => {
    expect((await get(makeApp(), "?month=2026-11&month=2026-10")).status).toBe(
      400,
    );
    expect((await get(makeApp(), "?foo=1")).status).toBe(400);
  });

  it("returns 403 without the second factor, 401 without a token, 404 for customers", async () => {
    const app = makeApp();
    expect((await get(app, "?month=2026-11", noMfaToken)).status).toBe(403);
    expect((await app.request("/api/v1/admin/referrals")).status).toBe(401);
    expect((await get(app, "?month=2026-11", customerToken)).status).toBe(404);
  });
});
