import { randomUUID } from "node:crypto";
import {
  adminInvoiceDetailSchema,
  adminReferralsResponseSchema,
  approveApplicationResponseSchema,
  confirmBankPaymentResponseSchema,
  customerAccessSchema,
  extraCreditPurchaseResponseSchema,
  invoiceDetailSchema,
  paymentLinkResponseSchema,
  periodFor,
  welcomeSeenResponseSchema,
} from "@kobito/shared";
import { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  onTestFinished,
} from "vitest";
import { type AppDependencies, createApp } from "../../app.js";
import { FakeKomojuClient } from "../../integrations/komoju/fake-client.js";
import type { PdfStore } from "../../integrations/storage/pdf-store.js";
import { DailyBillingJob } from "../../jobs/daily-billing.js";
import { DailyLifecycleJob } from "../../jobs/daily-lifecycle.js";
import type { VerifiedIdentity } from "../../platform/auth.js";
import type { RuntimeConfig } from "../../platform/config.js";
import { customerScopeFor } from "../../platform/scope.js";
import { AccountsRepository } from "../accounts/repository.js";
import { AdminRepository } from "../admin/repository.js";
import { AdminService } from "../admin/service.js";
import { PostgresCustomerAccessRepository } from "../customer-access/repository.js";
import { CustomerAccessService } from "../customer-access/service.js";
import { PostgresPaymentLinkRepository } from "../payment-links/repository.js";
import { PaymentLinkService } from "../payment-links/service.js";
import { ReferralRepository } from "../referrals/repository.js";
import { ReferralService } from "../referrals/service.js";
import { InvoiceRepository } from "./repository.js";
import { InvoiceService } from "./service.js";

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const prefix = `invoice-${randomUUID()}`;
const adminUid = `${prefix}-admin`;
const adminToken = `${prefix}-admin-token`;
const customerTokens = new Map<string, string>();
const identities = new Map<string, VerifiedIdentity>([
  [adminToken, { uid: adminUid, firebase: { sign_in_second_factor: "phone" } }],
]);
const customerIds: string[] = [];
const applicationIds: string[] = [];
const contractIds: string[] = [];
const planIds: string[] = [];
const partnerIds: string[] = [];
const userIds: string[] = [adminUid];
const pdf = Buffer.from("%PDF-1.7\ninvoice fixture\n");
let renderFailure = false;
let renderCount = 0;
const renderedInvoices: import("@kobito/shared").InvoiceDetail[] = [];

const config: RuntimeConfig = {
  nodeEnv: "test",
  databaseUrl:
    process.env.TEST_DATABASE_URL ??
    "postgres://kobito:kobito@127.0.0.1:5432/kobito_support_test",
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

function makeApp(
  runtimeConfig: RuntimeConfig = config,
  now = new Date("2026-01-30T15:30:00.000Z"),
  pdfStore?: PdfStore,
): ReturnType<typeof createApp> {
  const accounts = new AccountsRepository(pool);
  const invoiceRepository = new InvoiceRepository(
    pool,
    runtimeConfig,
    {
      render: async (invoice) => {
        renderCount += 1;
        renderedInvoices.push(invoice);
        if (renderFailure) throw new Error("render failed");
        return pdf;
      },
    },
    () => now,
    pdfStore,
  );
  const dependencies: AppDependencies = {
    config: runtimeConfig,
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
    referrals: new ReferralService(new ReferralRepository(pool)),
    paymentLinks: new PaymentLinkService(
      new PostgresPaymentLinkRepository(pool),
      new FakeKomojuClient(),
      runtimeConfig.webOrigin,
    ),
    customerAccess: new CustomerAccessService(
      new PostgresCustomerAccessRepository(pool, () => now),
      () => now,
    ),
    publicSettings: {
      getServiceName: async () => "Test service",
      getContactEmail: async () => null,
    },
    komojuInbox: { receive: async () => "accepted" as const },
    logger: { info: () => {}, error: () => {} },
  };
  return createApp(dependencies);
}

async function makeApplication(
  options: { paymentMethod?: string; custom?: boolean; price?: number } = {},
) {
  const suffix = randomUUID();
  const customer = await pool.query<{ id: string }>(
    `insert into customers (shop_name, contact_name, billing_name, billing_address, email)
     values ($1,'Test contact','Billing snapshot','Billing address snapshot',$2) returning id`,
    [`${prefix}-${suffix}`, `${suffix}@example.test`],
  );
  const customerId = customer.rows[0]?.id;
  if (!customerId) throw new Error("Invoice test customer insert failed");
  customerIds.push(customerId);
  const plan = await pool.query<{ id: string }>(
    `insert into plans (code,name,price_excl_tax,credits,is_custom,valid_from)
     values ($1,$2,$3,$4,$5,current_date) returning id`,
    [
      `${prefix}-${suffix}`,
      options.custom ? "個別見積り" : "申込時プラン",
      options.custom ? null : (options.price ?? 5000),
      options.custom ? null : 1,
      options.custom ?? false,
    ],
  );
  const planId = plan.rows[0]?.id;
  if (!planId) throw new Error("Invoice test plan insert failed");
  planIds.push(planId);
  const shownTerms = {
    planId,
    planCode: options.custom ? "custom" : "light",
    planName: options.custom ? "個別見積り" : "申込時プラン",
    priceExclTax: options.custom ? null : (options.price ?? 5000),
    credits: options.custom ? null : 1,
    paymentMethod: options.paymentMethod ?? "bank_transfer",
  };
  const application = await pool.query<{ id: string }>(
    `insert into applications (customer_id,plan_id,payment_method,terms_version,privacy_version,disclosure_version,
      consent_business_use,consent_terms,consent_marketing,shown_terms)
     values ($1,$2,$3,'terms','privacy','disclosure',true,true,false,$4::jsonb) returning id`,
    [
      customerId,
      planId,
      options.paymentMethod ?? "bank_transfer",
      JSON.stringify(shownTerms),
    ],
  );
  const applicationId = application.rows[0]?.id;
  if (!applicationId) throw new Error("Invoice test application insert failed");
  applicationIds.push(applicationId);
  const contract = await pool.query<{ id: string }>(
    `insert into contracts (customer_id,application_id,plan_id,payment_method,status)
     values ($1,$2,$3,$4,'under_review') returning id`,
    [
      customerId,
      applicationId,
      planId,
      options.paymentMethod ?? "bank_transfer",
    ],
  );
  const contractId = contract.rows[0]?.id;
  if (!contractId) throw new Error("Invoice test contract insert failed");
  contractIds.push(contractId);
  const uid = `${prefix}-${suffix}-customer`;
  const token = `${uid}-token`;
  userIds.push(uid);
  customerTokens.set(uid, token);
  identities.set(token, { uid });
  await pool.query(
    "insert into user_accounts(auth_user_id,customer_id,role) values ($1,$2,'customer')",
    [uid, customerId],
  );
  return { customerId, applicationId, contractId, uid, token };
}

async function makeLegacyCustomer() {
  const suffix = randomUUID();
  const result = await pool.query<{ id: string }>(
    `insert into customers (shop_name, contact_name, billing_name, billing_address, email)
     values ($1,'Legacy contact','Legacy billing','Legacy address',$2) returning id`,
    [`${prefix}-legacy-${suffix}`, `${suffix}@example.test`],
  );
  const customerId = result.rows[0]?.id;
  if (!customerId) throw new Error("Legacy customer fixture insert failed");
  customerIds.push(customerId);
  const uid = `${prefix}-legacy-${suffix}-customer`;
  const token = `${uid}-token`;
  userIds.push(uid);
  identities.set(token, { uid });
  await pool.query(
    "insert into user_accounts(auth_user_id,customer_id,role) values ($1,$2,'customer')",
    [uid, customerId],
  );
  return { customerId, token };
}

function approve(app: ReturnType<typeof createApp>, id: string) {
  return app.request(`/api/v1/admin/applications/${id}/approve`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
    },
    body: "{}",
  });
}

function confirm(app: ReturnType<typeof createApp>, id: string, body: unknown) {
  return app.request(`/api/v1/admin/invoices/${id}/confirm-payment`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function voidInvoice(
  app: ReturnType<typeof createApp>,
  id: string,
  reason: string,
) {
  return app.request(`/api/v1/admin/invoices/${id}/void`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ reason }),
  });
}

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
  await pool.query(
    "insert into user_accounts(auth_user_id,customer_id,role) values ($1,null,'admin')",
    [adminUid],
  );
});

afterAll(async () => {
  await pool.query("delete from audit_logs where target_id = any($1::text[])", [
    [...applicationIds, ...contractIds],
  ]);
  await pool.query(
    "delete from partner_rewards where referral_id in (select id from referrals where contract_id=any($1::uuid[]))",
    [contractIds],
  );
  await pool.query("delete from referrals where contract_id=any($1::uuid[])", [
    contractIds,
  ]);
  await pool.query(
    "delete from notifications where customer_id = any($1::uuid[])",
    [customerIds],
  );
  await pool.query(
    "delete from audit_logs where target_type='invoice' and target_id in (select id::text from invoices where contract_id=any($1::uuid[]))",
    [contractIds],
  );
  await pool.query(
    "delete from credit_entries where contract_id = any($1::uuid[])",
    [contractIds],
  );
  await pool.query(
    "delete from payments where invoice_id in (select id from invoices where contract_id = any($1::uuid[]))",
    [contractIds],
  );
  await pool.query(
    "delete from invoice_documents where invoice_id in (select id from invoices where contract_id = any($1::uuid[]))",
    [contractIds],
  );
  await pool.query(
    "delete from invoice_lines where invoice_id in (select id from invoices where contract_id = any($1::uuid[]))",
    [contractIds],
  );
  await pool.query("delete from invoices where contract_id = any($1::uuid[])", [
    contractIds,
  ]);
  await pool.query(
    "delete from billing_periods where contract_id = any($1::uuid[])",
    [contractIds],
  );
  await pool.query(
    "delete from plan_quotes where contract_id = any($1::uuid[])",
    [contractIds],
  );
  await pool.query("delete from contracts where id = any($1::uuid[])", [
    contractIds,
  ]);
  await pool.query("delete from applications where id = any($1::uuid[])", [
    applicationIds,
  ]);
  await pool.query(
    "delete from user_accounts where auth_user_id = any($1::text[])",
    [userIds],
  );
  await pool.query("delete from customers where id = any($1::uuid[])", [
    customerIds,
  ]);
  await pool.query("delete from plans where id = any($1::uuid[])", [planIds]);
  await pool.query("delete from partners where id=any($1::uuid[])", [
    partnerIds,
  ]);
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
  if (!settingsBackup.has("invoice_preview_enabled"))
    await pool.query(
      "delete from settings where key='invoice_preview_enabled'",
    );
  await pool.end();
});

