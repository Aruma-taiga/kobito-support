import { randomUUID } from "node:crypto";
import {
  applicationReceiptSchema,
  approveApplicationResponseSchema,
  confirmBankPaymentResponseSchema,
  extraCreditPurchaseResponseSchema,
  publicPlansSchema,
} from "@kobito/shared";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AppDependencies, createApp } from "../app.js";
import { FakeKomojuClient } from "../integrations/komoju/fake-client.js";
import { FakeMailSender } from "../integrations/mail/sender.js";
import { DailyBillingJob } from "../jobs/daily-billing.js";
import { runNotificationDispatch } from "../jobs/notifications.js";
import { runRetentionPurge } from "../jobs/retention.js";
import { AccountsRepository } from "../modules/accounts/repository.js";
import { AdminRepository } from "../modules/admin/repository.js";
import { AdminService } from "../modules/admin/service.js";
import { ApplicationsRepository } from "../modules/applications/repository.js";
import { ApplicationsService } from "../modules/applications/service.js";
import { PostgresCustomerAccessRepository } from "../modules/customer-access/repository.js";
import { CustomerAccessService } from "../modules/customer-access/service.js";
import { InvoiceRepository } from "../modules/invoices/repository.js";
import { InvoiceService } from "../modules/invoices/service.js";
import { PostgresPaymentLinkRepository } from "../modules/payment-links/repository.js";
import { PaymentLinkService } from "../modules/payment-links/service.js";
import { ReferralRepository } from "../modules/referrals/repository.js";
import { ReferralService } from "../modules/referrals/service.js";
import { RequestRepository } from "../modules/requests/repository.js";
import { RequestService } from "../modules/requests/service.js";
import type { VerifiedIdentity } from "../platform/auth.js";
import type { RuntimeConfig } from "../platform/config.js";
import { KomojuEventProcessor } from "../webhooks/komoju-processor.js";
import { KomojuInboxRepository } from "../webhooks/komoju-repository.js";

// Local DB-only rehearsal. Run explicitly with the repository's DB test command.
const pool = new Pool({
  connectionString:
    process.env.TEST_DATABASE_URL ??
    "postgres://kobito:kobito@127.0.0.1:5432/kobito_support_test",
});
const prefix = `rehearsal-${randomUUID()}`;
const adminUid = `${prefix}-admin`;
const adminToken = `${prefix}-admin-token`;
const identities = new Map<string, VerifiedIdentity>([
  [adminToken, { uid: adminUid, firebase: { sign_in_second_factor: "phone" } }],
]);
const settings = [
  ["service_name", "リハーサルサービス"],
  ["company_name", "リハーサル会社"],
  ["company_address", "東京都テスト区1-2-3"],
  ["invoice_registration_no", "T1234567890123"],
  ["invoice_prefix", "KS"],
  ["contact_email", "office@example.test"],
  [
    "bank_account",
    {
      bank_name: "テスト銀行",
      branch_name: "テスト支店",
      account_type: "普通",
      account_number: "1234567",
      account_holder: "リハーサル会社",
    },
  ],
] as const;
const settingsBackup = new Map<string, unknown>();
const extraSettings = [
  "application_legal_documents",
  "invoice_preview_enabled",
];
const customerIds: string[] = [];
const applicationIds: string[] = [];
const contractIds: string[] = [];
const invoiceIds: string[] = [];
const planIds: string[] = [];
const partnerIds: string[] = [];
const referralIds: string[] = [];
const requestIds: string[] = [];
const estimateIds: string[] = [];
const eventIds: string[] = [];
const userIds = [adminUid];
const config: RuntimeConfig = {
  nodeEnv: "development",
  databaseUrl: "postgres://kobito:kobito@127.0.0.1:55433/kobito_support",
  firebaseProjectId: "demo-kobito-support",
  authEmulatorHost: "127.0.0.1:9099",
  webOrigin: "http://localhost:5173",
  port: 3000,
  invoicePrefix: "KS",
  devInvoicePreview: false,
  komojuSecretKey: "fake-test-secret",
  cardPaymentEnabled: true,
};
const komoju = new FakeKomojuClient();
const inbox = new KomojuInboxRepository(
  pool,
  () => new Date("2026-11-01T00:30:00.000Z"),
);
const processor = new KomojuEventProcessor({
  listUnprocessed: async (limit) => {
    const result = await pool.query<{ id: string }>(
      "select id from komoju_events where id=any($1::text[]) and processed_at is null order by received_at,id limit $2",
      [eventIds, limit],
    );
    return result.rows.map((row) => row.id);
  },
  processEvent: (id) => inbox.processEvent(id),
  recordProcessingFailure: (id, code) =>
    inbox.recordProcessingFailure(id, code),
});

