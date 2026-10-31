import { randomUUID } from "node:crypto";
import {
  adminPlanQuoteSchema,
  approvePlanQuoteResponseSchema,
  createPlanQuoteResponseSchema,
  customerPlanQuoteSchema,
} from "@kobito/shared";
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
import { PlanQuoteRepository } from "./repository.js";
import { PlanQuoteService } from "./service.js";

const connectionString =
  process.env.TEST_DATABASE_URL ??
  "postgres://kobito:kobito@127.0.0.1:5432/kobito_support_test";
const pool = new Pool({ connectionString });
const prefix = `plan-quote-${randomUUID()}`;
const identities = new Map<string, VerifiedIdentity>();
const customerIds: string[] = [];
const contractIds: string[] = [];
const applicationIds: string[] = [];
const planIds: string[] = [];
const userIds: string[] = [];
const adminUid = `${prefix}-admin`;
const adminToken = `${prefix}-admin-token`;
const noMfaUid = `${prefix}-no-mfa`;
const noMfaToken = `${prefix}-no-mfa-token`;
const config: RuntimeConfig = {
  nodeEnv: "test",
  databaseUrl: connectionString,
  firebaseProjectId: "demo-kobito-support",
  webOrigin: "http://localhost:5173",
  port: 3000,
  invoicePrefix: "KS",
  authEmulatorHost: "127.0.0.1:9099",
};
const settings: ReadonlyArray<readonly [string, unknown]> = [
  ["service_name", "テストサービス"],
  ["company_name", "テスト発行会社"],
  ["company_address", "東京都テスト区1-2-3"],
  ["invoice_registration_no", "T1234567890123"],
  ["invoice_prefix", "KS"],
  [
    "bank_account",
    {
      bank_name: "テスト銀行",
      branch_name: "テスト支店",
      account_type: "普通",
      account_number: "1234567",
      account_holder: "テストカイシャ",
    },
  ],
];
const settingsBackup = new Map<string, unknown>();
// 2026-11-14 12:00 JST
let nowValue = new Date("2026-11-14T03:00:00.000Z");
const now = () => nowValue;

function requireRow<T>(row: T | undefined): T {
  if (!row) throw new Error("Expected test database row");
  return row;
}

function makeApp() {
  const accounts = new AccountsRepository(pool);
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
    accounts,
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
    planQuotes: new PlanQuoteService(
      new PlanQuoteRepository(pool, invoiceRepository, now),
      now,
    ),
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

async function makeCustomer(
  label: string,
  status:
    | "under_review"
    | "quoting"
    | "awaiting_quote_approval"
    | "active" = "quoting",
) {
  const suffix = randomUUID();
  const customer = await pool.query<{ id: string }>(
    "insert into customers(shop_name,contact_name,billing_name,billing_address,email) values($1,'担当者','請求先','住所',$2) returning id",
    [`${prefix}-${label}`, `${suffix}@example.test`],
  );
  const customerId = requireRow(customer.rows[0]).id;
  customerIds.push(customerId);
  const plan = await pool.query<{ id: string }>(
    "insert into plans(code,name,price_excl_tax,credits,is_custom,valid_from) values($1,'個別見積り',null,null,true,current_date) returning id",
    [`${prefix}-${suffix}`],
  );
  const planId = requireRow(plan.rows[0]).id;
  planIds.push(planId);
  const application = await pool.query<{ id: string }>(
    `insert into applications(customer_id,plan_id,payment_method,terms_version,privacy_version,disclosure_version,consent_business_use,consent_terms,consent_marketing,shown_terms,review_result,reviewed_at)
     values($1,$2,'bank_transfer','t','p','d',true,true,false,'{}',$3,now()) returning id`,
    [customerId, planId, status === "under_review" ? null : "approved"],
  );
  const applicationId = requireRow(application.rows[0]).id;
  applicationIds.push(applicationId);
  const contract = await pool.query<{ id: string }>(
    "insert into contracts(customer_id,application_id,plan_id,payment_method,status) values($1,$2,$3,'bank_transfer',$4) returning id",
    [customerId, applicationId, planId, status],
  );
  const contractId = requireRow(contract.rows[0]).id;
  contractIds.push(contractId);
  const uid = `${prefix}-${label}-${suffix}`;
  const token = `${uid}-token`;
  userIds.push(uid);
  identities.set(token, { uid });
  await pool.query(
    "insert into user_accounts(auth_user_id,customer_id,role) values($1,$2,'customer')",
    [uid, customerId],
  );
  return { customerId, contractId, token, uid };
}

const adminHeaders = {
  authorization: `Bearer ${adminToken}`,
  "content-type": "application/json",
};
const quoteBody = (patch: Record<string, unknown> = {}) =>
  JSON.stringify({
    expectedVersion: 0,
    priceExclTax: 12_345,
    credits: 8,
    description: "ホームページの更新\n定例の相談",
    expiresOn: "2026-11-28",
    ...patch,
  });
const sendQuote = (
  app: ReturnType<typeof createApp>,
  customerId: string,
  patch: Record<string, unknown> = {},
) =>
  app.request(`/api/v1/admin/customers/${customerId}/plan-quote`, {
    method: "POST",
    headers: adminHeaders,
    body: quoteBody(patch),
  });
const customerGet = (app: ReturnType<typeof createApp>, token: string) =>
  app.request("/api/v1/me/plan-quote", {
    headers: { authorization: `Bearer ${token}` },
  });
const customerApprove = (
  app: ReturnType<typeof createApp>,
  token: string,
  id: string,
) =>
  app.request(`/api/v1/me/plan-quote/${id}/approve`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: "{}",
  });

