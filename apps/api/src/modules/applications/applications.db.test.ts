import { randomUUID } from "node:crypto";
import { publicPlansSchema } from "@kobito/shared";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type AppDependencies, createApp } from "../../app.js";
import type { VerifiedIdentity } from "../../platform/auth.js";
import type { RuntimeConfig } from "../../platform/config.js";
import { PublicSettingsRepository } from "../../platform/settings.js";
import { AccountsRepository } from "../accounts/repository.js";
import { AdminRepository } from "../admin/repository.js";
import { AdminService } from "../admin/service.js";
import { PostgresCustomerAccessRepository } from "../customer-access/repository.js";
import { CustomerAccessService } from "../customer-access/service.js";
import { ApplicationsRepository } from "./repository.js";
import { ApplicationsService } from "./service.js";

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const testPrefix = `application-db-${randomUUID()}`;
const configuredDatabaseUrl =
  "postgres://kobito:kobito@127.0.0.1:55433/kobito_support";
const legalDocuments = {
  status: "draft",
  terms: {
    url: "https://legal.example.test/terms",
    version: "規約案v2-test",
  },
  privacy: {
    url: "https://legal.example.test/privacy",
    version: "privacy案v1-test",
  },
  disclosure: {
    url: "https://legal.example.test/disclosure",
    version: "特商法案v1-test",
  },
} as const;

const config: RuntimeConfig = {
  nodeEnv: "development",
  databaseUrl: configuredDatabaseUrl,
  firebaseProjectId: "demo-kobito-support",
  authEmulatorHost: "127.0.0.1:9099",
  webOrigin: "http://localhost:5173",
  port: 3000,
  invoicePrefix: "KS",
};

type Applicant = {
  uid: string;
  email: string;
  token: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
};

const applicants: Applicant[] = [];
const identities = new Map<string, VerifiedIdentity>();
const partnerIds: string[] = [];

function createApplicant(
  overrides: Partial<Record<string, unknown>> = {},
): Applicant {
  const uid = `${testPrefix}-${randomUUID()}`;
  const email = `${uid}@example.test`;
  const token = `verified-${uid}`;
  identities.set(token, { uid, email });
  const applicant: Applicant = {
    uid,
    email,
    token,
    idempotencyKey: randomUUID(),
    payload: {
      shopName: "応募テスト店舗",
      contactName: "応募テスト担当者",
      email,
      phone: "090-0000-0000",
      planCode: "light",
      billingName: "応募テスト店舗",
      billingAddress: "東京都テスト区1-2-3",
      paymentMethod: "bank_transfer",
      lineDisplayName: "テストLINE表示名",
      freeText: "申込テスト",
      consentBusinessUse: true,
      consentTerms: true,
      consentMarketing: false,
      displayVersion: "",
      ...overrides,
    },
  };
  applicants.push(applicant);
  return applicant;
}

function makeApp(
  runtimeConfig: RuntimeConfig = config,
  logger = { info: vi.fn(), error: vi.fn() },
) {
  const accounts = new AccountsRepository(pool);
  const applications = new ApplicationsService(
    new ApplicationsRepository(pool),
    runtimeConfig,
  );
  const dependencies: AppDependencies = {
    config: runtimeConfig,
    verifier: {
      verifyIdToken: async (token) => {
        const identity = identities.get(token);
        if (!identity) throw new Error("invalid test identity");
        return identity;
      },
    },
    accounts,
    applications,
    customerAccess: new CustomerAccessService(
      new PostgresCustomerAccessRepository(pool),
    ),
    admin: new AdminService(new AdminRepository(pool)),
    invoices: {
      getReadiness: async () => ({
        canIssue: false,
        mode: "unavailable",
        reason: "issuer_not_configured",
      }),
      approveApplication: async () => {
        throw new Error("not used by application tests");
      },
      listCustomer: async () => ({ invoices: [] }),
      getCustomer: async () => {
        throw new Error("not used");
      },
      getCustomerPdf: async () => {
        throw new Error("not used");
      },
      listAdmin: async () => ({ invoices: [] }),
      getAdmin: async () => {
        throw new Error("not used");
      },
      getAdminPdf: async () => {
        throw new Error("not used");
      },
      listPendingBankTransfers: async () => ({ items: [] }),
      confirmBankPayment: async () => {
        throw new Error("not used");
      },
      getCustomerContract: async () => ({ contract: null }),
    },
    publicSettings: new PublicSettingsRepository(pool),
    komojuInbox: { receive: async () => "accepted" as const },
    logger,
  };
  return createApp(dependencies);
}

