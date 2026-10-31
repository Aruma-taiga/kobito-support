import { randomUUID } from "node:crypto";
import {
  approveApplicationResponseSchema,
  customerAccessSchema,
  invoiceDetailSchema,
  paymentLinkResponseSchema,
  welcomeSeenResponseSchema,
} from "@kobito/shared";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AppDependencies, createApp } from "../../app.js";
import { FakeKomojuClient } from "../../integrations/komoju/fake-client.js";
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
const userIds: string[] = [adminUid];
const pdf = Buffer.from("%PDF-1.7\ninvoice fixture\n");
let renderFailure = false;
let renderCount = 0;

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
): ReturnType<typeof createApp> {
  const accounts = new AccountsRepository(pool);
  const invoiceRepository = new InvoiceRepository(
    pool,
    runtimeConfig,
    {
      render: async () => {
        renderCount += 1;
        if (renderFailure) throw new Error("render failed");
        return pdf;
      },
    },
    () => now,
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
      invoiceAccessUntil: "2026-03-01",
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
    }>(
      `select c.status, (select count(*)::text from payments where invoice_id=$2) payment_count,
       (select count(*)::text from billing_periods where contract_id=c.id) period_count,
       (select count(*)::text from credit_entries where contract_id=c.id and kind='grant' and invoice_id=$2) grant_count,
       (select paid_on::text from payments where invoice_id=$2) payment_date
       from contracts c where c.id=$1`,
      [fixture.contractId, invoiceId],
    );
    expect(state.rows[0]).toEqual({
      status: "active",
      payment_count: "1",
      period_count: "1",
      grant_count: "1",
      payment_date: "2026-01-31",
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
       (select count(*)::text from notifications where payload->>'invoiceId'=$1::text and kind in ('NT-02b','NT-04')) notices`,
      [invoiceId, fixture.contractId],
    );
    expect(state.rows[0]).toEqual({
      payments: "1",
      periods: "1",
      grants: "1",
      notices: "2",
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
      `select (select count(*)::text from notifications where payload->>'invoiceId'=$1::text and kind in ('NT-02b','NT-04')) notices,
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
       (select count(*)::text from notifications where payload->>'invoiceId'=i.id::text and kind in ('NT-02b','NT-04')) notices
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
});