beforeAll(async () => {
  const previous = await pool.query<{ key: string; value: unknown }>(
    "select key,value from settings where key=any($1::text[])",
    [settings.map(([key]) => key)],
  );
  for (const row of previous.rows) settingsBackup.set(row.key, row.value);
  for (const [key, value] of settings)
    await pool.query(
      `insert into settings(key,value) values ($1,$2::jsonb) on conflict (key) do update set value=excluded.value`,
      [key, JSON.stringify(value)],
    );
  identities.set(adminToken, {
    uid: adminUid,
    firebase: { sign_in_second_factor: "phone" },
  });
  identities.set(noMfaToken, { uid: noMfaUid });
  await pool.query(
    "insert into user_accounts(auth_user_id,customer_id,role) values($1,null,'admin'),($2,null,'admin')",
    [adminUid, noMfaUid],
  );
});

afterAll(async () => {
  const invoiceScope =
    "select id from invoices where contract_id=any($1::uuid[])";
  await pool.query(
    "delete from notifications where customer_id=any($1::uuid[])",
    [customerIds],
  );
  await pool.query(
    "delete from audit_logs where actor=any($1::text[]) or target_id=any($2::text[])",
    [[adminUid, noMfaUid, ...userIds], contractIds],
  );
  await pool.query(
    `delete from invoice_documents where invoice_id in (${invoiceScope})`,
    [contractIds],
  );
  await pool.query(
    `delete from invoice_lines where invoice_id in (${invoiceScope})`,
    [contractIds],
  );
  await pool.query("delete from invoices where contract_id=any($1::uuid[])", [
    contractIds,
  ]);
  await pool.query(
    "update contracts set plan_quote_id=null where id=any($1::uuid[])",
    [contractIds],
  );
  await pool.query(
    "delete from plan_quotes where contract_id=any($1::uuid[])",
    [contractIds],
  );
  await pool.query("delete from contracts where id=any($1::uuid[])", [
    contractIds,
  ]);
  await pool.query("delete from applications where id=any($1::uuid[])", [
    applicationIds,
  ]);
  await pool.query(
    "delete from user_accounts where auth_user_id=any($1::text[])",
    [[...userIds, adminUid, noMfaUid]],
  );
  await pool.query("delete from customers where id=any($1::uuid[])", [
    customerIds,
  ]);
  await pool.query("delete from plans where id=any($1::uuid[])", [planIds]);
  for (const [key] of settings) {
    const prior = settingsBackup.get(key);
    if (prior === undefined)
      await pool.query("delete from settings where key=$1", [key]);
    else
      await pool.query("update settings set value=$2::jsonb where key=$1", [
        key,
        JSON.stringify(prior),
      ]);
  }
  await pool.end();
});