function requireRow<T>(row: T | null | undefined): NonNullable<T> {
  if (!row) throw new Error("Expected rehearsal fixture row");
  return row as NonNullable<T>;
}

function makeApp(now: Date) {
  const accounts = new AccountsRepository(pool);
  const invoiceRepository = new InvoiceRepository(
    pool,
    config,
    { render: async () => Buffer.from("%PDF-1.7 rehearsal") },
    () => now,
  );
  const dependencies: AppDependencies = {
    config,
    verifier: {
      verifyIdToken: async (token) => {
        const identity = identities.get(token);
        if (!identity) throw new Error("invalid test identity");
        return identity;
      },
    },
    accounts,
    applications: new ApplicationsService(
      new ApplicationsRepository(pool),
      config,
    ),
    admin: new AdminService(new AdminRepository(pool)),
    invoices: new InvoiceService(invoiceRepository),
    referrals: new ReferralService(new ReferralRepository(pool)),
    requests: new RequestService(new RequestRepository(pool, () => now)),
    paymentLinks: new PaymentLinkService(
      new PostgresPaymentLinkRepository(pool),
      komoju,
      config.webOrigin,
    ),
    customerAccess: new CustomerAccessService(
      new PostgresCustomerAccessRepository(pool, () => now),
      () => now,
    ),
    publicSettings: {
      getServiceName: async () => "リハーサルサービス",
      getContactEmail: async () => "office@example.test",
    },
    komojuInbox: inbox,
    logger: { info: () => {}, error: () => {} },
  };
  return createApp(dependencies);
}

async function createCustomer(
  app: ReturnType<typeof createApp>,
  label: string,
  method: "bank_transfer" | "card" = "bank_transfer",
  referralCode?: string,
) {
  const suffix = randomUUID();
  const uid = `${prefix}-${label}-${suffix}`;
  const token = `${uid}-token`;
  const email = `${suffix}@example.test`;
  userIds.push(uid);
  identities.set(token, { uid, email });
  const catalogResponse = await app.request("/api/v1/public/plans");
  const catalog = publicPlansSchema.parse(await catalogResponse.json());
  const submitted = await app.request("/api/v1/applications", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: JSON.stringify({
      shopName: `${prefix}-${label}-${suffix}`,
      contactName: `担当-${label}`,
      email,
      phone: "090-0000-0000",
      planCode: "light",
      billingName: `請求先-${label}`,
      billingAddress: "東京都テスト区1-2-3",
      paymentMethod: method,
      lineDisplayName: "テストLINE表示名",
      freeText: "通しリハーサル",
      consentBusinessUse: true,
      consentTerms: true,
      consentMarketing: false,
      ...(referralCode ? { consentPartnerShare: true } : {}),
      ...(referralCode ? { referralCode } : {}),
      displayVersion: catalog.displayVersion,
    }),
  });
  expect(submitted.status).toBe(201);
  const receipt = applicationReceiptSchema.parse(await submitted.json());
  const application = { id: receipt.applicationId };
  applicationIds.push(application.id);
  const contract = { id: receipt.contractId };
  contractIds.push(contract.id);
  const customer = requireRow(
    (
      await pool.query<{ id: string }>(
        "select customer_id as id from user_accounts where auth_user_id=$1",
        [uid],
      )
    ).rows[0],
  );
  customerIds.push(customer.id);
  return {
    customerId: customer.id,
    applicationId: application.id,
    contractId: contract.id,
    token,
  };
}

function adminHeaders() {
  return {
    authorization: `Bearer ${adminToken}`,
    "content-type": "application/json",
  };
}
function customerHeaders(token: string) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