async function currentDisplayVersion(app: ReturnType<typeof makeApp>) {
  const response = await app.request("/api/v1/public/plans");
  expect(response.status).toBe(200);
  const catalog = publicPlansSchema.parse(await response.json());
  expect(catalog.plans).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "light",
        priceExclTax: 5000,
        credits: 1,
        isCustom: false,
      }),
      expect.objectContaining({
        code: "standard",
        priceExclTax: 10000,
        credits: 3,
        isCustom: false,
      }),
      expect.objectContaining({
        code: "premium",
        priceExclTax: 15000,
        credits: 5,
        isCustom: false,
      }),
      expect.objectContaining({
        code: "custom",
        priceExclTax: null,
        credits: null,
        isCustom: true,
      }),
    ]),
  );
  return catalog.displayVersion;
}

async function submit(
  app: ReturnType<typeof makeApp>,
  applicant: Applicant,
  changes: {
    idempotencyKey?: string;
    payload?: Record<string, unknown>;
  } = {},
) {
  return app.request("/api/v1/applications", {
    method: "POST",
    headers: {
      authorization: `Bearer ${applicant.token}`,
      "content-type": "application/json",
      "idempotency-key": changes.idempotencyKey ?? applicant.idempotencyKey,
    },
    body: JSON.stringify(changes.payload ?? applicant.payload),
  });
}

async function countForUid(uid: string) {
  const result = await pool.query<{
    customer_count: string;
    account_count: string;
    application_count: string;
    contract_count: string;
    key_count: string;
    queued_receipt_count: string;
  }>(
    `select
       (select count(*) from customers c join user_accounts u on u.customer_id = c.id where u.auth_user_id = $1)::text as customer_count,
       (select count(*) from user_accounts where auth_user_id = $1)::text as account_count,
       (select count(*) from applications a join user_accounts u on u.customer_id = a.customer_id where u.auth_user_id = $1)::text as application_count,
       (select count(*) from contracts c join user_accounts u on u.customer_id = c.customer_id where u.auth_user_id = $1)::text as contract_count,
       (select count(*) from application_submission_keys where auth_user_id = $1)::text as key_count,
       (select count(*) from notifications n join user_accounts u on u.customer_id = n.customer_id where u.auth_user_id = $1 and n.kind = 'NT-01' and n.channel = 'email' and n.sent_at is null)::text as queued_receipt_count`,
    [uid],
  );
  return result.rows[0];
}

async function cleanupApplicants() {
  const uids = applicants.map(({ uid }) => uid);
  if (uids.length === 0) return;
  await pool.query(
    `delete from notifications where customer_id in (select customer_id from user_accounts where auth_user_id = any($1::text[]))`,
    [uids],
  );
  await pool.query(
    "delete from application_submission_keys where auth_user_id = any($1::text[])",
    [uids],
  );
  await pool.query(
    "delete from referrals where contract_id in (select id from contracts where customer_id in (select customer_id from user_accounts where auth_user_id = any($1::text[])))",
    [uids],
  );
  await pool.query(
    "delete from contracts where customer_id in (select customer_id from user_accounts where auth_user_id = any($1::text[]))",
    [uids],
  );
  await pool.query(
    "delete from applications where customer_id in (select customer_id from user_accounts where auth_user_id = any($1::text[]))",
    [uids],
  );
  await pool.query(
    "delete from user_accounts where auth_user_id = any($1::text[])",
    [uids],
  );
  await pool.query(`delete from customers where email = any($1::text[])`, [
    applicants.map(({ email }) => email),
  ]);
  applicants.length = 0;
  identities.clear();
  if (partnerIds.length) {
    await pool.query("delete from partners where id = any($1::uuid[])", [
      partnerIds,
    ]);
    partnerIds.length = 0;
  }
}