describe("initial invoice approval and customer access", () => {
  it("scopes card payment-link requests to the authenticated customer", async () => {
    // カードの審査完了は未実装（409）のため、振込で発行した請求書をカード請求書に更新して検証する。
    const owner = await makeApplication();
    const other = await makeApplication();
    const issueApp = makeApp();
    const issued = await approve(issueApp, owner.applicationId);
    expect(issued.status).toBe(200);
    const invoiceId = ((await issued.json()) as { invoice: { id: string } })
      .invoice.id;
    await pool.query("update invoices set payment_method='card' where id=$1", [
      invoiceId,
    ]);

    const ownResponse = await issueApp.request(
      `/api/v1/me/invoices/${invoiceId}/payment-link`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${owner.token}` },
      },
    );
    expect(ownResponse.status).toBe(200);
    const ownBody: unknown = await ownResponse.json();
    expect(paymentLinkResponseSchema.parse(ownBody)).toEqual({
      redirectUrl: "https://komoju.com/sessions/fake-session-id",
    });

    const otherResponse = await issueApp.request(
      `/api/v1/me/invoices/${invoiceId}/payment-link`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${other.token}` },
      },
    );
    expect(otherResponse.status).toBe(404);
  });

  it.each([
    "under_review",
    "quoting",
    "awaiting_payment",
  ] as const)("allows the c04 invoice namespace but hides profile and contract data for %s", async (status) => {
    const fixture = await makeApplication();
    const app = makeApp();
    await pool.query("update contracts set status=$2 where id=$1", [
      fixture.contractId,
      status,
    ]);
    const headers = { authorization: `Bearer ${fixture.token}` };
    const accessResponse = await app.request("/api/v1/me/access", { headers });
    expect(await accessResponse.json()).toMatchObject({
      contractStatus: status,
      landingPath: "/me/waiting",
      access: "pending",
      invoiceAccess: true,
    });
    expect((await app.request("/api/v1/me", { headers })).status).toBe(404);
    expect((await app.request("/api/v1/me/contract", { headers })).status).toBe(
      404,
    );
    const invoices = await app.request("/api/v1/me/invoices", { headers });
    expect(invoices.status).toBe(200);
    expect(await invoices.json()).toEqual({ invoices: [] });
  });

  it("sends awaiting quote approval to c12 and withholds the invoice namespace", async () => {
    const fixture = await makeApplication({ custom: true });
    const app = makeApp();
    await pool.query(
      "update contracts set status='awaiting_quote_approval' where id=$1",
      [fixture.contractId],
    );
    const headers = { authorization: `Bearer ${fixture.token}` };
    const access = await app.request("/api/v1/me/access", { headers });
    expect(await access.json()).toMatchObject({
      contractStatus: "awaiting_quote_approval",
      landingPath: "/me/plan-quote",
      access: "pending",
      invoiceAccess: false,
    });
    expect((await app.request("/api/v1/me/invoices", { headers })).status).toBe(
      404,
    );
  });

  it("hides lapsed profile and invoice data while exposing the minimal finished landing", async () => {
    const fixture = await makeApplication();
    const app = makeApp();
    const issued = await approve(app, fixture.applicationId);
    const invoiceId = ((await issued.json()) as { invoice: { id: string } })
      .invoice.id;
    await pool.query("update contracts set status='lapsed' where id=$1", [
      fixture.contractId,
    ]);
    const auth = { authorization: `Bearer ${fixture.token}` };

    const profile = await app.request("/api/v1/me", { headers: auth });
    expect(profile.status).toBe(404);

    const invoiceList = await app.request("/api/v1/me/invoices", {
      headers: auth,
    });
    expect(invoiceList.status).toBe(404);
    expect(
      (
        await app.request(`/api/v1/me/invoices/${invoiceId}`, {
          headers: auth,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/v1/me/invoices/${invoiceId}/pdf`, {
          headers: auth,
        })
      ).status,
    ).toBe(404);

    const access = await app.request("/api/v1/me/access", { headers: auth });
    expect(access.status).toBe(200);
    const accessBody = await access.json();
    expect(customerAccessSchema.parse(accessBody)).toEqual(accessBody);
    expect(Object.keys(accessBody as Record<string, unknown>).sort()).toEqual([
      "access",
      "contractStatus",
      "invoiceAccess",
      "invoiceAccessUntil",
      "landingPath",
      "welcomeRequired",
    ]);
    expect(accessBody).toMatchObject({
      contractStatus: "lapsed",
      landingPath: "/me/finished",
      access: "finished",
      invoiceAccess: false,
    });
    const rejectedWelcome = await app.request("/api/v1/me/welcome-seen", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: "{}",
    });
    expect(rejectedWelcome.status).toBe(409);
    const unchanged = await pool.query<{ welcome_shown_at: Date | null }>(
      "select welcome_shown_at from contracts where id=$1",
      [fixture.contractId],
    );
    expect(unchanged.rows[0]?.welcome_shown_at).toBeNull();

    const declined = await makeApplication();
    await pool.query("update contracts set status='declined' where id=$1", [
      declined.contractId,
    ]);
    const declinedAccess = await app.request("/api/v1/me/access", {
      headers: { authorization: `Bearer ${declined.token}` },
    });
    expect(await declinedAccess.json()).toMatchObject({
      contractStatus: "declined",
      landingPath: "/me/finished",
      access: "finished",
      invoiceAccess: false,
    });
    expect(
      (
        await app.request("/api/v1/me", {
          headers: { authorization: `Bearer ${declined.token}` },
        })
      ).status,
    ).toBe(404);
  });

  it("acknowledges the active customer's first welcome with a stable replay timestamp", async () => {
    const fixture = await makeApplication();
    const app = makeApp();
    await pool.query("update contracts set status='active' where id=$1", [
      fixture.contractId,
    ]);
    const headers = {
      authorization: `Bearer ${fixture.token}`,
      "content-type": "application/json",
    };
    const results = await Promise.all([
      app.request("/api/v1/me/welcome-seen", {
        method: "POST",
        headers,
        body: "{}",
      }),
      app.request("/api/v1/me/welcome-seen", {
        method: "POST",
        headers,
        body: "{}",
      }),
    ]);
    expect(results.map((response) => response.status)).toEqual([200, 200]);
    const bodies = await Promise.all(
      results.map((response) => response.json()),
    );
    const firstBody = bodies[0] as { seenAt: string };
    expect(welcomeSeenResponseSchema.parse(firstBody)).toEqual(firstBody);
    expect(Number.isNaN(Date.parse(firstBody.seenAt))).toBe(false);
    expect(bodies[1]).toEqual(firstBody);

    const replay = await app.request("/api/v1/me/welcome-seen", {
      method: "POST",
      headers,
      body: "{}",
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(firstBody);
    const replayAfterClockAdvance = await makeApp(
      config,
      new Date("2026-02-01T00:00:00.000Z"),
    ).request("/api/v1/me/welcome-seen", {
      method: "POST",
      headers,
      body: "{}",
    });
    expect(await replayAfterClockAdvance.json()).toEqual(firstBody);
  });

  it("uses persisted ended_at in Tokyo and denies data after the calendar-year retention cutoff", async () => {
    const fixture = await makeApplication();
    const app = makeApp();
    const issued = await approve(app, fixture.applicationId);
    const invoiceId = ((await issued.json()) as { invoice: { id: string } })
      .invoice.id;
    await pool.query(
      "update contracts set status='ended', ended_at=$2::timestamptz where id=$1",
      [fixture.contractId, "2025-02-28T15:00:00.000Z"],
    );
    const auth = { authorization: `Bearer ${fixture.token}` };
    const retained = await app.request("/api/v1/me/access", { headers: auth });
    expect(await retained.json()).toMatchObject({
      landingPath: "/me/invoices",
      access: "ended",
      invoiceAccess: true,
      invoiceAccessUntil: "2026-02-28",
    });
    expect((await app.request("/api/v1/me", { headers: auth })).status).toBe(
      404,
    );
    expect(
      (await app.request("/api/v1/me/invoices", { headers: auth })).status,
    ).toBe(200);
    expect(
      (await app.request(`/api/v1/me/invoices/${invoiceId}`, { headers: auth }))
        .status,
    ).toBe(200);
    expect(
      (
        await app.request(`/api/v1/me/invoices/${invoiceId}/pdf`, {
          headers: auth,
        })
      ).status,
    ).toBe(200);

    await pool.query(
      "update contracts set ended_at=$2::timestamptz where id=$1",
      [fixture.contractId, "2025-01-30T02:00:00.000Z"],
    );
    const expired = await app.request("/api/v1/me/access", { headers: auth });
    expect(await expired.json()).toMatchObject({
      landingPath: "/me/finished",
      access: "finished",
      invoiceAccess: false,
      invoiceAccessUntil: null,
    });
    expect(
      (await app.request("/api/v1/me/invoices", { headers: auth })).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/v1/me/invoices/${invoiceId}/pdf`, {
          headers: auth,
        })
      ).status,
    ).toBe(404);

    await pool.query("update contracts set ended_at=null where id=$1", [
      fixture.contractId,
    ]);
    const missingEndDate = await app.request("/api/v1/me/access", {
      headers: auth,
    });
    expect(await missingEndDate.json()).toMatchObject({
      landingPath: "/me/finished",
      invoiceAccess: false,
    });
  });

  it("returns no access for an anonymized customer even with a contract row", async () => {
    const fixture = await makeApplication();
    const app = makeApp();
    await pool.query("update customers set anonymized_at=now() where id=$1", [
      fixture.customerId,
    ]);
    const response = await app.request("/api/v1/me/access", {
      headers: { authorization: `Bearer ${fixture.token}` },
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "not_found" } });
    const welcome = await app.request("/api/v1/me/welcome-seen", {
      method: "POST",
      headers: {
        authorization: `Bearer ${fixture.token}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(welcome.status).toBe(404);
  });

  it("retains profile-only compatibility for a legacy customer without a contract", async () => {
    const fixture = await makeLegacyCustomer();
    const app = makeApp();
    const headers = { authorization: `Bearer ${fixture.token}` };
    const access = await app.request("/api/v1/me/access", { headers });
    const accessBody = await access.json();
    expect(customerAccessSchema.parse(accessBody)).toMatchObject({
      contractStatus: null,
      landingPath: "/me",
      access: "none",
      invoiceAccess: false,
    });
    const profile = await app.request("/api/v1/me", { headers });
    expect(profile.status).toBe(200);
    expect(await profile.json()).toEqual({
      customer: {
        id: fixture.customerId,
        shopName: expect.stringContaining("legacy"),
        contactName: "Legacy contact",
      },
    });
    expect((await app.request("/api/v1/me/contract", { headers })).status).toBe(
      404,
    );
    expect((await app.request("/api/v1/me/requests", { headers })).status).toBe(
      404,
    );
  });

  it("confirms a live bank payment once and activates period one from Tokyo confirmation date", async () => {
    const fixture = await makeApplication({ price: 5432 });
    const app = makeApp();
    const issued = await approve(app, fixture.applicationId);
    const invoiceId = ((await issued.json()) as { invoice: { id: string } })
      .invoice.id;
    await pool.query(
      "update customers set deletion_due_on='2026-01-01' where id=$1",
      [fixture.customerId],
    );
    const pending = await app.request("/api/v1/admin/bank-transfers/pending", {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(
      ((await pending.json()) as { items: Array<{ invoice: { id: string } }> })
        .items,
    ).toContainEqual(
      expect.objectContaining({
        invoice: expect.objectContaining({ id: invoiceId }),
      }),
    );
    const noMfaToken = `${prefix}-no-mfa-bank-token`;
    identities.set(noMfaToken, { uid: adminUid });
    expect(
      (
        await app.request("/api/v1/admin/bank-transfers/pending", {
          headers: { authorization: `Bearer ${noMfaToken}` },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(
          `/api/v1/admin/invoices/${invoiceId}/confirm-payment`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${noMfaToken}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ amount: 5975, paidOn: "2026-01-31" }),
          },
        )
      ).status,
    ).toBe(403);
    await pool.query(
      "update plans set name='後日改定プラン',price_excl_tax=9999,credits=3 where id=(select (issuer_snapshot->'acceptedPlan'->>'planId')::uuid from invoices where id=$1)",
      [invoiceId],
    );
    const response = await app.request(
      `/api/v1/admin/invoices/${invoiceId}/confirm-payment`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${adminToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ amount: 5975, paidOn: "2026-01-31" }),
      },
    );
    expect(response.status).toBe(200);
    const confirmation = await response.json();
    expect(confirmation).toMatchObject({
      invoiceId,
      amount: 5975,
      paidOn: "2026-01-31",
      anchorDate: "2026-01-31",
      period: {
        seq: 1,
        startsOn: "2026-01-31",
        endsOn: "2026-02-27",
        priceExclTax: 5432,
        credits: 1,
      },
      preview: false,
      replayed: false,
    });
    const state = await pool.query<{
      status: string;
      payment_count: string;
      period_count: string;
      grant_count: string;
      payment_date: string;
      deletion_due_on: string | null;
    }>(
      `select c.status, (select count(*)::text from payments where invoice_id=$2) payment_count,
       (select count(*)::text from billing_periods where contract_id=c.id) period_count,
       (select count(*)::text from credit_entries where contract_id=c.id and kind='grant' and invoice_id=$2) grant_count,
       (select paid_on::text from payments where invoice_id=$2) payment_date,
       cu.deletion_due_on::text
       from contracts c join customers cu on cu.id=c.customer_id where c.id=$1`,
      [fixture.contractId, invoiceId],
    );
    expect(state.rows[0]).toEqual({
      status: "active",
      payment_count: "1",
      period_count: "1",
      grant_count: "1",
      payment_date: "2026-01-31",
      deletion_due_on: null,
    });
    const retry = await app.request(
      `/api/v1/admin/invoices/${invoiceId}/confirm-payment`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${adminToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ amount: 5975, paidOn: "2026-01-31" }),
      },
    );
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({
      paymentId: confirmation.paymentId,
      replayed: true,
    });
    expect(
      (await confirm(app, invoiceId, { amount: 5976, paidOn: "2026-01-31" }))
        .status,
    ).toBe(409);
    expect(
      (await confirm(app, invoiceId, { amount: 5975, paidOn: "2026-01-30" }))
        .status,
    ).toBe(409);
    const contract = await app.request("/api/v1/me/contract", {
      headers: { authorization: `Bearer ${fixture.token}` },
    });
    expect(await contract.json()).toMatchObject({
      contract: {
        id: fixture.contractId,
        status: "active",
        anchorDate: "2026-01-31",
        preview: false,
        plan: { name: "申込時プラン", priceExclTax: 5432, credits: 1 },
        currentPeriod: {
          seq: 1,
          startsOn: "2026-01-31",
          endsOn: "2026-02-27",
          balance: 1,
        },
      },
    });
    expect(
      (
        await app.request("/api/v1/me/contract?ignored=true", {
          headers: { authorization: `Bearer ${fixture.token}` },
        })
      ).status,
    ).toBe(422);
    const other = await makeApplication();
    const otherContract = await app.request("/api/v1/me/contract", {
      headers: { authorization: `Bearer ${other.token}` },
    });
    expect(otherContract.status).toBe(404);
    await pool.query(
      "update billing_periods set starts_on='2026-02-01',ends_on='2026-02-28' where contract_id=$1",
      [fixture.contractId],
    );
    const notCurrent = await app.request("/api/v1/me/contract", {
      headers: { authorization: `Bearer ${fixture.token}` },
    });
    expect(await notCurrent.json()).toMatchObject({
      contract: { currentPeriod: null },
    });
    await pool.query("update invoices set payment_method='card' where id=$1", [
      invoiceId,
    ]);
    expect(
      (await confirm(app, invoiceId, { amount: 5975, paidOn: "2026-01-31" }))
        .status,
    ).toBe(409);
    await pool.query(
      "update invoices set payment_method='bank_transfer' where id=$1",
      [invoiceId],
    );
    await pool.query("update payments set method='card' where invoice_id=$1", [
      invoiceId,
    ]);
    expect(
      (await confirm(app, invoiceId, { amount: 5975, paidOn: "2026-01-31" }))
        .status,
    ).toBe(409);
  });

  it("confirms a monthly bank invoice into its existing period and grants once", async () => {
    const fixture = await makeApplication({ price: 5000 });
    const partner = await pool.query<{ id: string }>(
      `insert into partners(name,referral_code,reward_type,reward_rate,active)
       values('Reward test partner',$1,'closing',0.200,true) returning id`,
      [`${prefix}-${randomUUID()}`],
    );
    const partnerId = partner.rows[0]?.id;
    if (!partnerId) throw new Error("Partner fixture was not created");
    partnerIds.push(partnerId);
    await pool.query(
      `insert into referrals(partner_id,contract_id,reward_type,reward_rate)
       values($1,$2,'closing',0.200)`,
      [partnerId, fixture.contractId],
    );
    const app = makeApp();
    const initial = await approve(app, fixture.applicationId);
    const initialInvoiceId = (
      (await initial.json()) as { invoice: { id: string } }
    ).invoice.id;
    const initialPayment = await confirm(app, initialInvoiceId, {
      amount: 5500,
      paidOn: "2026-01-31",
    });
    expect(initialPayment.status).toBe(200);
    const firstReward = await pool.query<{
      month_index: number;
      base_amount: number;
      reward_amount: number;
      tax_amount: number;
      paid_on: string | null;
    }>(
      `select pr.month_index,pr.base_amount,pr.reward_amount,pr.tax_amount,pr.paid_on::text
         from partner_rewards pr join payments p on p.id=pr.payment_id where p.invoice_id=$1`,
      [initialInvoiceId],
    );
    expect(firstReward.rows[0]).toMatchObject({
      month_index: 1,
      base_amount: 5000,
      reward_amount: 1000,
      tax_amount: 100,
      paid_on: null,
    });
    const initialPeriod = await pool.query<{ id: string }>(
      "select id from billing_periods where contract_id=$1 and seq=1",
      [fixture.contractId],
    );
    expect(
      await pool.query("select 1 from notifications where dedupe_key=$1", [
        `NT-04:${initialPeriod.rows[0]?.id}:email`,
      ]),
    ).toMatchObject({ rows: [] });

    const period = periodFor("2026-01-31", 1);
    const periodResult = await pool.query<{ id: string }>(
      `insert into billing_periods (contract_id,seq,starts_on,ends_on,plan_id,price_excl_tax,credits)
       values ($1,2,$2,$3,$4,5000,1) returning id`,
      [fixture.contractId, period.startsOn, period.endsOn, planIds.at(-1)],
    );
    const periodId = periodResult.rows[0]?.id;
    if (!periodId) throw new Error("Monthly period fixture was not created");
    const invoiceNo = await pool.query<{ invoice_no: string }>(
      "select next_invoice_no(2026,'KS') invoice_no",
    );
    const snapshot = await pool.query<{
      issuer_snapshot: unknown;
      billing_name: string;
      billing_address_snapshot: string;
    }>(
      "select issuer_snapshot,billing_name,billing_address_snapshot from invoices where id=$1",
      [initialInvoiceId],
    );
    await pool.query(
      `insert into invoices (invoice_no,contract_id,period_id,kind,status,payment_method,issued_on,due_on,
       total_excl_tax,tax_amount,total_incl_tax,billing_name,billing_address_snapshot,issuer_snapshot,pdf_path)
       values ($1,$2,$3,'monthly','issued','bank_transfer','2026-02-28','2026-03-07',5000,500,5500,$4,$5,$6::jsonb,'test-monthly.pdf')`,
      [
        invoiceNo.rows[0]?.invoice_no,
        fixture.contractId,
        periodId,
        snapshot.rows[0]?.billing_name,
        snapshot.rows[0]?.billing_address_snapshot,
        JSON.stringify(snapshot.rows[0]?.issuer_snapshot),
      ],
    );
    const monthlyInvoice = await pool.query<{ id: string }>(
      "select id from invoices where invoice_no=$1",
      [invoiceNo.rows[0]?.invoice_no],
    );
    const monthlyInvoiceId = monthlyInvoice.rows[0]?.id;
    if (!monthlyInvoiceId)
      throw new Error("Monthly invoice fixture was not created");
    await pool.query(
      `insert into invoice_lines (invoice_id,line_kind,description,quantity,unit_price_excl_tax,amount_excl_tax,tax_rate)
       values ($1,'monthly_fee','申込時プラン 月額利用料',1,5000,5000,0.100)`,
      [monthlyInvoiceId],
    );
    const monthlyApp = makeApp(config, new Date("2026-02-28T03:00:00.000Z"));
    const confirmation = await confirm(monthlyApp, monthlyInvoiceId, {
      amount: 5500,
      paidOn: "2026-02-28",
    });
    expect(confirmation.status).toBe(200);
    expect(
      confirmBankPaymentResponseSchema.parse(await confirmation.json()),
    ).toMatchObject({
      contractId: fixture.contractId,
      anchorDate: "2026-01-31",
      period: {
        id: periodId,
        seq: 2,
        startsOn: "2026-02-28",
        endsOn: "2026-03-30",
      },
      replayed: false,
    });
    const replay = await confirm(monthlyApp, monthlyInvoiceId, {
      amount: 5500,
      paidOn: "2026-02-28",
    });
    expect(await replay.json()).toMatchObject({
      replayed: true,
      period: { id: periodId, seq: 2 },
    });
    const state = await pool.query<{
      payment_count: string;
      grant_count: string;
      periods: string;
      notice_count: string;
    }>(
      `select (select count(*)::text from payments where invoice_id=$1) payment_count,
       (select count(*)::text from credit_entries where period_id=$2 and kind='grant') grant_count,
       (select count(*)::text from billing_periods where contract_id=$3) periods,
       (select count(*)::text from notifications where dedupe_key=$4 and channel='email') notice_count`,
      [
        monthlyInvoiceId,
        periodId,
        fixture.contractId,
        `NT-04:${periodId}:email`,
      ],
    );
    expect(state.rows[0]).toEqual({
      payment_count: "1",
      grant_count: "1",
      periods: "2",
      notice_count: "1",
    });
    const secondReward = await pool.query<{
      month_index: number;
      reward_amount: number;
    }>(
      `select pr.month_index,pr.reward_amount from partner_rewards pr
        join payments p on p.id=pr.payment_id where p.invoice_id=$1`,
      [monthlyInvoiceId],
    );
    expect(secondReward.rows[0]).toEqual({
      month_index: 2,
      reward_amount: 1000,
    });
    const reportResponse = await monthlyApp.request(
      "/api/v1/admin/referrals?month=2026-02",
      { headers: { authorization: `Bearer ${adminToken}` } },
    );
    expect(reportResponse.status).toBe(200);
    const report = adminReferralsResponseSchema.parse(
      await reportResponse.json(),
    );
    expect(report.total).toMatchObject({
      count: 1,
      baseAmount: 5000,
      rewardAmount: 1000,
      taxAmount: 100,
      payableAmount: 1100,
    });
  });

  it("creates the next period and monthly invoice once, expiring only the prior granted balance", async () => {
    const fixture = await makeApplication({ price: 5000 });
    const app = makeApp();
    const issued = await approve(app, fixture.applicationId);
    const invoiceId = ((await issued.json()) as { invoice: { id: string } })
      .invoice.id;
    expect(
      (await confirm(app, invoiceId, { amount: 5500, paidOn: "2026-01-31" }))
        .status,
    ).toBe(200);
    // This fixture's accepted terms say `light`; give the persisted plan the
    // same catalog code so the monthly invoice passes the shared DTO schema.
    await pool.query(
      "update plans set code='light',valid_from='1900-01-01' where id=$1",
      [planIds.at(-1)],
    );
    const invoices = new InvoiceRepository(
      pool,
      config,
      { render: async () => pdf },
      () => new Date("2026-02-28T03:00:00.000Z"),
    );
    const job = new DailyBillingJob(pool, invoices);
    const firstRun = await job.runDailyBilling("2026-02-28", {
      contractIds: [fixture.contractId],
    });
    expect(firstRun.createdPeriods).toBeGreaterThanOrEqual(1);
    expect(firstRun.issuedInvoices).toBeGreaterThanOrEqual(1);
    expect(firstRun.expiredCredits).toBeGreaterThanOrEqual(1);
    expect(firstRun.failed).toBe(0);
    const monthly = await pool.query<{
      id: string;
      kind: string;
      total_excl_tax: number;
      tax_amount: number;
      total_incl_tax: number;
      due_on: string;
      period_seq: number;
    }>(
      `select i.id,i.kind,i.total_excl_tax,i.tax_amount,i.total_incl_tax,i.due_on::text due_on,p.seq period_seq
       from invoices i join billing_periods p on p.id=i.period_id where i.contract_id=$1 and i.kind='monthly'`,
      [fixture.contractId],
    );
    expect(monthly.rows).toEqual([
      {
        id: expect.any(String),
        kind: "monthly",
        total_excl_tax: 5000,
        tax_amount: 500,
        total_incl_tax: 5500,
        due_on: "2026-03-07",
        period_seq: 2,
      },
    ]);
    const secondRun = await job.runDailyBilling("2026-02-28", {
      contractIds: [fixture.contractId],
    });
    expect(secondRun.createdPeriods).toBe(0);
    expect(secondRun.issuedInvoices).toBe(0);
    const monthlyNoticeCount = await pool.query<{ count: string }>(
      "select count(*)::text count from notifications where dedupe_key=$1 and channel='email'",
      [`NT-03:invoice:${monthly.rows[0]?.id}:customer`],
    );
    expect(monthlyNoticeCount.rows[0]?.count).toBe("1");
    const ledger = await pool.query<{
      grants: string;
      expirations: string;
      periods: string;
      monthly_invoices: string;
    }>(
      `select (select count(*)::text from credit_entries where contract_id=$1 and kind='grant') grants,
       (select count(*)::text from credit_entries where contract_id=$1 and kind='expire') expirations,
       (select count(*)::text from billing_periods where contract_id=$1) periods,
       (select count(*)::text from invoices where contract_id=$1 and kind='monthly') monthly_invoices`,
      [fixture.contractId],
    );
    expect(ledger.rows[0]).toEqual({
      grants: "1",
      expirations: "1",
      periods: "2",
      monthly_invoices: "1",
    });
  });

  it("lapses an unpaid initial invoice only after its due date and is idempotent", async () => {
    const fixture = await makeApplication();
    const response = await approve(makeApp(), fixture.applicationId);
    expect(response.status).toBe(200);
    const invoiceId = ((await response.json()) as { invoice: { id: string } })
      .invoice.id;
    await pool.query("update invoices set due_on='2026-03-07' where id=$1", [
      invoiceId,
    ]);
    const job = new DailyLifecycleJob(pool);

    expect(
      await job.runDailyLifecycle("2026-03-07", {
        contractIds: [fixture.contractId],
      }),
    ).toMatchObject({ lapsed: 0, failed: 0 });
    expect(
      await job.runDailyLifecycle("2026-03-08", {
        contractIds: [fixture.contractId],
      }),
    ).toMatchObject({ lapsed: 1, failed: 0 });
    expect(
      await job.runDailyLifecycle("2026-03-08", {
        contractIds: [fixture.contractId],
      }),
    ).toMatchObject({ lapsed: 0, failed: 0 });
    const state = await pool.query<{
      contract: string;
      invoice: string;
      deletion_due_on: string;
      transition_date: string | null;
    }>(
      `select c.status contract,i.status invoice,cu.deletion_due_on::text,
         (select detail->>'transitionDate' from audit_logs where action='contract.lapsed' and target_id=c.id::text) transition_date
         from contracts c join invoices i on i.contract_id=c.id join customers cu on cu.id=c.customer_id
       where c.id=$1 and i.kind='initial'`,
      [fixture.contractId],
    );
    expect(state.rows[0]).toEqual({
      contract: "lapsed",
      invoice: "overdue",
      deletion_due_on: "2027-03-08",
      transition_date: "2026-03-08",
    });
  });

  it("ends a cancellation after its final period, expires its balance, and creates no later invoice", async () => {
    const fixture = await makeApplication();
    const planId = planIds.at(-1);
    if (!planId) throw new Error("Lifecycle test plan fixture missing");
    await pool.query(
      "update contracts set status='cancel_scheduled',anchor_date='2026-01-01',ends_on='2026-01-31' where id=$1",
      [fixture.contractId],
    );
    const period = await pool.query<{ id: string }>(
      `insert into billing_periods(contract_id,seq,starts_on,ends_on,plan_id,price_excl_tax,credits)
       values($1,1,'2026-01-01','2026-01-31',$2,5000,1) returning id`,
      [fixture.contractId, planId],
    );
    const periodId = period.rows[0]?.id;
    if (!periodId) throw new Error("Lifecycle test period fixture missing");
    await pool.query(
      "insert into credit_entries(contract_id,period_id,kind,amount) values($1,$2,'grant',1)",
      [fixture.contractId, periodId],
    );
    const job = new DailyBillingJob(
      pool,
      new InvoiceRepository(pool, config, { render: async () => pdf }),
    );
    const result = await job.runDailyBilling("2026-02-01", {
      contractIds: [fixture.contractId],
    });
    expect(result).toMatchObject({
      processedContracts: 1,
      createdPeriods: 0,
      issuedInvoices: 0,
      expiredCredits: 1,
      failed: 0,
    });
    const state = await pool.query<{
      status: string;
      ended_at: string | null;
      ended_on_tokyo_date: string | null;
      deletion_due_on: string;
      expires: string;
      invoices: string;
    }>(
      `select c.status,c.ended_at::text,to_char(c.ended_at at time zone 'Asia/Tokyo','YYYY-MM-DD') ended_on_tokyo_date,
       cu.deletion_due_on::text,
       (select count(*)::text from credit_entries where period_id=$2 and kind='expire') expires,
       (select count(*)::text from invoices where contract_id=c.id) invoices
       from contracts c join customers cu on cu.id=c.customer_id where c.id=$1`,
      [fixture.contractId, periodId],
    );
    expect(state.rows[0]).toMatchObject({
      status: "ended",
      ended_on_tokyo_date: "2026-02-01",
      deletion_due_on: "2027-02-01",
      expires: "1",
      invoices: "0",
    });
    expect(state.rows[0]?.ended_at).toBeTruthy();
    const endNotice = await pool.query<{ count: string }>(
      "select count(*)::text count from notifications where customer_id=(select customer_id from contracts where id=$1) and kind='NT-09' and dedupe_key=$2 and sent_at is null",
      [fixture.contractId, `NT-09:${fixture.contractId}`],
    );
    expect(endNotice.rows[0]?.count).toBe("1");
  });

  it("lapses only the selected expired quote and ignores approved or paid applications", async () => {
    const quoteFixture = await makeApplication({ custom: true });
    const approvedQuoteFixture = await makeApplication({ custom: true });
    const paidFixture = await makeApplication();
    const dueFixture = await makeApplication();
    const activeFixture = await makeApplication();
    const reviewFixture = await makeApplication();
    const quote = await pool.query<{ id: string }>(
      `insert into plan_quotes(contract_id,version,price_excl_tax,credits,description,expires_on,sent_at)
       values($1,1,10000,3,'fixture','2026-03-07',now()) returning id`,
      [quoteFixture.contractId],
    );
    const approvedQuote = await pool.query<{ id: string }>(
      `insert into plan_quotes(contract_id,version,price_excl_tax,credits,description,expires_on,sent_at,approved_at)
       values($1,1,10000,3,'fixture','2026-03-07',now(),now()) returning id`,
      [approvedQuoteFixture.contractId],
    );
    await pool.query(
      "update contracts set status='awaiting_quote_approval' where id=any($1::uuid[])",
      [[quoteFixture.contractId, approvedQuoteFixture.contractId]],
    );
    await pool.query(
      "update contracts set status='awaiting_payment' where id=any($1::uuid[])",
      [[paidFixture.contractId, dueFixture.contractId]],
    );
    await pool.query(
      "update contracts set status='active',anchor_date='2026-02-01' where id=$1",
      [activeFixture.contractId],
    );
    await pool.query(
      `insert into invoices(invoice_no,contract_id,kind,status,payment_method,issued_on,due_on,total_excl_tax,tax_amount,total_incl_tax,billing_name,issuer_snapshot)
       values($1,$2,'initial','paid','bank_transfer','2026-02-28','2026-03-07',5000,500,5500,'fixture','{}'::jsonb),
             ($3,$4,'initial','issued','bank_transfer','2026-02-28','2026-03-07',5000,500,5500,'fixture','{}'::jsonb)`,
      [
        `${prefix}-paid-${randomUUID()}`,
        paidFixture.contractId,
        `${prefix}-due-${randomUUID()}`,
        dueFixture.contractId,
      ],
    );
    // 空のスナップショットの請求書は、他のテストの一覧（入金確認待ちなど）を壊すので、このテストの終了時に必ず消す。
    onTestFinished(async () => {
      await pool.query(
        "delete from invoices where invoice_no like $1 or invoice_no like $2",
        [`${prefix}-paid-%`, `${prefix}-due-%`],
      );
    });
    const job = new DailyLifecycleJob(pool);
    expect(
      await job.runDailyLifecycle("2026-03-07", {
        contractIds: [quoteFixture.contractId],
      }),
    ).toMatchObject({ lapsed: 0, failed: 0 });
    const results = await Promise.all([
      job.runDailyLifecycle("2026-03-08", {
        contractIds: [quoteFixture.contractId],
      }),
      job.runDailyLifecycle("2026-03-08", {
        contractIds: [quoteFixture.contractId],
      }),
    ]);
    expect(results.reduce((sum, result) => sum + result.lapsed, 0)).toBe(1);
    expect(
      await job.runDailyLifecycle("2026-03-08", {
        contractIds: [
          approvedQuoteFixture.contractId,
          paidFixture.contractId,
          activeFixture.contractId,
          reviewFixture.contractId,
        ],
      }),
    ).toMatchObject({ lapsed: 0, failed: 0 });
    const statuses = await pool.query<{ id: string; status: string }>(
      "select id,status from contracts where id=any($1::uuid[])",
      [
        [
          quoteFixture.contractId,
          approvedQuoteFixture.contractId,
          paidFixture.contractId,
          dueFixture.contractId,
          activeFixture.contractId,
          reviewFixture.contractId,
        ],
      ],
    );
    expect(
      Object.fromEntries(statuses.rows.map((row) => [row.id, row.status])),
    ).toEqual({
      [quoteFixture.contractId]: "lapsed",
      [approvedQuoteFixture.contractId]: "awaiting_quote_approval",
      [paidFixture.contractId]: "awaiting_payment",
      [dueFixture.contractId]: "awaiting_payment",
      [activeFixture.contractId]: "active",
      [reviewFixture.contractId]: "under_review",
    });
    expect(quote.rows[0]?.id).toBeTruthy();
    expect(approvedQuote.rows[0]?.id).toBeTruthy();
  });

  it("uses the Tokyo confirmation day independently from a leap-day bank date", async () => {
    const fixture = await makeApplication();
    const issueApp = makeApp(config, new Date("2024-02-27T15:30:00.000Z"));
    const issued = await approve(issueApp, fixture.applicationId);
    const invoiceId = ((await issued.json()) as { invoice: { id: string } })
      .invoice.id;
    const confirmationApp = makeApp(
      config,
      new Date("2024-02-28T15:30:00.000Z"),
    );
    const response = await confirm(confirmationApp, invoiceId, {
      amount: 5500,
      paidOn: "2024-02-28",
    });
    expect(await response.json()).toMatchObject({
      paidOn: "2024-02-28",
      anchorDate: "2024-02-29",
      period: { startsOn: "2024-02-29", endsOn: "2024-03-28" },
    });
  });

  it("rejects mismatched amount and late/future dates without creating any payment", async () => {
    const fixture = await makeApplication();
    const app = makeApp();
    const issued = await approve(app, fixture.applicationId);
    const invoiceId = ((await issued.json()) as { invoice: { id: string } })
      .invoice.id;
    expect(
      (await confirm(app, invoiceId, { amount: 5499, paidOn: "2026-01-31" }))
        .status,
    ).toBe(422);
    expect(
      (await confirm(app, invoiceId, { amount: 5500, paidOn: "2026-02-08" }))
        .status,
    ).toBe(422);
    expect(
      (await confirm(app, invoiceId, { amount: 5500, paidOn: "2026-02-01" }))
        .status,
    ).toBe(422);
    const beforeAcceptedLatePayment = await pool.query<{
      invoice_status: string;
      contract_status: string;
      payment_count: string;
    }>(
      `select i.status invoice_status,c.status contract_status,(select count(*)::text from payments where invoice_id=i.id) payment_count
         from invoices i join contracts c on c.id=i.contract_id where i.id=$1`,
      [invoiceId],
    );
    expect(beforeAcceptedLatePayment.rows[0]).toEqual({
      invoice_status: "issued",
      contract_status: "awaiting_payment",
      payment_count: "0",
    });
    await pool.query("update contracts set status='lapsed' where id=$1", [
      fixture.contractId,
    ]);
    expect(
      (await confirm(app, invoiceId, { amount: 5500, paidOn: "2026-01-31" }))
        .status,
    ).toBe(409);
    await pool.query(
      "update contracts set status='awaiting_payment' where id=$1",
      [fixture.contractId],
    );
    await pool.query(
      "update invoices set status='overdue',issued_on='2026-01-01',due_on='2026-01-30' where id=$1",
      [invoiceId],
    );
    const pending = await app.request("/api/v1/admin/bank-transfers/pending", {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(
      ((await pending.json()) as { items: Array<{ invoice: { id: string } }> })
        .items,
    ).toContainEqual(
      expect.objectContaining({
        invoice: expect.objectContaining({ id: invoiceId }),
      }),
    );
    expect(
      (await confirm(app, invoiceId, { amount: 5500, paidOn: "2026-01-30" }))
        .status,
    ).toBe(200);
  });

  it("serializes simultaneous bank confirmations into one payment, period, grant, and notification set", async () => {
    const fixture = await makeApplication();
    const app = makeApp();
    const issued = await approve(app, fixture.applicationId);
    const invoiceId = ((await issued.json()) as { invoice: { id: string } })
      .invoice.id;
    const responses = await Promise.all([
      confirm(app, invoiceId, { amount: 5500, paidOn: "2026-01-31" }),
      confirm(app, invoiceId, { amount: 5500, paidOn: "2026-01-31" }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const results = (await Promise.all(
      responses.map((response) => response.json()),
    )) as Array<{ paymentId: string; replayed: boolean }>;
    expect(results.map((value) => value.replayed).sort()).toEqual([
      false,
      true,
    ]);
    expect(results[0]?.paymentId).toBe(results[1]?.paymentId);
    const state = await pool.query<{
      payments: string;
      periods: string;
      grants: string;
      notices: string;
    }>(
      `select (select count(*)::text from payments where invoice_id=$1) payments,
       (select count(*)::text from billing_periods where contract_id=$2) periods,
       (select count(*)::text from credit_entries where invoice_id=$1 and kind='grant') grants,
       (select count(*)::text from notifications where payload->>'invoiceId'=$1::text and kind='NT-02b') notices`,
      [invoiceId, fixture.contractId],
    );
    expect(state.rows[0]).toEqual({
      payments: "1",
      periods: "1",
      grants: "1",
      notices: "1",
    });
  });

  it("allows acknowledged preview activation only through the local invoice preview guard and never queues notices", async () => {
    const currentDb = await pool.query<{ name: string }>(
      "select current_database() as name",
    );
    expect(currentDb.rows[0]?.name).toBe("kobito_support_test");
    await pool.query(
      "insert into settings(key,value) values ('invoice_preview_enabled','true'::jsonb) on conflict (key) do update set value='true'::jsonb",
    );
    const localConfig: RuntimeConfig = {
      ...config,
      nodeEnv: "development",
      databaseUrl: "postgres://test@127.0.0.1:5432/kobito_support",
      devInvoicePreview: true,
      authEmulatorHost: "127.0.0.1:9099",
    };
    const fixture = await makeApplication();
    const localApp = makeApp(localConfig);
    const issued = await approve(localApp, fixture.applicationId);
    const issuedBody = (await issued.json()) as {
      invoice: { id: string; preview: boolean };
    };
    const invoiceId = issuedBody.invoice.id;
    expect(issuedBody.invoice.preview).toBe(true);
    expect(
      (
        await confirm(localApp, invoiceId, {
          amount: 5500,
          paidOn: "2026-01-31",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await confirm(makeApp(), invoiceId, {
          amount: 5500,
          paidOn: "2026-01-31",
          previewAcknowledged: true,
        })
      ).status,
    ).toBe(409);
    const productionApp = makeApp({ ...localConfig, nodeEnv: "production" });
    expect(
      (
        await confirm(productionApp, invoiceId, {
          amount: 5500,
          paidOn: "2026-01-31",
          previewAcknowledged: true,
        })
      ).status,
    ).toBe(409);
    const confirmed = await confirm(localApp, invoiceId, {
      amount: 5500,
      paidOn: "2026-01-31",
      previewAcknowledged: true,
    });
    expect(await confirmed.json()).toMatchObject({
      preview: true,
      replayed: false,
    });
    const state = await pool.query<{ notices: string; payments: string }>(
      `select (select count(*)::text from notifications where payload->>'invoiceId'=$1::text and kind='NT-02b') notices,
       (select count(*)::text from payments where invoice_id=$2::uuid) payments`,
      [invoiceId, invoiceId],
    );
    expect(state.rows[0]).toEqual({ notices: "0", payments: "1" });
    await pool.query(
      "update settings set value='false'::jsonb where key='invoice_preview_enabled'",
    );
  });

  it("rolls payment, activation, credits, and queued notices back when the audit record fails", async () => {
    const fixture = await makeApplication();
    const app = makeApp();
    const issued = await approve(app, fixture.applicationId);
    const invoiceId = ((await issued.json()) as { invoice: { id: string } })
      .invoice.id;
    const trigger = `fail_payment_audit_${randomUUID().replaceAll("-", "")}`;
    const fn = `${trigger}_fn`;
    await pool.query(
      `create function ${fn}() returns trigger language plpgsql as $$ begin if new.target_id='${invoiceId}' then raise exception 'forced'; end if; return new; end $$`,
    );
    await pool.query(
      `create trigger ${trigger} before insert on audit_logs for each row execute function ${fn}()`,
    );
    const response = await confirm(app, invoiceId, {
      amount: 5500,
      paidOn: "2026-01-31",
    });
    await pool.query(`drop trigger ${trigger} on audit_logs`);
    await pool.query(`drop function ${fn}()`);
    expect(response.status).toBe(500);
    const state = await pool.query<{
      invoice_status: string;
      contract_status: string;
      payments: string;
      periods: string;
      credits: string;
      notices: string;
    }>(
      `select i.status invoice_status,c.status contract_status,
       (select count(*)::text from payments where invoice_id=i.id) payments,
       (select count(*)::text from billing_periods where contract_id=c.id) periods,
       (select count(*)::text from credit_entries where invoice_id=i.id) credits,
       (select count(*)::text from notifications where payload->>'invoiceId'=i.id::text and kind='NT-02b') notices
       from invoices i join contracts c on c.id=i.contract_id where i.id=$1`,
      [invoiceId],
    );
    expect(state.rows[0]).toEqual({
      invoice_status: "issued",
      contract_status: "awaiting_payment",
      payments: "0",
      periods: "0",
      credits: "0",
      notices: "0",
    });
  });

  it("issues the current tax-exclusive price and keeps an older invoice frozen", async () => {
    const oldOffer = await makeApplication({ price: 5000 });
    const currentOffer = await makeApplication({ price: 10000 });
    const app = makeApp();

    const oldApproval = approveApplicationResponseSchema.parse(
      await (await approve(app, oldOffer.applicationId)).json(),
    );
    expect(oldApproval.invoice).toMatchObject({
      totalExclTax: 5000,
      taxAmount: 500,
      totalInclTax: 5500,
    });

    await pool.query(
      "update plans set price_excl_tax=10000 where id=(select plan_id from applications where id=$1)",
      [oldOffer.applicationId],
    );

    const currentApproval = approveApplicationResponseSchema.parse(
      await (await approve(app, currentOffer.applicationId)).json(),
    );
    expect(currentApproval.invoice).toMatchObject({
      totalExclTax: 10000,
      taxAmount: 1000,
      totalInclTax: 11000,
    });
    const currentInvoiceId = currentApproval.invoice?.id;
    const oldInvoiceId = oldApproval.invoice?.id;
    if (!currentInvoiceId || !oldInvoiceId) {
      throw new Error("Expected both fixed-price applications to be invoiced");
    }

    const currentDetailResponse = await app.request(
      `/api/v1/me/invoices/${currentInvoiceId}`,
      { headers: { authorization: `Bearer ${currentOffer.token}` } },
    );
    const currentDetail = invoiceDetailSchema.parse(
      await currentDetailResponse.json(),
    );
    expect(currentDetail).toMatchObject({
      totalExclTax: 10000,
      taxAmount: 1000,
      totalInclTax: 11000,
      acceptedPlan: { monthlyPriceExclTax: 10000 },
      lines: [{ unitPriceExclTax: 10000, amountExclTax: 10000 }],
    });

    const oldDetailResponse = await app.request(
      `/api/v1/me/invoices/${oldInvoiceId}`,
      { headers: { authorization: `Bearer ${oldOffer.token}` } },
    );
    const oldDetail = invoiceDetailSchema.parse(await oldDetailResponse.json());
    expect(oldDetail).toMatchObject({
      totalExclTax: 5000,
      taxAmount: 500,
      totalInclTax: 5500,
      acceptedPlan: { monthlyPriceExclTax: 5000 },
      lines: [{ unitPriceExclTax: 5000, amountExclTax: 5000 }],
    });
  });

  it("rounds the invoice tax down once and enforces total_incl_tax = total_excl_tax + tax_amount", async () => {
    const fixture = await makeApplication({ price: 5432 });
    const app = makeApp();
    const approval = approveApplicationResponseSchema.parse(
      await (await approve(app, fixture.applicationId)).json(),
    );
    expect(approval.invoice).toMatchObject({
      totalExclTax: 5432,
      taxAmount: 543,
      totalInclTax: 5975,
    });
    await expect(
      pool.query(
        "update invoices set total_incl_tax = total_incl_tax + 1 where id=$1",
        [approval.invoice?.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("creates a frozen, dated bank-transfer invoice from the application offer and replays it without re-rendering", async () => {
    const fixture = await makeApplication({ price: 5432 });
    await pool.query(
      "update plans set price_excl_tax=9999,name='後日変更' where id=(select plan_id from applications where id=$1)",
      [fixture.applicationId],
    );
    const app = makeApp();
    const first = await approve(app, fixture.applicationId);
    expect(first.status).toBe(200);
    const body = (await first.json()) as {
      invoice: {
        id: string;
        invoiceNo: string;
        totalInclTax: number;
        totalExclTax: number;
        taxAmount: number;
        issuedOn: string;
        dueOn: string;
        preview: boolean;
      };
    };
    expect(body.invoice).toMatchObject({
      totalInclTax: 5975,
      totalExclTax: 5432,
      taxAmount: 543,
      issuedOn: "2026-01-31",
      dueOn: "2026-02-07",
      preview: false,
    });
    const renderCalls = renderCount;
    await pool.query(
      "update settings set value='\"設定変更後\"'::jsonb where key='company_name'",
    );
    await pool.query(
      "update customers set billing_address='現住所変更後' where id=$1",
      [fixture.customerId],
    );
    const retry = await approve(app, fixture.applicationId);
    expect(await retry.json()).toMatchObject({
      replayed: true,
      invoice: {
        id: body.invoice.id,
        invoiceNo: body.invoice.invoiceNo,
        issuedOn: "2026-01-31",
        dueOn: "2026-02-07",
      },
    });
    expect(renderCount).toBe(renderCalls);
    const customerPdf = await app.request(
      `/api/v1/me/invoices/${body.invoice.id}/pdf`,
      { headers: { authorization: `Bearer ${fixture.token}` } },
    );
    expect(customerPdf.status).toBe(200);
    expect(customerPdf.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await customerPdf.arrayBuffer())).toEqual(pdf);
    const customerList = await app.request("/api/v1/me/invoices", {
      headers: { authorization: `Bearer ${fixture.token}` },
    });
    expect(await customerList.json()).toMatchObject({
      invoices: [
        expect.objectContaining({
          id: body.invoice.id,
          invoiceNo: body.invoice.invoiceNo,
          issuedOn: "2026-01-31",
          dueOn: "2026-02-07",
        }),
      ],
    });
    const detail = await app.request(`/api/v1/me/invoices/${body.invoice.id}`, {
      headers: { authorization: `Bearer ${fixture.token}` },
    });
    expect(await detail.json()).toMatchObject({
      invoiceNo: body.invoice.invoiceNo,
      issuedOn: "2026-01-31",
      dueOn: "2026-02-07",
      billingAddress: "Billing address snapshot",
      issuer: { companyName: "テスト発行会社" },
      acceptedPlan: {
        planName: "申込時プラン",
        monthlyPriceExclTax: 5432,
        credits: 1,
      },
    });
    const adminList = await app.request("/api/v1/admin/invoices", {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(
      (
        (await adminList.json()) as {
          invoices: Array<{ id: string; invoiceNo: string }>;
        }
      ).invoices,
    ).toContainEqual(
      expect.objectContaining({
        id: body.invoice.id,
        invoiceNo: body.invoice.invoiceNo,
      }),
    );
    const adminDetail = await app.request(
      `/api/v1/admin/invoices/${body.invoice.id}`,
      { headers: { authorization: `Bearer ${adminToken}` } },
    );
    expect(await adminDetail.json()).toMatchObject({
      invoiceNo: body.invoice.invoiceNo,
      acceptedPlan: { monthlyPriceExclTax: 5432 },
    });
    const adminPdf = await app.request(
      `/api/v1/admin/invoices/${body.invoice.id}/pdf`,
      { headers: { authorization: `Bearer ${adminToken}` } },
    );
    expect(adminPdf.status).toBe(200);
    expect(adminPdf.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await adminPdf.arrayBuffer())).toEqual(pdf);
    await pool.query(
      "update invoices set issuer_snapshot=jsonb_set(issuer_snapshot,'{preview}','true'::jsonb) where id=$1",
      [body.invoice.id],
    );
    const productionRepo = new InvoiceRepository(
      pool,
      { ...config, nodeEnv: "production" },
      { render: async () => pdf },
    );
    await expect(
      productionRepo.getCustomerPdf(
        customerScopeFor({
          authUserId: fixture.uid,
          role: "customer",
          customerId: fixture.customerId,
          secondFactor: null,
        }),
        body.invoice.id,
      ),
    ).rejects.toMatchObject({ status: 503, code: "invoice_unavailable" });
    await pool.query(
      "update invoices set issuer_snapshot=jsonb_set(issuer_snapshot,'{preview}','false'::jsonb) where id=$1",
      [body.invoice.id],
    );
    const stored = await pool.query<{
      contract_status: string;
      notification_count: string;
      sent_at: Date | null;
      pdf_count: string;
    }>(
      `select c.status as contract_status,
       (select count(*)::text from notifications where dedupe_key=$2) as notification_count,
       (select sent_at from notifications where dedupe_key=$2) as sent_at,
       (select count(*)::text from invoice_documents where invoice_id=$3) as pdf_count
       from contracts c where c.id=$1`,
      [
        fixture.contractId,
        `NT-02:invoice:${body.invoice.id}:customer`,
        body.invoice.id,
      ],
    );
    expect(stored.rows[0]).toMatchObject({
      contract_status: "awaiting_payment",
      notification_count: "1",
      sent_at: null,
      pdf_count: "1",
    });
  });

  it("voids an unpaid invoice, cancels its queued notices, hides the reason from customers, and permits a fresh initial invoice", async () => {
    const fixture = await makeApplication();
    const app = makeApp();
    const issued = await approve(app, fixture.applicationId);
    const original = ((await issued.json()) as { invoice: { id: string } })
      .invoice;
    await pool.query(
      `insert into notifications(customer_id,kind,channel,dedupe_key,scheduled_at,payload)
       values($1,'NT-05','email',$2,now(),$3::jsonb)`,
      [
        fixture.customerId,
        `NT-05:${original.id}:day1:email`,
        JSON.stringify({ invoiceId: original.id }),
      ],
    );
    const before = await pool.query<{ payments: string; entries: string }>(
      `select (select count(*) from payments p join invoices i on i.id=p.invoice_id where i.contract_id=$1)::text as payments,
              (select count(*) from credit_entries e where e.contract_id=$1)::text as entries`,
      [fixture.contractId],
    );

    const response = await voidInvoice(app, original.id, "請求内容の誤り");
    expect(response.status).toBe(200);
    expect(adminInvoiceDetailSchema.parse(await response.json())).toMatchObject(
      {
        id: original.id,
        status: "void",
        voidReason: "請求内容の誤り",
        voidedAt: expect.any(String),
      },
    );
    const repeat = await voidInvoice(app, original.id, "別の理由");
    expect(repeat.status).toBe(200);
    expect(await repeat.json()).toMatchObject({
      id: original.id,
      status: "void",
    });

    const documentBefore = await pool.query<{
      sha256: string;
      content: Buffer;
    }>("select sha256,content from invoice_documents where invoice_id=$1", [
      original.id,
    ]);
    const regeneratedPdf = await app.request(
      `/api/v1/me/invoices/${original.id}/pdf`,
      { headers: { authorization: `Bearer ${fixture.token}` } },
    );
    expect(regeneratedPdf.status).toBe(200);
    expect(renderedInvoices.at(-1)).toMatchObject({
      id: original.id,
      voidedOn: expect.any(String),
    });
    expect(renderedInvoices.at(-1)).not.toHaveProperty("voidReason");
    const documentAfter = await pool.query<{ sha256: string; content: Buffer }>(
      "select sha256,content from invoice_documents where invoice_id=$1",
      [original.id],
    );
    expect(documentAfter.rows[0]).toEqual(documentBefore.rows[0]);

    const persisted = await pool.query<{
      status: string;
      void_reason: string;
      voided_at: Date;
      replaced_by: string | null;
    }>(
      "select status,void_reason,voided_at,replaced_by from invoices where id=$1",
      [original.id],
    );
    expect(persisted.rows[0]).toMatchObject({
      status: "void",
      void_reason: "請求内容の誤り",
      replaced_by: null,
    });
    expect(persisted.rows[0]?.voided_at).toBeInstanceOf(Date);
    const notices = await pool.query<{
      kind: string;
      attempts: number;
      last_error: string;
    }>(
      "select kind,attempts,last_error from notifications where payload->>'invoiceId'=$1 and sent_at is null",
      [original.id],
    );
    expect(notices.rows.length).toBeGreaterThan(0);
    expect(
      notices.rows.every(
        (notice) => notice.attempts === 3 && notice.last_error === "cancelled",
      ),
    ).toBe(true);
    const after = await pool.query<{ payments: string; entries: string }>(
      `select (select count(*) from payments p join invoices i on i.id=p.invoice_id where i.contract_id=$1)::text as payments,
              (select count(*) from credit_entries e where e.contract_id=$1)::text as entries`,
      [fixture.contractId],
    );
    expect(after.rows).toEqual(before.rows);
    const contract = await pool.query<{ status: string }>(
      "select status from contracts where id=$1",
      [fixture.contractId],
    );
    expect(contract.rows[0]?.status).toBe("awaiting_payment");

    const customerDetail = await app.request(
      `/api/v1/me/invoices/${original.id}`,
      {
        headers: { authorization: `Bearer ${fixture.token}` },
      },
    );
    const customerBody = invoiceDetailSchema.parse(await customerDetail.json());
    const customerJson = JSON.stringify(customerBody);
    expect(customerBody.status).toBe("void");
    expect(customerJson).toContain('"status":"void"');
    expect(customerJson).not.toContain("請求内容の誤り");

    const reissued = await approve(app, fixture.applicationId);
    expect(reissued.status).toBe(200);
    expect(await reissued.json()).toMatchObject({
      replayed: false,
      status: "awaiting_payment",
      invoice: { status: "issued" },
    });
    const linked = await pool.query<{ replaced_by: string | null }>(
      "select replaced_by from invoices where id=$1",
      [original.id],
    );
    expect(linked.rows[0]?.replaced_by).not.toBeNull();
  });

  it("rejects voiding paid, missing, invalid, and non-MFA invoices", async () => {
    const fixture = await makeApplication();
    const app = makeApp();
    const issued = await approve(app, fixture.applicationId);
    const invoiceId = ((await issued.json()) as { invoice: { id: string } })
      .invoice.id;
    const paid = await confirm(app, invoiceId, {
      amount: 5500,
      paidOn: "2026-01-31",
    });
    expect(paid.status).toBe(200);
    expect((await voidInvoice(app, invoiceId, "取消理由")).status).toBe(409);
    expect((await voidInvoice(app, randomUUID(), "取消理由")).status).toBe(404);
    expect((await voidInvoice(app, invoiceId, "  ")).status).toBe(422);
    identities.set(`${prefix}-no-mfa-token`, { uid: adminUid });
    expect(
      (
        await app.request(`/api/v1/admin/invoices/${invoiceId}/void`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${prefix}-no-mfa-token`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ reason: "取消理由" }),
        })
      ).status,
    ).toBe(403);
  });

  it.each([
    "failed",
    "overdue",
  ] as const)("allows cancellation from %s without changing contract state", async (status) => {
    const fixture = await makeApplication();
    const app = makeApp();
    const issued = await approve(app, fixture.applicationId);
    const invoiceId = ((await issued.json()) as { invoice: { id: string } })
      .invoice.id;
    await pool.query("update invoices set status=$2 where id=$1", [
      invoiceId,
      status,
    ]);
    const response = await voidInvoice(app, invoiceId, "支払リンクの再発行");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "void" });
    const contract = await pool.query<{ status: string }>(
      "select status from contracts where id=$1",
      [fixture.contractId],
    );
    expect(contract.rows[0]?.status).toBe("awaiting_payment");
  });

  it("serializes simultaneous approvals into one invoice, one document, one pending notice, and one counter increment", async () => {
    const fixture = await makeApplication();
    const app = makeApp();
    const before = await pool.query<{ last_no: number | null }>(
      "select last_no from invoice_number_counters where year=2026",
    );
    const previous = before.rows[0]?.last_no ?? 0;
    const responses = await Promise.all([
      approve(app, fixture.applicationId),
      approve(app, fixture.applicationId),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const results = (await Promise.all(
      responses.map((response) => response.json()),
    )) as Array<{ replayed: boolean; invoice: { id: string } }>;
    expect(results.filter((result) => result.replayed)).toHaveLength(1);
    expect(results[0]?.invoice.id).toBe(results[1]?.invoice.id);
    const invoiceId = results[0]?.invoice.id;
    if (!invoiceId) throw new Error("Concurrent invoice result was missing");
    const state = await pool.query<{
      invoice_count: string;
      document_count: string;
      notice_count: string;
      counter: number;
    }>(
      `select (select count(*)::text from invoices where contract_id=$1 and kind='initial') invoice_count,
       (select count(*)::text from invoice_documents d join invoices i on i.id=d.invoice_id where i.contract_id=$1) document_count,
       (select count(*)::text from notifications where dedupe_key=$2) notice_count,
       (select last_no from invoice_number_counters where year=2026) counter`,
      [fixture.contractId, `NT-02:invoice:${invoiceId}:customer`],
    );
    expect(state.rows[0]).toMatchObject({
      invoice_count: "1",
      document_count: "1",
      notice_count: "1",
      counter: previous + 1,
    });
  });

  it("leaves no invoice, sequence, review, or contract changes when rendering fails", async () => {
    const fixture = await makeApplication();
    const app = makeApp();
    renderFailure = true;
    const response = await approve(app, fixture.applicationId);
    renderFailure = false;
    expect(response.status).toBe(500);
    const state = await pool.query<{
      status: string;
      review_result: string | null;
      invoice_count: string;
      last_no: number | null;
    }>(
      `select c.status, a.review_result, (select count(*)::text from invoices where contract_id=c.id) invoice_count,
       (select last_no from invoice_number_counters where year=2026) last_no from contracts c join applications a on a.id=c.application_id where c.id=$1`,
      [fixture.contractId],
    );
    expect(state.rows[0]).toMatchObject({
      status: "under_review",
      review_result: null,
      invoice_count: "0",
    });
  });

  it("rolls all issued data back if the audit write fails", async () => {
    const fixture = await makeApplication();
    const name = `fail_invoice_audit_${randomUUID().replaceAll("-", "")}`;
    const fn = `${name}_fn`;
    await pool.query(
      `create function ${fn}() returns trigger language plpgsql as $$ begin if new.target_id='${fixture.applicationId}' then raise exception 'forced'; end if; return new; end $$`,
    );
    await pool.query(
      `create trigger ${name} before insert on audit_logs for each row execute function ${fn}()`,
    );
    const response = await approve(makeApp(), fixture.applicationId);
    await pool.query(`drop trigger ${name} on audit_logs`);
    await pool.query(`drop function ${fn}()`);
    expect(response.status).toBe(500);
    const result = await pool.query<{
      status: string;
      review_result: string | null;
      invoice_count: string;
    }>(
      `select c.status,a.review_result,(select count(*)::text from invoices where contract_id=c.id) invoice_count from contracts c join applications a on a.id=c.application_id where c.id=$1`,
      [fixture.contractId],
    );
    expect(result.rows[0]).toEqual({
      status: "under_review",
      review_result: null,
      invoice_count: "0",
    });
  });

  it("rejects incomplete production issuer setup before any business state changes", async () => {
    const fixture = await makeApplication();
    await pool.query(
      "update settings set value='\"\"'::jsonb where key='invoice_registration_no'",
    );
    const response = await approve(makeApp(), fixture.applicationId);
    expect(response.status).toBe(503);
    await pool.query(
      "update settings set value=$1::jsonb where key='invoice_registration_no'",
      [JSON.stringify("T1234567890123")],
    );
    const state = await pool.query<{
      status: string;
      review_result: string | null;
      invoice_count: string;
    }>(
      `select c.status,a.review_result,(select count(*)::text from invoices where contract_id=c.id) invoice_count from contracts c join applications a on a.id=c.application_id where c.id=$1`,
      [fixture.contractId],
    );
    expect(state.rows[0]).toEqual({
      status: "under_review",
      review_result: null,
      invoice_count: "0",
    });
  });

  it("moves custom applications to quoting without issuing or assigning an invoice", async () => {
    const fixture = await makeApplication({ custom: true });
    const response = await approve(makeApp(), fixture.applicationId);
    expect(await response.json()).toMatchObject({
      status: "quoting",
      invoice: null,
      replayed: false,
    });
    const state = await pool.query<{ status: string; invoice_count: string }>(
      `select c.status,(select count(*)::text from invoices where contract_id=c.id) invoice_count from contracts c where c.id=$1`,
      [fixture.contractId],
    );
    expect(state.rows[0]).toEqual({ status: "quoting", invoice_count: "0" });
  });

  it("rejects an incomplete fixed-plan offer instead of reclassifying it as a custom quote", async () => {
    const fixture = await makeApplication();
    await pool.query(
      "update applications set shown_terms=jsonb_set(shown_terms,'{priceExclTax}','null'::jsonb) where id=$1",
      [fixture.applicationId],
    );
    expect((await approve(makeApp(), fixture.applicationId)).status).toBe(409);
    const state = await pool.query<{
      status: string;
      review_result: string | null;
    }>(
      "select c.status,a.review_result from contracts c join applications a on a.id=c.application_id where c.id=$1",
      [fixture.contractId],
    );
    expect(state.rows[0]).toEqual({
      status: "under_review",
      review_result: null,
    });
  });

  it.each([
    "card",
    "konbini",
  ])("rejects %s payment when card payments are disabled and does not mark it approved", async (paymentMethod) => {
    const fixture = await makeApplication({ paymentMethod });
    expect((await approve(makeApp(), fixture.applicationId)).status).toBe(409);
    const state = await pool.query<{
      status: string;
      review_result: string | null;
    }>(
      "select c.status,a.review_result from contracts c join applications a on a.id=c.application_id where c.id=$1",
      [fixture.contractId],
    );
    expect(state.rows[0]).toEqual({
      status: "under_review",
      review_result: null,
    });
  });

  it("approves an enabled card application and issues the inclusive initial invoice", async () => {
    const fixture = await makeApplication({
      paymentMethod: "card",
      price: 5000,
    });
    const enabledConfig = {
      ...config,
      komojuSecretKey: "test-key",
      cardPaymentEnabled: true,
    };
    const response = await approve(
      makeApp(enabledConfig),
      fixture.applicationId,
    );
    expect(response.status).toBe(200);
    const body = approveApplicationResponseSchema.parse(await response.json());
    expect(body).toMatchObject({
      status: "awaiting_payment",
      invoice: {
        paymentMethod: "card",
        totalExclTax: 5000,
        taxAmount: 500,
        totalInclTax: 5500,
      },
    });
    const persisted = await pool.query<{
      payment_method: string;
      total_excl_tax: number;
      tax_amount: number;
      total_incl_tax: number;
    }>(
      "select payment_method,total_excl_tax,tax_amount,total_incl_tax from invoices where contract_id=$1",
      [fixture.contractId],
    );
    expect(persisted.rows[0]).toEqual({
      payment_method: "card",
      total_excl_tax: 5000,
      tax_amount: 500,
      total_incl_tax: 5500,
    });
  });

  it("returns 404 for another customer's invoice details and PDF, and requires admin MFA", async () => {
    const owner = await makeApplication();
    const other = await makeApplication();
    const app = makeApp();
    const created = await approve(app, owner.applicationId);
    const invoiceId = ((await created.json()) as { invoice: { id: string } })
      .invoice.id;
    const detail = await app.request(`/api/v1/me/invoices/${invoiceId}`, {
      headers: { authorization: `Bearer ${other.token}` },
    });
    const otherPdf = await app.request(`/api/v1/me/invoices/${invoiceId}/pdf`, {
      headers: { authorization: `Bearer ${other.token}` },
    });
    expect(detail.status).toBe(404);
    expect(otherPdf.status).toBe(404);
    identities.set(`${prefix}-no-mfa-token`, { uid: adminUid });
    expect(
      (
        await app.request(`/api/v1/admin/invoices/${invoiceId}`, {
          headers: { authorization: `Bearer ${prefix}-no-mfa-token` },
        })
      ).status,
    ).toBe(403);
  });

  it("returns safe issuer-readiness status without exposing issuer settings", async () => {
    const response = await makeApp().request(
      "/api/v1/admin/invoices/readiness",
      { headers: { authorization: `Bearer ${adminToken}` } },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      canIssue: true,
      mode: "live",
      reason: "ready",
    });
  });

  it("issues extra-credit invoices once for the authenticated active contract", async () => {
    const fixture = await makeApplication();
    const app = makeApp();
    const approved = await approve(app, fixture.applicationId);
    const invoiceId = ((await approved.json()) as { invoice: { id: string } })
      .invoice.id;
    const confirmation = await confirm(app, invoiceId, {
      amount: 5500,
      paidOn: "2026-01-31",
    });
    expect(confirmation.status).toBe(200);
    confirmBankPaymentResponseSchema.parse(await confirmation.json());
    // このフィクスチャの受諾済みプランのコードは長すぎて請求書のDTO検証に通らないので、標準のプランコードにそろえる。
    // (code, valid_from) は一意なので、他のテストと重ならない日付にする。
    await pool.query(
      "update plans set code='light',valid_from='1899-01-01' where id=$1",
      [planIds.at(-1)],
    );
    const headers = {
      authorization: `Bearer ${fixture.token}`,
      "content-type": "application/json",
      "Idempotency-Key": "extra-credit-purchase-test-1",
    };
    const purchase = await app.request("/api/v1/me/extra-credits", {
      method: "POST",
      headers,
      body: JSON.stringify({ quantity: 3 }),
    });
    expect(purchase.status).toBe(201);
    const body = extraCreditPurchaseResponseSchema.parse(await purchase.json());
    expect(body).toMatchObject({
      totalExclTax: 12000,
      taxAmount: 1200,
      totalInclTax: 13200,
      paymentMethod: "bank_transfer",
    });
    const replay = await app.request("/api/v1/me/extra-credits", {
      method: "POST",
      headers,
      body: JSON.stringify({ quantity: 3 }),
    });
    expect(
      extraCreditPurchaseResponseSchema.parse(await replay.json()),
    ).toEqual(body);
    const conflict = await app.request("/api/v1/me/extra-credits", {
      method: "POST",
      headers,
      body: JSON.stringify({ quantity: 2 }),
    });
    expect(conflict.status).toBe(409);
    const persisted = await pool.query<{
      contract_id: string;
      period_id: string | null;
      quantity: number;
      amount_excl_tax: number;
    }>(
      `select i.contract_id,i.period_id,l.quantity,l.amount_excl_tax from invoices i
       join invoice_lines l on l.invoice_id=i.id where i.id=$1`,
      [body.invoiceId],
    );
    expect(persisted.rows[0]).toEqual({
      contract_id: fixture.contractId,
      period_id: null,
      quantity: 3,
      amount_excl_tax: 12000,
    });
    const detail = await app.request(`/api/v1/me/invoices/${body.invoiceId}`, {
      headers: { authorization: `Bearer ${fixture.token}` },
    });
    expect(invoiceDetailSchema.parse(await detail.json())).toMatchObject({
      kind: "extra_credit",
      totalExclTax: 12000,
    });
    // 契約日（2026-01-31）の最初の期間（〜2/27）の中の日付で入金する。次の期間は日次処理が走るまで存在しない。
    const confirmationApp = makeApp(
      config,
      new Date("2026-02-05T03:00:00.000Z"),
    );
    const paid = await confirm(confirmationApp, body.invoiceId, {
      amount: 13200,
      paidOn: "2026-02-05",
    });
    expect(paid.status).toBe(200);
    const ledger = await pool.query<{
      entry_period: string;
      expected_period: string;
      amount: number;
      invoice_period: string | null;
    }>(
      `select e.period_id::text entry_period,
              (select p.id::text from billing_periods p where p.contract_id=$1 and p.starts_on <= date '2026-02-05' and p.ends_on >= date '2026-02-05' order by p.seq desc limit 1) expected_period,
              e.amount,i.period_id::text invoice_period
         from credit_entries e join invoices i on i.id=e.invoice_id
        where e.invoice_id=$2 and e.kind='extra'`,
      [fixture.contractId, body.invoiceId],
    );
    expect(ledger.rows).toEqual([
      expect.objectContaining({ amount: 3, invoice_period: null }),
    ]);
    expect(ledger.rows[0]?.entry_period).toBe(ledger.rows[0]?.expected_period);
    const scheduled = await pool.query<{ kind: string; count: string }>(
      `select kind,count(*)::text count from notifications where payload->>'invoiceId'=$1 group by kind`,
      [body.invoiceId],
    );
    expect(scheduled.rows).toEqual(
      expect.arrayContaining([
        { kind: "NT-03", count: "1" },
        { kind: "NT-04", count: "1" },
      ]),
    );
    const pending = await makeApplication();
    const rejected = await app.request("/api/v1/me/extra-credits", {
      method: "POST",
      headers: {
        authorization: `Bearer ${pending.token}`,
        "content-type": "application/json",
        "Idempotency-Key": "pending-purchase",
      },
      body: JSON.stringify({ quantity: 1 }),
    });
    expect(rejected.status).toBe(404);
    const outsider = await makeApplication();
    const forbidden = await app.request(
      `/api/v1/me/invoices/${body.invoiceId}`,
      {
        headers: { authorization: `Bearer ${outsider.token}` },
      },
    );
    expect(forbidden.status).toBe(404);
  });

  it("formats invoice counters without truncation after 99,999", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "insert into invoice_number_counters(year,last_no) values (9997,99999) on conflict(year) do update set last_no=99999",
      );
      const result = await client.query<{ invoice_no: string }>(
        "select next_invoice_no(9997,'ZZ') as invoice_no",
      );
      expect(result.rows[0]?.invoice_no).toBe("ZZ-9997-100000");
      await client.query("rollback");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  });

  it("issues production invoices to GCS and returns only the scoped PDF after checksum verification", async () => {
    const fixture = await makeApplication();
    const objects = new Map<string, Uint8Array>();
    const store: PdfStore = {
      put: async (key, bytes) => {
        const existing = objects.get(key);
        if (existing && !Buffer.from(existing).equals(Buffer.from(bytes)))
          throw new Error("object conflict");
        objects.set(key, new Uint8Array(bytes));
      },
      get: async (key) => {
        const value = objects.get(key);
        if (!value) throw new Error("not found");
        return new Uint8Array(value);
      },
    };
    const runtimeConfig: RuntimeConfig = {
      ...config,
      nodeEnv: "production",
      pdfStorage: "gcs",
      pdfBucket: "private-test-bucket",
    };
    const app = makeApp(runtimeConfig, new Date("2026-01-30T15:30:00Z"), store);
    const response = await approve(app, fixture.applicationId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { invoice: { id: string } };
    const document = await pool.query<{
      content: Buffer | null;
      storage_key: string | null;
      sha256: string;
    }>(
      "select content, storage_key, sha256 from invoice_documents where invoice_id=$1",
      [body.invoice.id],
    );
    expect(document.rows[0]).toMatchObject({
      content: null,
      storage_key: `invoices/${body.invoice.id}.pdf`,
    });
    expect(objects.has(document.rows[0]?.storage_key ?? "")).toBe(true);
    const ownerPdf = await app.request(
      `/api/v1/me/invoices/${body.invoice.id}/pdf`,
      {
        headers: { authorization: `Bearer ${fixture.token}` },
      },
    );
    expect(ownerPdf.status).toBe(200);
    expect(Buffer.from(await ownerPdf.arrayBuffer())).toEqual(pdf);
    const other = await makeApplication();
    const otherPdf = await app.request(
      `/api/v1/me/invoices/${body.invoice.id}/pdf`,
      {
        headers: { authorization: `Bearer ${other.token}` },
      },
    );
    expect(otherPdf.status).toBe(404);
    objects.set(
      document.rows[0]?.storage_key ?? "",
      Buffer.from("%PDF-corrupt"),
    );
    await expect(
      new InvoiceRepository(
        pool,
        runtimeConfig,
        { render: async () => pdf },
        () => new Date(),
        store,
      ).getCustomerPdf(
        customerScopeFor({
          authUserId: fixture.uid,
          role: "customer",
          customerId: fixture.customerId,
          secondFactor: null,
        }),
        body.invoice.id,
      ),
    ).rejects.toThrow(/checksum/i);
  });

  it("rolls back production invoice issuance when the GCS store fails", async () => {
    const fixture = await makeApplication();
    const store: PdfStore = {
      put: async () => {
        throw new Error("simulated storage failure");
      },
      get: async () => {
        throw new Error("not found");
      },
    };
    const runtimeConfig: RuntimeConfig = {
      ...config,
      nodeEnv: "production",
      pdfStorage: "gcs",
      pdfBucket: "private-test-bucket",
    };
    const app = makeApp(runtimeConfig, new Date("2026-01-30T15:30:00Z"), store);
    const response = await approve(app, fixture.applicationId);
    expect(response.status).toBe(500);
    const state = await pool.query<{ invoice_count: string; status: string }>(
      `select (select count(*)::text from invoices where contract_id=$1) invoice_count,
       (select status from contracts where id=$1) status`,
      [fixture.contractId],
    );
    expect(state.rows[0]).toEqual({
      invoice_count: "0",
      status: "under_review",
    });
  });

  it("keeps production invoice issuance unavailable when storage remains PostgreSQL", async () => {
    const fixture = await makeApplication();
    const app = makeApp({
      ...config,
      nodeEnv: "production",
      pdfStorage: "postgres",
    });
    const response = await approve(app, fixture.applicationId);
    expect(response.status).toBe(503);
    const state = await pool.query<{ invoice_count: string; status: string }>(
      `select (select count(*)::text from invoices where contract_id=$1) invoice_count,
       (select status from contracts where id=$1) status`,
      [fixture.contractId],
    );
    expect(state.rows[0]).toEqual({
      invoice_count: "0",
      status: "under_review",
    });
  });
});