beforeAll(async () => {
  const old = await pool.query<{ key: string; value: unknown }>(
    "select key,value from settings where key=any($1::text[])",
    [[...settings.map(([key]) => key), ...extraSettings]],
  );
  for (const row of old.rows) settingsBackup.set(row.key, row.value);
  for (const [key, value] of settings)
    await pool.query(
      "insert into settings(key,value) values($1,$2::jsonb) on conflict(key) do update set value=excluded.value",
      [key, JSON.stringify(value)],
    );
  const legalDocuments = {
    status: "draft",
    terms: {
      url: "https://legal.example.test/terms",
      version: `${prefix}-terms`,
    },
    privacy: {
      url: "https://legal.example.test/privacy",
      version: `${prefix}-privacy`,
    },
    disclosure: {
      url: "https://legal.example.test/disclosure",
      version: `${prefix}-disclosure`,
    },
  };
  await pool.query(
    "insert into settings(key,value) values('application_legal_documents',$1::jsonb),('invoice_preview_enabled','false'::jsonb) on conflict(key) do update set value=excluded.value",
    [JSON.stringify(legalDocuments)],
  );
  await pool.query(
    "insert into user_accounts(auth_user_id,customer_id,role) values($1,null,'admin')",
    [adminUid],
  );
});

afterAll(async () => {
  try {
    await pool.query("delete from komoju_events where id=any($1::text[])", [
      eventIds,
    ]);
    await pool.query("delete from audit_logs where target_id=any($1::text[])", [
      [...contractIds, ...applicationIds, ...invoiceIds, ...requestIds],
    ]);
    await pool.query(
      "delete from application_submission_keys where auth_user_id=any($1::text[])",
      [userIds],
    );
    await pool.query(
      "delete from notifications where customer_id=any($1::uuid[])",
      [customerIds],
    );
    await pool.query(
      "delete from partner_rewards where referral_id=any($1::uuid[])",
      [referralIds],
    );
    await pool.query("delete from referrals where id=any($1::uuid[])", [
      referralIds,
    ]);
    await pool.query(
      "delete from credit_entries where contract_id=any($1::uuid[])",
      [contractIds],
    );
    await pool.query("delete from payments where invoice_id=any($1::uuid[])", [
      invoiceIds,
    ]);
    await pool.query(
      "delete from invoice_documents where invoice_id=any($1::uuid[])",
      [invoiceIds],
    );
    await pool.query(
      "delete from invoice_lines where invoice_id=any($1::uuid[])",
      [invoiceIds],
    );
    await pool.query("delete from invoices where id=any($1::uuid[])", [
      invoiceIds,
    ]);
    await pool.query(
      "update service_requests set approved_estimate_id=null where id=any($1::uuid[])",
      [requestIds],
    );
    await pool.query("delete from estimates where request_id=any($1::uuid[])", [
      requestIds,
    ]);
    await pool.query("delete from service_requests where id=any($1::uuid[])", [
      requestIds,
    ]);
    await pool.query(
      "delete from billing_periods where contract_id=any($1::uuid[])",
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
      [userIds],
    );
    await pool.query("delete from customers where id=any($1::uuid[])", [
      customerIds,
    ]);
    await pool.query("delete from plans where id=any($1::uuid[])", [planIds]);
    await pool.query("delete from partners where id=any($1::uuid[])", [
      partnerIds,
    ]);
    for (const key of [...settings.map(([name]) => name), ...extraSettings]) {
      const value = settingsBackup.get(key);
      if (value === undefined)
        await pool.query("delete from settings where key=$1", [key]);
      else
        await pool.query("update settings set value=$2::jsonb where key=$1", [
          key,
          JSON.stringify(value),
        ]);
    }
  } finally {
    await pool.end();
  }
});