beforeAll(async () => {
  await pool.query(
    `insert into settings (key, value)
     values ('application_legal_documents', $1::jsonb)
     on conflict (key) do update set value = excluded.value`,
    [JSON.stringify(legalDocuments)],
  );
});

afterAll(async () => {
  await cleanupApplicants();
  await pool.query(
    "delete from settings where key = 'application_legal_documents'",
  );
  await pool.end();
});

describe("public application submission with PostgreSQL", () => {
  it("publishes an offer snapshot and creates the full customer submission atomically", async () => {
    const app = makeApp();
    const applicant = createApplicant();
    applicant.payload.displayVersion = await currentDisplayVersion(app);

    const meBefore = await app.request("/api/v1/me", {
      headers: { authorization: `Bearer ${applicant.token}` },
    });
    expect(meBefore.status).toBe(401);

    const response = await submit(app, applicant);
    expect(response.status).toBe(201);
    const receipt = (await response.json()) as {
      applicationId: string;
      contractId: string;
      status: string;
      replayed: boolean;
    };
    expect(receipt).toMatchObject({ status: "under_review", replayed: false });
    expect(receipt.applicationId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(receipt.contractId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(JSON.stringify(receipt)).not.toContain(applicant.email);

    await expect(countForUid(applicant.uid)).resolves.toEqual({
      customer_count: "1",
      account_count: "1",
      application_count: "1",
      contract_count: "1",
      key_count: "1",
      queued_receipt_count: "1",
    });

    const rows = await pool.query<{
      contract_status: string;
      shown_terms: Record<string, unknown>;
      consent_terms: boolean;
      consent_business_use: boolean;
      marketing_opt_in: boolean;
      password_column: string | null;
    }>(
      `select c.status as contract_status, a.shown_terms, a.consent_terms,
              a.consent_business_use, customer.marketing_opt_in,
              (select column_name from information_schema.columns
                where table_schema = current_schema() and table_name = 'applications' and column_name = 'password') as password_column
         from contracts c join applications a on a.id = c.application_id
         join user_accounts u on u.customer_id = c.customer_id
         join customers customer on customer.id = c.customer_id
        where u.auth_user_id = $1`,
      [applicant.uid],
    );
    expect(rows.rows[0]?.contract_status).toBe("under_review");
    expect(rows.rows[0]?.consent_terms).toBe(true);
    expect(rows.rows[0]?.consent_business_use).toBe(true);
    expect(rows.rows[0]?.marketing_opt_in).toBe(false);
    expect(rows.rows[0]?.password_column).toBeNull();
    expect(rows.rows[0]?.shown_terms).toMatchObject({
      priceExclTax: 5000,
      credits: 1,
      initialDueDays: 7,
      extraCreditExclYen: 4000,
      monthlyPrepaid: true,
      periodBasis: "contract_anchor",
      rollover: false,
      cancellation: "period_end_no_proration",
    });

    const meAfter = await app.request("/api/v1/me", {
      headers: { authorization: `Bearer ${applicant.token}` },
    });
    expect(meAfter.status).toBe(404);
    const access = await app.request("/api/v1/me/access", {
      headers: { authorization: `Bearer ${applicant.token}` },
    });
    expect(await access.json()).toMatchObject({
      contractStatus: "under_review",
      landingPath: "/me/waiting",
      access: "pending",
      invoiceAccess: true,
    });
  });

  it("persists marketing opt-in for new customers and existing accounts", async () => {
    const app = makeApp();
    const newApplicant = createApplicant({ consentMarketing: true });
    newApplicant.payload.displayVersion = await currentDisplayVersion(app);
    expect((await submit(app, newApplicant)).status).toBe(201);

    const newPreference = await pool.query<{ marketing_opt_in: boolean }>(
      `select c.marketing_opt_in from customers c
        join user_accounts u on u.customer_id = c.id
       where u.auth_user_id = $1`,
      [newApplicant.uid],
    );
    expect(newPreference.rows[0]?.marketing_opt_in).toBe(true);

    const existingApplicant = createApplicant({ consentMarketing: true });
    const customer = await pool.query<{ id: string }>(
      `insert into customers (shop_name, contact_name, billing_name, billing_address,
                              email, marketing_opt_in)
       values ('既存店舗', '担当者', '既存店舗', '住所', $1, false)
       returning id`,
      [existingApplicant.email],
    );
    const existingCustomerId = customer.rows[0]?.id;
    if (!existingCustomerId)
      throw new Error("Customer fixture was not created");
    await pool.query(
      `insert into user_accounts (auth_user_id, customer_id, role)
       values ($1, $2, 'customer')`,
      [existingApplicant.uid, existingCustomerId],
    );
    existingApplicant.payload.displayVersion = await currentDisplayVersion(app);
    expect((await submit(app, existingApplicant)).status).toBe(201);

    const existingPreference = await pool.query<{ marketing_opt_in: boolean }>(
      `select marketing_opt_in from customers where id = $1`,
      [existingCustomerId],
    );
    expect(existingPreference.rows[0]?.marketing_opt_in).toBe(true);
  });

  it("rejects unauthenticated, mismatched-email, and password-bearing submissions without rows", async () => {
    const app = makeApp();
    const unauthorizedApplicant = createApplicant();
    unauthorizedApplicant.payload.displayVersion =
      await currentDisplayVersion(app);
    const unauthenticated = await app.request("/api/v1/applications", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": unauthorizedApplicant.idempotencyKey,
      },
      body: JSON.stringify(unauthorizedApplicant.payload),
    });
    expect(unauthenticated.status).toBe(401);
    await expect(countForUid(unauthorizedApplicant.uid)).resolves.toMatchObject(
      {
        customer_count: "0",
        account_count: "0",
        application_count: "0",
        contract_count: "0",
      },
    );

    const mismatch = createApplicant({ email: "someone-else@example.test" });
    mismatch.payload.displayVersion = await currentDisplayVersion(app);
    const mismatchResponse = await submit(app, mismatch);
    expect(mismatchResponse.status).toBe(401);
    await expect(countForUid(mismatch.uid)).resolves.toMatchObject({
      customer_count: "0",
      account_count: "0",
      application_count: "0",
    });

    const passwordApplicant = createApplicant();
    passwordApplicant.payload.displayVersion = await currentDisplayVersion(app);
    const logger = { info: vi.fn(), error: vi.fn() };
    const appWithLogger = makeApp(config, logger);
    const passwordResponse = await submit(appWithLogger, passwordApplicant, {
      payload: {
        ...passwordApplicant.payload,
        password: "must-never-reach-api-password-sentinel",
      },
    });
    expect([400, 422]).toContain(passwordResponse.status);
    await expect(countForUid(passwordApplicant.uid)).resolves.toMatchObject({
      customer_count: "0",
      account_count: "0",
      application_count: "0",
    });
    const logs = JSON.stringify({
      info: logger.info.mock.calls,
      error: logger.error.mock.calls,
    });
    expect(logs).not.toContain("must-never-reach-api-password-sentinel");
    expect(logs).not.toContain(passwordApplicant.email);
    expect(logs).not.toContain(passwordApplicant.token);
  });

  it("resolves only active referral codes and stores the partner link with C-04", async () => {
    const app = makeApp();
    const inactiveCode = `INACTIVE-${randomUUID()}`;
    const activeCode = `ACTIVE-${randomUUID()}`;
    const inactive = await pool.query<{ id: string }>(
      `insert into partners (name, referral_code, reward_type, reward_rate, active)
       values ('非公開パートナー', $1, 'appointment', 0.100, false) returning id`,
      [inactiveCode],
    );
    const active = await pool.query<{ id: string }>(
      `insert into partners (name, email, referral_code, reward_type, reward_rate, active)
       values ('紹介パートナー', 'private-partner@example.test', $1, 'appointment', 0.100, true)
       returning id`,
      [activeCode],
    );
    const inactivePartnerId = inactive.rows[0]?.id;
    const activePartnerId = active.rows[0]?.id;
    if (!inactivePartnerId || !activePartnerId) {
      throw new Error("Partner fixtures were not created");
    }
    partnerIds.push(inactivePartnerId, activePartnerId);

    const inactiveLookup = await app.request(
      `/api/v1/public/partners/${inactiveCode}`,
    );
    expect(inactiveLookup.status).toBe(404);
    expect(await inactiveLookup.json()).toEqual({
      error: { code: "not_found" },
    });

    const activeLookup = await app.request(
      `/api/v1/public/partners/${activeCode}`,
    );
    expect(activeLookup.status).toBe(200);
    const publicPartner = await activeLookup.json();
    expect(publicPartner).toEqual({
      code: activeCode,
      name: "紹介パートナー",
    });
    expect(JSON.stringify(publicPartner)).not.toContain(
      "private-partner@example.test",
    );
    expect(JSON.stringify(publicPartner)).not.toContain(activePartnerId);

    const invalidApplicant = createApplicant({
      referralCode: `UNKNOWN-${randomUUID()}`,
      consentPartnerShare: true,
    });
    invalidApplicant.payload.displayVersion = await currentDisplayVersion(app);
    const invalidResponse = await submit(app, invalidApplicant);
    expect(invalidResponse.status).toBe(422);
    await expect(countForUid(invalidApplicant.uid)).resolves.toMatchObject({
      customer_count: "0",
      application_count: "0",
    });

    const applicant = createApplicant({
      referralCode: activeCode,
      consentPartnerShare: true,
    });
    applicant.payload.displayVersion = await currentDisplayVersion(app);
    const response = await submit(app, applicant);
    expect(response.status).toBe(201);
    const stored = await pool.query<{
      partner_id: string | null;
      consent_partner_share: boolean | null;
      shown_terms: Record<string, unknown>;
    }>(
      `select a.partner_id, a.consent_partner_share, a.shown_terms
         from applications a join user_accounts u on u.customer_id = a.customer_id
        where u.auth_user_id = $1`,
      [applicant.uid],
    );
    expect(stored.rows[0]).toMatchObject({
      partner_id: activePartnerId,
      consent_partner_share: true,
      shown_terms: {
        partner: {
          code: activeCode,
          name: "紹介パートナー",
          consentPartnerShare: true,
        },
      },
    });

    const referral = await pool.query<{
      reward_type: string;
      reward_rate: string;
      referral_count: string;
    }>(
      `select r.reward_type, r.reward_rate::text,
              (select count(*)::text from referrals where contract_id = r.contract_id) as referral_count
         from referrals r
         join contracts c on c.id = r.contract_id
         join user_accounts u on u.customer_id = c.customer_id
        where u.auth_user_id = $1`,
      [applicant.uid],
    );
    expect(referral.rows[0]).toMatchObject({
      reward_type: "appointment",
      reward_rate: "0.100",
      referral_count: "1",
    });

    await pool.query("update partners set reward_rate = 0.250 where id = $1", [
      activePartnerId,
    ]);
    expect((await submit(app, applicant)).status).toBe(200);
    const referralAfterReplay = await pool.query<{
      reward_type: string;
      reward_rate: string;
      referral_count: string;
    }>(
      `select r.reward_type, r.reward_rate::text,
              (select count(*)::text from referrals where contract_id = r.contract_id) as referral_count
         from referrals r
         join contracts c on c.id = r.contract_id
         join user_accounts u on u.customer_id = c.customer_id
        where u.auth_user_id = $1`,
      [applicant.uid],
    );
    expect(referralAfterReplay.rows[0]).toMatchObject({
      reward_type: "appointment",
      reward_rate: "0.100",
      referral_count: "1",
    });
  });

  it("replays the same result for repeated requests and refuses key reuse with changed data or identity", async () => {
    const app = makeApp();
    const applicant = createApplicant();
    applicant.payload.displayVersion = await currentDisplayVersion(app);
    const first = await submit(app, applicant);
    expect(first.status).toBe(201);
    const firstReceipt = await first.json();

    const replay = await submit(app, applicant);
    expect(replay.status).toBe(200);
    const replayReceipt = await replay.json();
    expect(replayReceipt).toMatchObject({ ...firstReceipt, replayed: true });
    await expect(countForUid(applicant.uid)).resolves.toMatchObject({
      customer_count: "1",
      application_count: "1",
      contract_count: "1",
      queued_receipt_count: "1",
    });

    const changedPayload = {
      ...applicant.payload,
      shopName: "変更された内容",
    };
    expect(
      (await submit(app, applicant, { payload: changedPayload })).status,
    ).toBe(409);

    const otherApplicant = createApplicant();
    otherApplicant.payload.displayVersion = await currentDisplayVersion(app);
    expect(
      (
        await submit(app, otherApplicant, {
          idempotencyKey: applicant.idempotencyKey,
        })
      ).status,
    ).toBe(409);
    await expect(countForUid(otherApplicant.uid)).resolves.toMatchObject({
      customer_count: "0",
      application_count: "0",
    });
  });

  it("serializes concurrent requests for the same submission and blocks concurrent new keys for one UID", async () => {
    const app = makeApp();
    const sameRequest = createApplicant();
    sameRequest.payload.displayVersion = await currentDisplayVersion(app);
    const sameResults = await Promise.all([
      submit(app, sameRequest),
      submit(app, sameRequest),
    ]);
    expect(sameResults.map(({ status }) => status).sort()).toEqual([200, 201]);
    const sameReceipts = await Promise.all(
      sameResults.map((response) => response.json()),
    );
    expect(sameReceipts[0]?.applicationId).toBe(sameReceipts[1]?.applicationId);
    await expect(countForUid(sameRequest.uid)).resolves.toMatchObject({
      customer_count: "1",
      application_count: "1",
      contract_count: "1",
      queued_receipt_count: "1",
    });

    const concurrentKeys = createApplicant();
    concurrentKeys.payload.displayVersion = await currentDisplayVersion(app);
    const [left, right] = await Promise.all([
      submit(app, concurrentKeys, { idempotencyKey: randomUUID() }),
      submit(app, concurrentKeys, { idempotencyKey: randomUUID() }),
    ]);
    expect(
      [left.status, right.status].filter((status) => status === 201),
    ).toHaveLength(1);
    expect(
      [left.status, right.status].filter((status) => status === 409),
    ).toHaveLength(1);
    await expect(countForUid(concurrentKeys.uid)).resolves.toMatchObject({
      customer_count: "1",
      application_count: "1",
      contract_count: "1",
      queued_receipt_count: "1",
    });
  });

  it("rolls back customer, account, application, contract, idempotency, and notifications after a later write fails", async () => {
    const app = makeApp();
    const applicant = createApplicant();
    applicant.payload.displayVersion = await currentDisplayVersion(app);
    const suffix = randomUUID().replaceAll("-", "");
    const functionName = `application_failure_${suffix}`;
    const triggerName = `application_failure_trigger_${suffix}`;
    await pool.query(`
      create function ${functionName}() returns trigger language plpgsql as $$
      begin raise exception 'injected application notification failure'; end;
      $$
    `);
    await pool.query(
      `create trigger ${triggerName} before insert on notifications for each row execute function ${functionName}()`,
    );
    try {
      const failed = await submit(app, applicant);
      expect(failed.status).toBe(500);
      await expect(countForUid(applicant.uid)).resolves.toEqual({
        customer_count: "0",
        account_count: "0",
        application_count: "0",
        contract_count: "0",
        key_count: "0",
        queued_receipt_count: "0",
      });
    } finally {
      await pool.query(`drop trigger ${triggerName} on notifications`);
      await pool.query(`drop function ${functionName}()`);
    }

    const retry = await submit(app, applicant);
    expect(retry.status).toBe(201);
    await expect(countForUid(applicant.uid)).resolves.toEqual({
      customer_count: "1",
      account_count: "1",
      application_count: "1",
      contract_count: "1",
      key_count: "1",
      queued_receipt_count: "1",
    });
  });

  it("rejects a stale offer displayVersion without persisting the application", async () => {
    const app = makeApp();
    const applicant = createApplicant();
    applicant.payload.displayVersion = await currentDisplayVersion(app);
    const originalPlan = await pool.query<{
      id: string;
      price_excl_tax: number;
    }>(
      "select id, price_excl_tax from plans where code = 'light' and valid_from = date '2026-10-25'",
    );
    try {
      await pool.query("update plans set price_excl_tax = 5100 where id = $1", [
        originalPlan.rows[0]?.id,
      ]);
      const response = await submit(app, applicant);
      expect(response.status).toBe(409);
      await expect(countForUid(applicant.uid)).resolves.toMatchObject({
        customer_count: "0",
        application_count: "0",
      });
    } finally {
      await pool.query("update plans set price_excl_tax = $1 where id = $2", [
        originalPlan.rows[0]?.price_excl_tax,
        originalPlan.rows[0]?.id,
      ]);
    }
  });

  it("replays a committed request after the offer changes but rejects a new stale key", async () => {
    const app = makeApp();
    const applicant = createApplicant();
    applicant.payload.displayVersion = await currentDisplayVersion(app);
    const originalPlan = await pool.query<{
      id: string;
      price_excl_tax: number;
    }>(
      "select id, price_excl_tax from plans where code = 'light' and valid_from = date '2026-10-25'",
    );
    try {
      const first = await submit(app, applicant);
      expect(first.status).toBe(201);
      const originalReceipt = await first.json();

      await pool.query("update plans set price_excl_tax = 5200 where id = $1", [
        originalPlan.rows[0]?.id,
      ]);
      const replay = await submit(app, applicant);
      expect(replay.status).toBe(200);
      expect(await replay.json()).toMatchObject({
        ...originalReceipt,
        replayed: true,
      });

      const newKey = await submit(app, applicant, {
        idempotencyKey: randomUUID(),
      });
      expect(newKey.status).toBe(409);
      expect(await newKey.json()).toEqual({
        error: { code: "offer_changed" },
      });
    } finally {
      await pool.query("update plans set price_excl_tax = $1 where id = $2", [
        originalPlan.rows[0]?.price_excl_tax,
        originalPlan.rows[0]?.id,
      ]);
    }
  });

  it("fails closed when draft legal documents are not eligible for the runtime environment", async () => {
    const { authEmulatorHost: _localEmulator, ...productionBase } = config;
    const productionConfig: RuntimeConfig = {
      ...productionBase,
      nodeEnv: "production",
      databaseUrl: "postgres://service@prod.invalid/kobito_support",
      firebaseProjectId: "kobito-support-production",
      webOrigin: "https://service.example.test",
    };
    const productionApp = makeApp(productionConfig);
    const publicConfig = await productionApp.request("/api/v1/public/config");
    expect(publicConfig.status).toBe(200);
    expect(await publicConfig.json()).toMatchObject({ application: null });

    const applicant = createApplicant();
    applicant.payload.displayVersion =
      await currentDisplayVersion(productionApp);
    const response = await submit(productionApp, applicant);
    expect(response.status).toBe(503);
    await expect(countForUid(applicant.uid)).resolves.toMatchObject({
      customer_count: "0",
      application_count: "0",
    });
  });
});