describe("admin plan quote API", () => {
  it("requires an authenticated admin with the second factor", async () => {
    const app = makeApp();
    const { customerId, token } = await makeCustomer("admin-auth");
    const url = `/api/v1/admin/customers/${customerId}/plan-quote`;
    expect((await app.request(url)).status).toBe(401);
    expect(
      (
        await app.request(url, {
          headers: { authorization: `Bearer ${noMfaToken}` },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${noMfaToken}`,
            "content-type": "application/json",
          },
          body: quoteBody(),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(url, {
          headers: { authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(404);
    const count = await pool.query(
      "select 1 from plan_quotes q join contracts c on c.id=q.contract_id where c.customer_id=$1",
      [customerId],
    );
    expect(count.rowCount).toBe(0);
  });

  it("shows whether a quote can be made for the contract state", async () => {
    const app = makeApp();
    const review = await makeCustomer("state-review", "under_review");
    const quoting = await makeCustomer("state-quoting", "quoting");
    const read = async (customerId: string) => {
      const response = await app.request(
        `/api/v1/admin/customers/${customerId}/plan-quote`,
        { headers: { authorization: `Bearer ${adminToken}` } },
      );
      expect(response.status).toBe(200);
      return adminPlanQuoteSchema.parse(await response.json());
    };
    expect((await read(review.customerId)).canCreate).toBe(false);
    const detail = await read(quoting.customerId);
    expect(detail).toMatchObject({
      canCreate: true,
      expectedVersion: 0,
      quotes: [],
      today: "2026-11-14",
      contract: { status: "quoting" },
    });
    const missing = await app.request(
      `/api/v1/admin/customers/${randomUUID()}/plan-quote`,
      { headers: { authorization: `Bearer ${adminToken}` } },
    );
    expect(missing.status).toBe(404);
  });

  it("sends a version, moves the contract and writes an audit record", async () => {
    const app = makeApp();
    const { customerId, contractId } = await makeCustomer("send");
    const response = await sendQuote(app, customerId);
    expect(response.status).toBe(201);
    const body = createPlanQuoteResponseSchema.parse(await response.json());
    expect(body.quote).toMatchObject({
      version: 1,
      priceExclTax: 12_345,
      taxAmount: 1_234,
      priceInclTax: 13_579,
      credits: 8,
      expiresOn: "2026-11-28",
      status: "awaiting",
    });
    const contract = await pool.query<{ status: string }>(
      "select status from contracts where id=$1",
      [contractId],
    );
    expect(contract.rows[0]?.status).toBe("awaiting_quote_approval");
    const audit = await pool.query<{ actor: string }>(
      "select actor from audit_logs where action='plan_quote.sent' and target_id=$1",
      [body.quote.id],
    );
    expect(audit.rows[0]?.actor).toBe(adminUid);
    const notices = await pool.query<{
      kind: string;
      channel: string;
      dedupe_key: string;
      payload: Record<string, unknown>;
    }>(
      "select kind,channel,dedupe_key,payload from notifications where customer_id=$1 and kind='NT-06'",
      [customerId],
    );
    expect(notices.rows).toEqual([
      {
        kind: "NT-06",
        channel: "email",
        dedupe_key: `NT-06:plan-quote:${body.quote.id}:email`,
        payload: { planQuoteId: body.quote.id },
      },
    ]);
  });

  it("rejects invalid input and stale or impossible sends without writing", async () => {
    const app = makeApp();
    const { customerId, contractId } = await makeCustomer("validation");
    for (const patch of [
      { priceExclTax: 0 },
      { priceExclTax: 100.5 },
      { credits: 0 },
      { description: "  " },
      { expiresOn: "2026-11-14" },
      { expiresOn: "2026-11-01" },
    ]) {
      expect((await sendQuote(app, customerId, patch)).status).toBe(422);
    }
    expect(
      (await sendQuote(app, customerId, { expectedVersion: 3 })).status,
    ).toBe(409);
    const review = await makeCustomer("validation-review", "under_review");
    expect((await sendQuote(app, review.customerId)).status).toBe(409);
    const rows = await pool.query(
      "select 1 from plan_quotes where contract_id=any($1::uuid[])",
      [[contractId, review.contractId]],
    );
    expect(rows.rowCount).toBe(0);
  });

  it("never edits a sent version: a new version supersedes the old one", async () => {
    const app = makeApp();
    const customer = await makeCustomer("versions");
    const first = createPlanQuoteResponseSchema.parse(
      await (await sendQuote(app, customer.customerId)).json(),
    );
    // 古い画面からの二重送信は新しい版を作らない
    expect((await sendQuote(app, customer.customerId)).status).toBe(409);
    const second = await sendQuote(app, customer.customerId, {
      expectedVersion: 1,
      priceExclTax: 20_000,
    });
    expect(second.status).toBe(201);
    const secondBody = createPlanQuoteResponseSchema.parse(await second.json());
    expect(secondBody.quote.version).toBe(2);
    const rows = await pool.query<{
      version: number;
      superseded_at: Date | null;
      price_excl_tax: number;
    }>(
      "select version,superseded_at,price_excl_tax from plan_quotes where contract_id=$1 order by version",
      [customer.contractId],
    );
    expect(rows.rows.map((row) => row.price_excl_tax)).toEqual([
      12_345, 20_000,
    ]);
    expect(rows.rows[0]?.superseded_at).not.toBeNull();
    expect(rows.rows[1]?.superseded_at).toBeNull();
    // 古い版は了承できない。最新の版だけが見える
    expect(
      (await customerApprove(app, customer.token, first.quote.id)).status,
    ).toBe(409);
    const latest = customerPlanQuoteSchema.parse(
      await (await customerGet(app, customer.token)).json(),
    );
    expect(latest).toMatchObject({
      id: secondBody.quote.id,
      version: 2,
      priceExclTax: 20_000,
      taxAmount: 2_000,
      priceInclTax: 22_000,
      canApprove: true,
    });
    const detail = adminPlanQuoteSchema.parse(
      await (
        await app.request(
          `/api/v1/admin/customers/${customer.customerId}/plan-quote`,
          { headers: { authorization: `Bearer ${adminToken}` } },
        )
      ).json(),
    );
    expect(detail.quotes.map((quote) => [quote.version, quote.status])).toEqual(
      [
        [2, "awaiting"],
        [1, "superseded"],
      ],
    );
    expect(detail.expectedVersion).toBe(2);
  });
});

describe("customer plan quote API", () => {
  it("scopes reads and approvals to the authenticated customer", async () => {
    const app = makeApp();
    const owner = await makeCustomer("scope-owner");
    const other = await makeCustomer("scope-other");
    const sent = createPlanQuoteResponseSchema.parse(
      await (await sendQuote(app, owner.customerId)).json(),
    );
    await sendQuote(app, other.customerId, { priceExclTax: 99_000 });
    const mine = customerPlanQuoteSchema.parse(
      await (await customerGet(app, owner.token)).json(),
    );
    expect(mine.id).toBe(sent.quote.id);
    expect(mine.priceExclTax).toBe(12_345);
    const stolen = await customerApprove(app, other.token, sent.quote.id);
    expect(stolen.status).toBe(404);
    const row = await pool.query<{ approved_at: Date | null }>(
      "select approved_at from plan_quotes where id=$1",
      [sent.quote.id],
    );
    expect(row.rows[0]?.approved_at).toBeNull();
    expect(
      (
        await app.request("/api/v1/me/plan-quote", {
          headers: { authorization: `Bearer ${adminToken}` },
        })
      ).status,
    ).toBe(404);
  });

  it("returns 404 when nothing has been sent, and never exposes unsent versions", async () => {
    const app = makeApp();
    const customer = await makeCustomer("unsent", "awaiting_quote_approval");
    expect((await customerGet(app, customer.token)).status).toBe(404);
    const inserted = await pool.query<{ id: string }>(
      `insert into plan_quotes(contract_id,version,price_excl_tax,credits,description,expires_on,sent_at)
       values($1,1,10000,3,'未送付','2026-11-28',null) returning id`,
      [customer.contractId],
    );
    expect((await customerGet(app, customer.token)).status).toBe(404);
    expect(
      (
        await customerApprove(
          app,
          customer.token,
          requireRow(inserted.rows[0]).id,
        )
      ).status,
    ).toBe(404);
  });

  it("approves once: records time and uid, issues the first invoice at the tax-inclusive total", async () => {
    nowValue = new Date("2026-11-14T03:00:00.000Z");
    const app = makeApp();
    const customer = await makeCustomer("approve");
    const sent = createPlanQuoteResponseSchema.parse(
      await (await sendQuote(app, customer.customerId)).json(),
    );
    const response = await customerApprove(app, customer.token, sent.quote.id);
    expect(response.status).toBe(200);
    const body = approvePlanQuoteResponseSchema.parse(await response.json());
    expect(body).toMatchObject({
      quoteId: sent.quote.id,
      contractStatus: "awaiting_payment",
      replayed: false,
    });
    const quote = await pool.query<{
      approved_at: Date;
      approved_by: string;
    }>("select approved_at,approved_by from plan_quotes where id=$1", [
      sent.quote.id,
    ]);
    expect(quote.rows[0]?.approved_by).toBe(customer.uid);
    expect(quote.rows[0]?.approved_at.toISOString()).toBe(body.approvedAt);
    const contract = await pool.query<{
      status: string;
      plan_quote_id: string;
      first_invoice_due_on: string | null;
    }>(
      "select status,plan_quote_id,first_invoice_due_on::text from contracts where id=$1",
      [customer.contractId],
    );
    expect(contract.rows[0]).toMatchObject({
      status: "awaiting_payment",
      plan_quote_id: sent.quote.id,
      first_invoice_due_on: "2026-11-21",
    });
    const invoice = await pool.query<{
      total_excl_tax: number;
      tax_amount: number;
      total_incl_tax: number;
      issuer_snapshot: { acceptedPlan: { credits: number; planCode: string } };
    }>(
      "select total_excl_tax,tax_amount,total_incl_tax,issuer_snapshot from invoices where contract_id=$1",
      [customer.contractId],
    );
    expect(invoice.rows).toHaveLength(1);
    expect(invoice.rows[0]).toMatchObject({
      total_excl_tax: 12_345,
      tax_amount: 1_234,
      total_incl_tax: 13_579,
    });
    expect(invoice.rows[0]?.issuer_snapshot.acceptedPlan).toMatchObject({
      credits: 8,
      planCode: "custom",
    });
    const audit = await pool.query(
      "select 1 from audit_logs where action='plan_quote.approved' and target_id=$1 and actor=$2",
      [sent.quote.id, customer.uid],
    );
    expect(audit.rowCount).toBe(1);
  });

  it("treats a second approval as a replay without a second invoice", async () => {
    const app = makeApp();
    const customer = await makeCustomer("double");
    const sent = createPlanQuoteResponseSchema.parse(
      await (await sendQuote(app, customer.customerId)).json(),
    );
    const first = approvePlanQuoteResponseSchema.parse(
      await (await customerApprove(app, customer.token, sent.quote.id)).json(),
    );
    const secondResponse = await customerApprove(
      app,
      customer.token,
      sent.quote.id,
    );
    expect(secondResponse.status).toBe(200);
    const second = approvePlanQuoteResponseSchema.parse(
      await secondResponse.json(),
    );
    expect(second).toMatchObject({
      replayed: true,
      approvedAt: first.approvedAt,
    });
    const invoices = await pool.query(
      "select 1 from invoices where contract_id=$1",
      [customer.contractId],
    );
    expect(invoices.rowCount).toBe(1);
    const got = customerPlanQuoteSchema.parse(
      await (await customerGet(app, customer.token)).json(),
    );
    expect(got).toMatchObject({ status: "approved", canApprove: false });
    // 了承済みの版には新しい版を作れない
    expect(
      (await sendQuote(app, customer.customerId, { expectedVersion: 1 }))
        .status,
    ).toBe(409);
  });

  it("does not approve after the expiry date (valid through the expiry day)", async () => {
    const app = makeApp();
    const customer = await makeCustomer("expiry");
    nowValue = new Date("2026-11-14T03:00:00.000Z");
    const sent = createPlanQuoteResponseSchema.parse(
      await (await sendQuote(app, customer.customerId)).json(),
    );
    // 期限の当日 23:59 JST まではOK、翌日からNG
    nowValue = new Date("2026-11-29T00:00:00.000Z"); // 11/29 09:00 JST
    const view = customerPlanQuoteSchema.parse(
      await (await customerGet(app, customer.token)).json(),
    );
    expect(view).toMatchObject({ status: "expired", canApprove: false });
    const rejected = await customerApprove(app, customer.token, sent.quote.id);
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toEqual({
      error: { code: "plan_quote_expired" },
    });
    const state = await pool.query<{ status: string }>(
      "select status from contracts where id=$1",
      [customer.contractId],
    );
    expect(state.rows[0]?.status).toBe("awaiting_quote_approval");
    const invoices = await pool.query(
      "select 1 from invoices where contract_id=$1",
      [customer.contractId],
    );
    expect(invoices.rowCount).toBe(0);
    nowValue = new Date("2026-11-28T14:59:00.000Z"); // 11/28 23:59 JST
    expect(
      (await customerApprove(app, customer.token, sent.quote.id)).status,
    ).toBe(200);
    nowValue = new Date("2026-11-14T03:00:00.000Z");
  });

  it("does not let customers whose contract is not awaiting approval approve", async () => {
    const app = makeApp();
    const customer = await makeCustomer("wrong-state", "under_review");
    const inserted = await pool.query<{ id: string }>(
      `insert into plan_quotes(contract_id,version,price_excl_tax,credits,description,expires_on,sent_at)
       values($1,1,10000,3,'状態違い','2026-11-28',now()) returning id`,
      [customer.contractId],
    );
    const response = await customerApprove(
      app,
      customer.token,
      requireRow(inserted.rows[0]).id,
    );
    expect([404, 409]).toContain(response.status);
    const invoices = await pool.query(
      "select 1 from invoices where contract_id=$1",
      [customer.contractId],
    );
    expect(invoices.rowCount).toBe(0);
  });
});