describe("第6回 ローカルDB通しリハーサル", () => {
  it("実アプリと定時処理で銀行振込の申込みから匿名化までを通す", async () => {
    const app = makeApp(new Date("2026-11-01T00:30:00.000Z"));
    const partner = requireRow(
      (
        await pool.query<{ id: string }>(
          `insert into partners(name,referral_code,reward_type,reward_rate,active) values('紹介パートナー',$1,'closing',0.2,true) returning id`,
          [`${prefix}-ref-${randomUUID()}`],
        )
      ).rows[0],
    );
    partnerIds.push(partner.id);
    const referralCode = requireRow(
      (
        await pool.query<{ referral_code: string }>(
          "select referral_code from partners where id=$1",
          [partner.id],
        )
      ).rows[0],
    ).referral_code;
    const fixture = await createCustomer(
      app,
      "bank",
      "bank_transfer",
      referralCode,
    );
    const referral = requireRow(
      (
        await pool.query<{ id: string }>(
          "select id from referrals where contract_id=$1",
          [fixture.contractId],
        )
      ).rows[0],
    );
    referralIds.push(referral.id);

    const reviewed = await app.request(
      `/api/v1/admin/applications/${fixture.applicationId}/approve`,
      { method: "POST", headers: adminHeaders(), body: "{}" },
    );
    expect(reviewed.status).toBe(200);
    const approved = approveApplicationResponseSchema.parse(
      await reviewed.json(),
    );
    const initialInvoice = requireRow(approved.invoice);
    invoiceIds.push(initialInvoice.id);
    expect(initialInvoice).toMatchObject({
      totalExclTax: 5000,
      taxAmount: 500,
      totalInclTax: 5500,
      status: "issued",
    });
    expect(
      (
        await pool.query<{ preview: boolean }>(
          "select coalesce((issuer_snapshot->>'preview')::boolean,false) as preview from invoices where id=$1",
          [initialInvoice.id],
        )
      ).rows[0]?.preview,
    ).toBe(false);
    expect(
      (
        await pool.query<{ kind: string }>(
          "select kind from notifications where customer_id=$1 order by kind",
          [fixture.customerId],
        )
      ).rows.map((r) => r.kind),
    ).toEqual(["NT-01", "NT-02"]);
    // S-03 は当社あての通知で顧客IDを持たないので、申込みIDで別に確認する。
    expect(
      (
        await pool.query<{ kind: string; customer_id: string | null }>(
          "select kind,customer_id from notifications where dedupe_key=$1",
          [`S-03:application:${fixture.applicationId}:operations:email`],
        )
      ).rows,
    ).toEqual([{ kind: "S-03", customer_id: null }]);
    const stranger = await createCustomer(app, "stranger");
    expect(
      (
        await app.request(`/api/v1/me/invoices/${initialInvoice.id}`, {
          headers: customerHeaders(stranger.token),
        })
      ).status,
    ).toBe(404);

    const confirm = () =>
      app.request(
        `/api/v1/admin/invoices/${initialInvoice.id}/confirm-payment`,
        {
          method: "POST",
          headers: adminHeaders(),
          body: JSON.stringify({ amount: 5500, paidOn: "2026-11-01" }),
        },
      );
    const paid = await confirm();
    expect(
      confirmBankPaymentResponseSchema.parse(await paid.json()),
    ).toMatchObject({
      amount: 5500,
      paidOn: "2026-11-01",
      preview: false,
      replayed: false,
      period: { seq: 1, priceExclTax: 5000, credits: 1 },
    });
    // 同じ入金確認の再送は、二重にならず「再送」として返る。
    const replayedPayment = await confirm();
    expect(
      confirmBankPaymentResponseSchema.parse(await replayedPayment.json()),
    ).toMatchObject({ replayed: true });
    const activated = await pool.query<{
      status: string;
      anchor_date: string;
      seq: number;
      credits: number;
    }>(
      "select c.status,c.anchor_date::text,bp.seq,bp.credits from contracts c join billing_periods bp on bp.contract_id=c.id where c.id=$1",
      [fixture.contractId],
    );
    expect(activated.rows[0]).toMatchObject({
      status: "active",
      anchor_date: "2026-11-01",
      seq: 1,
      credits: 1,
    });
    expect(
      (
        await pool.query(
          "select id from partner_rewards where referral_id=$1",
          [referralIds[0]],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await pool.query(
          "select kind,amount from credit_entries where contract_id=$1",
          [fixture.contractId],
        )
      ).rows,
    ).toEqual([expect.objectContaining({ kind: "grant", amount: 1 })]);

    // 依頼は管理者が記録し、顧客は見積を了承する。
    const created = await app.request("/api/v1/admin/requests", {
      method: "POST",
      headers: { ...adminHeaders(), "idempotency-key": randomUUID() },
      body: JSON.stringify({
        contractId: fixture.contractId,
        receivedOn: "2026-11-01",
        summary: "商品ページの相談",
        urgent: false,
      }),
    });
    expect(created.status).toBe(201);
    const requestId = requireRow((await created.json()) as { id: string }).id;
    requestIds.push(requestId);
    const estimate = await app.request(
      `/api/v1/admin/requests/${requestId}/estimates`,
      {
        method: "POST",
        headers: { ...adminHeaders(), "idempotency-key": randomUUID() },
        body: JSON.stringify({
          credits: 1,
          dueOn: "2026-11-10",
          workItems: ["商品ページ修正"],
          doneCriteria: "表示確認",
          exclusions: "撮影",
          customerPrep: "素材共有",
        }),
      },
    );
    expect(estimate.status).toBe(201);
    const estimateId = requireRow((await estimate.json()) as { id: string }).id;
    estimateIds.push(estimateId);
    expect(
      (
        await app.request(`/api/v1/me/estimates/${estimateId}/approve`, {
          method: "POST",
          headers: customerHeaders(fixture.token),
          body: "{}",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await pool.query<{ kind: string; amount: number }>(
          "select kind,amount from credit_entries where contract_id=$1 order by occurred_at,id",
          [fixture.contractId],
        )
      ).rows.map((r) => [r.kind, r.amount]),
    ).toEqual([
      ["grant", 1],
      ["reserve", -1],
    ]);
    const completed = await app.request(
      `/api/v1/admin/requests/${requestId}/complete`,
      {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({
          completedOn: "2026-11-01",
          actualMinutes: 60,
          actualCredits: 1,
        }),
      },
    );
    expect(completed.status).toBe(200);
    expect(
      (
        await pool.query<{ balance: number }>(
          "select coalesce(sum(amount),0)::int balance from credit_entries where contract_id=$1",
          [fixture.contractId],
        )
      ).rows[0]?.balance,
    ).toBe(0);

    const extra = await app.request("/api/v1/me/extra-credits", {
      method: "POST",
      headers: {
        ...customerHeaders(fixture.token),
        "idempotency-key": `${prefix}-extra`,
      },
      body: JSON.stringify({ quantity: 2 }),
    });
    expect(extra.status).toBe(201);
    const extraBody = extraCreditPurchaseResponseSchema.parse(
      await extra.json(),
    );
    invoiceIds.push(extraBody.invoiceId);
    expect(extraBody).toMatchObject({
      totalExclTax: 8000,
      taxAmount: 800,
      totalInclTax: 8800,
    });
    expect(
      (
        await app.request(
          `/api/v1/admin/invoices/${extraBody.invoiceId}/confirm-payment`,
          {
            method: "POST",
            headers: adminHeaders(),
            body: JSON.stringify({ amount: 8800, paidOn: "2026-11-01" }),
          },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await pool.query<{ amount: number }>(
          "select amount from credit_entries where contract_id=$1 and kind='extra'",
          [fixture.contractId],
        )
      ).rows.reduce((n, r) => n + r.amount, 0),
    ).toBe(2);
    expect(
      (
        await pool.query(
          "select id from partner_rewards where referral_id=$1",
          [referralIds[0]],
        )
      ).rowCount,
    ).toBe(1);

    const billing = new DailyBillingJob(
      pool,
      new InvoiceRepository(pool, config, {
        render: async () => Buffer.from("%PDF-1.7\nrehearsal fixture\n"),
      }),
    );
    const next = await billing.runDailyBilling("2026-12-01", {
      contractIds: [fixture.contractId],
    });
    expect(next.failed).toBe(0);
    expect(next.createdPeriods).toBe(1);
    const duplicate = await billing.runDailyBilling("2026-12-01", {
      contractIds: [fixture.contractId],
    });
    expect(duplicate.createdPeriods).toBe(0);
    const period2 = requireRow(
      (
        await pool.query<{ id: string; seq: number; credits: number }>(
          "select id,seq,credits from billing_periods where contract_id=$1 and seq=2",
          [fixture.contractId],
        )
      ).rows[0],
    );
    expect(period2).toMatchObject({ seq: 2, credits: 1 });
    const monthly = requireRow(
      (
        await pool.query<{
          id: string;
          total_excl_tax: number;
          tax_amount: number;
          total_incl_tax: number;
        }>(
          "select id,total_excl_tax,tax_amount,total_incl_tax from invoices where contract_id=$1 and kind='monthly' and period_id=$2",
          [fixture.contractId, period2.id],
        )
      ).rows[0],
    );
    invoiceIds.push(monthly.id);
    expect(monthly).toMatchObject({
      total_excl_tax: 5000,
      tax_amount: 500,
      total_incl_tax: 5500,
    });
    expect(
      (
        await makeApp(new Date("2026-12-01T00:30:00.000Z")).request(
          `/api/v1/admin/invoices/${monthly.id}/confirm-payment`,
          {
            method: "POST",
            headers: adminHeaders(),
            body: JSON.stringify({ amount: 5500, paidOn: "2026-12-01" }),
          },
        )
      ).status,
    ).toBe(200);
    const rewards = await pool.query<{
      month_index: number;
      base_amount: number;
    }>(
      "select month_index,base_amount from partner_rewards where referral_id=$1 order by month_index",
      [referralIds[0]],
    );
    expect(rewards.rows).toEqual([
      { month_index: 1, base_amount: 5000 },
      { month_index: 2, base_amount: 5000 },
    ]);

    const notices = await pool.query<{ id: string }>(
      "select id from notifications where customer_id=$1 and kind in ('NT-01','S-03','NT-02','NT-02b','NT-06','NT-03','NT-04')",
      [fixture.customerId],
    );
    const sender = new FakeMailSender();
    expect(
      await runNotificationDispatch(new Date("2026-12-02T00:00:00Z"), {
        pool,
        sender,
        notificationIds: notices.rows.map((r) => r.id),
      }),
    ).toMatchObject({ failed: 0 });
    expect(
      sender.messages.every((message) => message.to.endsWith("@example.test")),
    ).toBe(true);
    const bankCustomer = requireRow(
      (
        await pool.query<{ email: string }>(
          "select email from customers where id=$1",
          [fixture.customerId],
        )
      ).rows[0],
    );
    expect(
      sender.messages.some((message) => message.to === bankCustomer.email),
    ).toBe(true);
    for (const message of sender.messages) {
      expect(message.text).not.toContain(fixture.customerId);
      expect(message.text).not.toContain(fixture.token);
      expect(message.text).not.toContain("商品ページの相談");
      expect(message.text).not.toContain("東京都テスト区1-2-3");
    }

    const retryKey = `${prefix}:retry-three`;
    await pool.query(
      `insert into notifications(customer_id,kind,channel,dedupe_key,scheduled_at,payload)
       values($1,'NT-07','email',$2,'2026-12-01T00:00:00Z','{"status":"done"}'::jsonb)`,
      [fixture.customerId, retryKey],
    );
    const retryNotice = requireRow(
      (
        await pool.query<{ id: string }>(
          "select id from notifications where dedupe_key=$1",
          [retryKey],
        )
      ).rows[0],
    );
    const failingSender = new FakeMailSender();
    failingSender.failure = new Error("private mail provider details");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(
        await runNotificationDispatch(new Date("2026-12-02T00:00:00Z"), {
          pool,
          sender: failingSender,
          notificationIds: [retryNotice.id],
        }),
      ).toMatchObject({ failed: 1 });
    }
    expect(
      await runNotificationDispatch(new Date("2026-12-02T00:00:00Z"), {
        pool,
        sender: failingSender,
        notificationIds: [retryNotice.id],
      }),
    ).toMatchObject({ failed: 0 });
    expect(
      (
        await pool.query<{ attempts: number }>(
          "select attempts from notifications where id=$1",
          [retryNotice.id],
        )
      ).rows[0]?.attempts,
    ).toBe(3);

    // cancellation uses PostgreSQL's Tokyo clock, so create a contract whose
    // current period is anchored to the database's actual Tokyo date.
    const cancellationFixture = await createCustomer(app, "cancellation");
    const dbToday = requireRow(
      (
        await pool.query<{ day: string }>(
          "select to_char(clock_timestamp() at time zone 'Asia/Tokyo','YYYY-MM-DD') as day",
        )
      ).rows[0],
    ).day;
    const anchorDate = new Date(`${dbToday}T00:00:00Z`);
    anchorDate.setUTCDate(anchorDate.getUTCDate() - 10);
    const anchorOn = anchorDate.toISOString().slice(0, 10);
    // 発行日・入金日を契約日にそろえるため、この契約だけ契約日の時計のアプリで操作する。
    const cancelApp = makeApp(new Date(`${anchorOn}T00:30:00.000Z`));
    const activation = await cancelApp.request(
      `/api/v1/admin/applications/${cancellationFixture.applicationId}/approve`,
      { method: "POST", headers: adminHeaders(), body: "{}" },
    );
    expect(activation.status).toBe(200);
    const cancellationInvoice = requireRow(
      approveApplicationResponseSchema.parse(await activation.json()).invoice,
    );
    invoiceIds.push(cancellationInvoice.id);
    expect(
      (
        await cancelApp.request(
          `/api/v1/admin/invoices/${cancellationInvoice.id}/confirm-payment`,
          {
            method: "POST",
            headers: adminHeaders(),
            body: JSON.stringify({ amount: 5500, paidOn: anchorOn }),
          },
        )
      ).status,
    ).toBe(200);
    const cancel = await app.request(
      `/api/v1/admin/contracts/${cancellationFixture.contractId}/cancellation`,
      { method: "POST", headers: adminHeaders() },
    );
    expect(cancel.status).toBe(200);
    const ending = await pool.query<{ ends_on: string }>(
      "select ends_on::text from contracts where id=$1",
      [cancellationFixture.contractId],
    );
    const endsOn = requireRow(ending.rows[0]).ends_on;
    const nextDay = new Date(`${endsOn}T00:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const endedOn = nextDay.toISOString().slice(0, 10);
    expect(
      (
        await app.request("/api/v1/me/requests", {
          headers: customerHeaders(fixture.token),
        })
      ).status,
    ).toBe(200);
    const ended = await billing.runDailyBilling(endedOn, {
      contractIds: [cancellationFixture.contractId],
    });
    expect(ended.failed).toBe(0);
    expect(
      (
        await pool.query<{ status: string }>(
          "select status from contracts where id=$1",
          [cancellationFixture.contractId],
        )
      ).rows[0]?.status,
    ).toBe("ended");
    expect(
      (
        await pool.query(
          "select id from billing_periods where contract_id=$1 and starts_on>$2::date",
          [cancellationFixture.contractId, endsOn],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await pool.query(
          "select id from credit_entries where contract_id=$1 and kind='expire'",
          [cancellationFixture.contractId],
        )
      ).rowCount,
    ).toBe(1);

    const financialBefore = await pool.query(
      "select i.total_excl_tax,i.tax_amount,i.total_incl_tax,i.billing_name,i.issuer_snapshot,(select coalesce(sum(amount),0) from payments p where p.invoice_id=i.id) paid from invoices i where i.contract_id=$1 order by i.invoice_no",
      [cancellationFixture.contractId],
    );
    const purgeOn = new Date(`${endsOn}T00:00:00Z`);
    purgeOn.setUTCDate(purgeOn.getUTCDate() + 368);
    const purgeDate = purgeOn.toISOString().slice(0, 10);
    const purged = await runRetentionPurge(purgeDate, pool, {
      contractIds: [cancellationFixture.contractId],
    });
    expect(purged.customers).toBe(1);
    expect(
      (
        await pool.query(
          "select anonymized_at,shop_name,email from customers where id=$1",
          [cancellationFixture.customerId],
        )
      ).rows[0],
    ).toMatchObject({
      shop_name: "削除済み",
      email: `deleted+${cancellationFixture.customerId}@invalid.example`,
    });
    expect(
      (
        await pool.query(
          "select i.total_excl_tax,i.tax_amount,i.total_incl_tax,i.billing_name,i.issuer_snapshot,(select coalesce(sum(amount),0) from payments p where p.invoice_id=i.id) paid from invoices i where i.contract_id=$1 order by i.invoice_no",
          [cancellationFixture.contractId],
        )
      ).rows,
    ).toEqual(financialBefore.rows);
    expect(
      (
        await runRetentionPurge(purgeDate, pool, {
          contractIds: [cancellationFixture.contractId],
        })
      ).customers,
    ).toBe(0);
    const balances = await pool.query<{ balance: number }>(
      "select p.id,coalesce(sum(e.amount),0)::int balance from billing_periods p left join credit_entries e on e.period_id=p.id where p.contract_id=$1 group by p.id",
      [cancellationFixture.contractId],
    );
    expect(balances.rows.every((row) => row.balance >= 0)).toBe(true);
    const totals = await pool.query(
      "select id from invoices where contract_id=$1 and total_incl_tax<>total_excl_tax+tax_amount",
      [cancellationFixture.contractId],
    );
    expect(totals.rowCount).toBe(0);
    const paymentMismatch = await pool.query(
      "select i.id from invoices i where i.contract_id=$1 and i.status='paid' and (select coalesce(sum(p.amount),0) from payments p where p.invoice_id=i.id)<>i.total_incl_tax",
      [cancellationFixture.contractId],
    );
    expect(paymentMismatch.rowCount).toBe(0);
  });

  it("カード申込みの支払リンク、保存済みイベント、重複配送と金額不一致を処理する", async () => {
    const app = makeApp(new Date("2026-11-01T00:30:00.000Z"));
    const fixture = await createCustomer(app, "card", "card");
    const approved = approveApplicationResponseSchema.parse(
      await (
        await app.request(
          `/api/v1/admin/applications/${fixture.applicationId}/approve`,
          { method: "POST", headers: adminHeaders(), body: "{}" },
        )
      ).json(),
    );
    const initialInvoice = requireRow(approved.invoice);
    invoiceIds.push(initialInvoice.id);
    expect(
      (
        await pool.query<{ preview: boolean }>(
          "select coalesce((issuer_snapshot->>'preview')::boolean,false) as preview from invoices where id=$1",
          [initialInvoice.id],
        )
      ).rows[0]?.preview,
    ).toBe(false);
    await pool.query("update invoices set payment_method='card' where id=$1", [
      initialInvoice.id,
    ]);
    const path = `/api/v1/me/invoices/${initialInvoice.id}/payment-link`;
    expect(
      (
        await app.request(path, {
          method: "POST",
          headers: customerHeaders(fixture.token),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(path, {
          method: "POST",
          headers: customerHeaders(fixture.token),
        })
      ).status,
    ).toBe(200);
    expect(komoju.requests.at(-1)?.externalOrderNum).not.toBe(
      komoju.requests.at(-2)?.externalOrderNum,
    );
    expect(komoju.requests.at(-1)?.amountYen).toBe(5500);
    const externalOrderNum = requireRow(
      komoju.requests.at(-1)?.externalOrderNum,
    );
    const failedId = `evt_${prefix.replaceAll("-", "")}_failed`;
    eventIds.push(failedId);
    await inbox.receive({
      id: failedId,
      type: "payment.failed",
      data: {
        id: `pay-${randomUUID()}`,
        status: "failed",
        amount: 5000,
        tax: 500,
        total: 5500,
        currency: "JPY",
        external_order_num: initialInvoice.invoiceNo,
      },
    });
    expect((await processor.processPending()).failed).toBe(0);
    expect(
      (
        await pool.query<{ status: string }>(
          "select status from invoices where id=$1",
          [initialInvoice.id],
        )
      ).rows[0]?.status,
    ).toBe("failed");
    expect(
      (
        await pool.query<{ scheduled_at: Date }>(
          "select scheduled_at from notifications where customer_id=$1 and kind='NT-05' order by scheduled_at",
          [fixture.customerId],
        )
      ).rows,
    ).toHaveLength(2);
    const eventId = `evt_${prefix.replaceAll("-", "")}_captured`;
    eventIds.push(eventId);
    const event = {
      id: eventId,
      type: "payment.captured",
      data: {
        id: `pay-${randomUUID()}`,
        status: "captured",
        amount: 5000,
        tax: 500,
        total: 5500,
        captured_at: "2026-11-01T00:30:00.000Z",
        currency: "JPY",
        external_order_num: externalOrderNum,
      },
    };
    await inbox.receive(event);
    const processing = await processor.processPending();
    if (processing.processed !== 1) {
      const storedEvent = await pool.query<{ error: string | null }>(
        "select error from komoju_events where id=$1",
        [eventId],
      );
      expect(
        processing,
        `KOMOJU event error: ${storedEvent.rows[0]?.error}`,
      ).toMatchObject({
        processed: 1,
      });
    }
    expect(processing.processed).toBe(1);
    expect((await processor.processPending()).processed).toBe(0);
    expect(
      (
        await pool.query<{ status: string }>(
          "select status from invoices where id=$1",
          [initialInvoice.id],
        )
      ).rows[0]?.status,
    ).toBe("paid");
    expect(
      (
        await pool.query<{ status: string }>(
          "select status from contracts where id=$1",
          [fixture.contractId],
        )
      ).rows[0]?.status,
    ).toBe("active");
    expect(
      (
        await pool.query<{ kind: string }>(
          "select kind from notifications where customer_id=$1 and kind='NT-02b'",
          [fixture.customerId],
        )
      ).rows.map((row) => row.kind),
    ).toEqual(["NT-02b"]);
    const mismatchId = `evt_${prefix.replaceAll("-", "")}_mismatch`;
    eventIds.push(mismatchId);
    await inbox.receive({
      ...event,
      id: mismatchId,
      data: { ...event.data, id: `pay-${randomUUID()}`, total: 5499 },
    });
    expect((await processor.processPending()).review).toBe(1);
  });
});
