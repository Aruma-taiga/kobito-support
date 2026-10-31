import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AppDependencies, createApp } from "../../app.js";
import type { VerifiedIdentity } from "../../platform/auth.js";
import type { RuntimeConfig } from "../../platform/config.js";
import { AccountsRepository } from "../accounts/repository.js";
import { AdminRepository } from "./repository.js";
import { AdminService } from "./service.js";

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const testPrefix = `admin-db-${randomUUID()}`;
const config: RuntimeConfig = {
  nodeEnv: "test",
  databaseUrl: "postgres://kobito:kobito@127.0.0.1:55433/kobito_support",
  firebaseProjectId: "demo-kobito-support",
  webOrigin: "http://localhost:5173",
  port: 3000,
  invoicePrefix: "KS",
};
const adminUid = `${testPrefix}-operator`;
const adminToken = `${testPrefix}-verified-token`;
const identities = new Map<string, VerifiedIdentity>([
  [adminToken, { uid: adminUid, firebase: { sign_in_second_factor: "phone" } }],
]);
const customerIds: string[] = [];
const planIds: string[] = [];
const applicationIds: string[] = [];
const contractIds: string[] = [];
const triggerNames: string[] = [];
const functionNames: string[] = [];

function makeApp(): ReturnType<typeof createApp> {
  const accounts = new AccountsRepository(pool);
  const dependencies: AppDependencies = {
    config,
    verifier: {
      verifyIdToken: async (token) => {
        const identity = identities.get(token);
        if (!identity) throw new Error("invalid admin test identity");
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
      getPublicPartner: async (code) => ({ code, name: "Partner" }),
      submit: async () => {
        throw new Error("not used by admin tests");
      },
    },
    admin: new AdminService(new AdminRepository(pool)),
    invoices: {
      getReadiness: async () => ({
        canIssue: false,
        mode: "unavailable",
        reason: "issuer_not_configured",
      }),
      approveApplication: async () => {
        throw new Error("not used by review tests");
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
    customerAccess: {
      getAccess: async () => ({
        contractStatus: null,
        landingPath: "/me",
        access: "none",
        welcomeRequired: false,
        invoiceAccess: false,
        invoiceAccessUntil: null,
      }),
      markWelcomeSeen: async () => ({ seenAt: "2026-01-01T00:00:00.000Z" }),
    },
    publicSettings: { getServiceName: async () => "Test service" },
    komojuInbox: { receive: async () => "accepted" as const },
    logger: { info: () => {}, error: () => {} },
  };
  return createApp(dependencies);
}

async function makeReviewCase(
  options: {
    shopName?: string;
    status?: string;
    plan?: {
      code: string;
      name: string;
      priceExclTax: number | null;
      credits: number | null;
    };
    shownTerms?: Record<string, unknown>;
  } = {},
): Promise<{ customerId: string; applicationId: string; contractId: string }> {
  const email = `${testPrefix}-${randomUUID()}@example.test`;
  const customer = await pool.query<{ id: string }>(
    `insert into customers (shop_name, contact_name, billing_name, billing_address, email)
     values ($1, '審査担当', '請求先店舗', '東京都の住所', $2) returning id`,
    [options.shopName ?? `審査店舗-${randomUUID()}`, email],
  );
  const customerId = customer.rows[0]?.id;
  if (!customerId) throw new Error("Review customer fixture insert failed");
  customerIds.push(customerId);

  const plan = options.plan
    ? await pool.query<{ id: string }>(
        `insert into plans (code, name, price_excl_tax, credits, is_custom, valid_from)
         values ($1, $2, $3, $4, $3::integer is null, current_date) returning id`,
        [
          options.plan.code,
          options.plan.name,
          options.plan.priceExclTax,
          options.plan.credits,
        ],
      )
    : await pool.query<{ id: string }>(
        "select id from plans where code = 'light' order by valid_from desc limit 1",
      );
  const planId = plan.rows[0]?.id;
  if (!planId) throw new Error("Light plan fixture is missing");
  if (options.plan) planIds.push(planId);

  const application = await pool.query<{ id: string }>(
    `insert into applications (
       customer_id, plan_id, payment_method, terms_version, privacy_version,
       disclosure_version, consent_business_use, consent_terms, consent_marketing,
       shown_terms, free_text
     ) values ($1, $2, 'bank_transfer', 'terms-v1', 'privacy-v1', 'disclosure-v1',
              true, true, false, $3::jsonb, '申込時のご要望')
     returning id`,
    [
      customerId,
      planId,
      JSON.stringify(
        options.shownTerms ?? {
          planName: options.plan?.name ?? "ライト",
          priceExclTax: options.plan?.priceExclTax ?? 5000,
          credits: options.plan?.credits ?? 1,
        },
      ),
    ],
  );
  const applicationId = application.rows[0]?.id;
  if (!applicationId)
    throw new Error("Review application fixture insert failed");
  applicationIds.push(applicationId);

  const contract = await pool.query<{ id: string }>(
    `insert into contracts (customer_id, application_id, plan_id, payment_method, status)
     values ($1, $2, $3, 'bank_transfer', $4) returning id`,
    [customerId, applicationId, planId, options.status ?? "under_review"],
  );
  const contractId = contract.rows[0]?.id;
  if (!contractId) throw new Error("Review contract fixture insert failed");
  contractIds.push(contractId);
  return { customerId, applicationId, contractId };
}

async function decline(
  app: ReturnType<typeof makeApp>,
  applicationId: string,
  body: unknown = {},
) {
  return app.request(`/api/v1/admin/applications/${applicationId}/decline`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await pool.query(
    `insert into user_accounts (auth_user_id, customer_id, role)
     values ($1, null, 'admin')`,
    [adminUid],
  );
});

afterAll(async () => {
  for (const name of triggerNames) {
    await pool.query(`drop trigger if exists ${name} on audit_logs`);
  }
  for (const name of functionNames) {
    await pool.query(`drop function if exists ${name}()`);
  }
  if (applicationIds.length) {
    await pool.query(
      "delete from notifications where payload->>'applicationId' = any($1::text[])",
      [applicationIds],
    );
    await pool.query(
      "delete from audit_logs where target_id = any($1::text[])",
      [applicationIds],
    );
  }
  if (contractIds.length) {
    await pool.query("delete from contracts where id = any($1::uuid[])", [
      contractIds,
    ]);
  }
  if (applicationIds.length) {
    await pool.query("delete from applications where id = any($1::uuid[])", [
      applicationIds,
    ]);
  }
  if (planIds.length) {
    await pool.query("delete from plans where id = any($1::uuid[])", [planIds]);
  }
  if (customerIds.length) {
    await pool.query("delete from customers where id = any($1::uuid[])", [
      customerIds,
    ]);
  }
  await pool.query("delete from user_accounts where auth_user_id = $1", [
    adminUid,
  ]);
  await pool.end();
});

describe("admin application review with PostgreSQL", () => {
  it("filters and paginates the review queue and returns the selected customer's profile", async () => {
    const first = await makeReviewCase({ shopName: `${testPrefix}-対象店舗` });
    await makeReviewCase({
      shopName: `${testPrefix}-別店舗`,
      status: "declined",
    });
    const app = makeApp();

    const queue = await app.request(
      "/api/v1/admin/customers?status=under_review&q=対象&page=1&pageSize=10",
      { headers: { authorization: `Bearer ${adminToken}` } },
    );
    expect(queue.status).toBe(200);
    expect(await queue.json()).toMatchObject({
      page: 1,
      pageSize: 10,
      total: 1,
      items: [
        expect.objectContaining({
          customerId: first.customerId,
          shopName: `${testPrefix}-対象店舗`,
          status: "under_review",
          planName: "ライト",
          priceExclTax: 5000,
        }),
      ],
    });

    const detail = await app.request(
      `/api/v1/admin/customers/${first.customerId}`,
      { headers: { authorization: `Bearer ${adminToken}` } },
    );
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      customer: { id: first.customerId, billingAddress: "東京都の住所" },
      application: {
        id: first.applicationId,
        consentBusinessUse: true,
        consentTerms: true,
        shownTerms: { priceExclTax: 5000, credits: 1 },
        reviewResult: null,
        rejectionNote: null,
      },
      contract: { id: first.contractId, status: "under_review" },
    });

    const malformed = await app.request(
      "/api/v1/admin/customers?pageSize=101",
      { headers: { authorization: `Bearer ${adminToken}` } },
    );
    expect(malformed.status).toBe(422);
  });

  it("shows the application-time plan snapshot after the plan is repriced", async () => {
    const fixture = await makeReviewCase({
      plan: {
        code: `review-${randomUUID()}`,
        name: "申込時ライト",
        priceExclTax: 5000,
        credits: 1,
      },
      shownTerms: { planName: "申込時ライト", priceExclTax: 5000, credits: 1 },
    });
    await pool.query(
      "update plans set name = '改定後ライト', price_excl_tax = 7000, credits = 2 where id = (select plan_id from applications where id = $1)",
      [fixture.applicationId],
    );

    const response = await makeApp().request("/api/v1/admin/customers", {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      items: Array<Record<string, unknown>>;
    };
    expect(
      result.items.find((item) => item.customerId === fixture.customerId),
    ).toMatchObject({
      planName: "申込時ライト",
      priceExclTax: 5000,
      credits: 1,
    });
  });

  it("keeps null custom-plan values from the application snapshot", async () => {
    const fixture = await makeReviewCase({
      plan: {
        code: `review-custom-${randomUUID()}`,
        name: "個別見積り",
        priceExclTax: null,
        credits: null,
      },
      shownTerms: { planName: "個別見積り", priceExclTax: null, credits: null },
    });
    await pool.query(
      "update plans set price_excl_tax = 7000, credits = 2 where id = (select plan_id from applications where id = $1)",
      [fixture.applicationId],
    );

    const response = await makeApp().request("/api/v1/admin/customers", {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const result = (await response.json()) as {
      items: Array<Record<string, unknown>>;
    };
    expect(
      result.items.find((item) => item.customerId === fixture.customerId),
    ).toMatchObject({
      planName: "個別見積り",
      priceExclTax: null,
      credits: null,
    });
  });

  it("declines once, stores its reason, queues an unsent notice, and treats retry as idempotent", async () => {
    const fixture = await makeReviewCase();
    const app = makeApp();
    const first = await decline(app, fixture.applicationId, {
      rejectionNote: "申込内容が条件に合いませんでした。",
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      applicationId: fixture.applicationId,
      contractId: fixture.contractId,
      status: "declined",
      replayed: false,
    });

    const replay = await decline(app, fixture.applicationId, {
      rejectionNote: "申込内容が条件に合いませんでした。",
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ replayed: true });
    const changedReplay = await decline(app, fixture.applicationId, {
      rejectionNote: "別の内容に置き換えない",
    });
    expect(changedReplay.status).toBe(409);

    const stored = await pool.query<{
      contract_status: string;
      reviewed_at: Date | null;
      review_result: string | null;
      rejection_note: string | null;
      notification_count: string;
      sent_at: Date | null;
      audit_count: string;
    }>(
      `select c.status as contract_status, a.reviewed_at, a.review_result,
              a.rejection_note,
              (select count(*)::text from notifications n
                where n.kind = 'application_declined' and n.payload->>'applicationId' = a.id::text) as notification_count,
              (select n.sent_at from notifications n
                where n.kind = 'application_declined' and n.payload->>'applicationId' = a.id::text) as sent_at,
              (select count(*)::text from audit_logs l
                where l.action = 'application.declined' and l.target_id = a.id::text) as audit_count
         from applications a join contracts c on c.application_id = a.id
        where a.id = $1`,
      [fixture.applicationId],
    );
    expect(stored.rows[0]).toMatchObject({
      contract_status: "declined",
      review_result: "declined",
      rejection_note: "申込内容が条件に合いませんでした。",
      notification_count: "1",
      sent_at: null,
      audit_count: "2",
    });
    expect(stored.rows[0]?.reviewed_at).toBeInstanceOf(Date);
  });

  it("rejects a decline after the contract has moved on and returns 404 for missing application", async () => {
    const fixture = await makeReviewCase({ status: "awaiting_payment" });
    const app = makeApp();
    expect((await decline(app, fixture.applicationId)).status).toBe(409);
    expect((await decline(app, randomUUID())).status).toBe(404);
  });

  it("serializes concurrent declines so only one unsent rejection notice exists", async () => {
    const fixture = await makeReviewCase();
    const app = makeApp();
    const responses = await Promise.all([
      decline(app, fixture.applicationId, { rejectionNote: "先行処理" }),
      decline(app, fixture.applicationId, { rejectionNote: "先行処理" }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const body = await Promise.all(
      responses.map((response) => response.json()),
    );
    expect(body.filter((item) => item.replayed === false)).toHaveLength(1);
    const count = await pool.query<{ count: string }>(
      `select count(*)::text as count from notifications
        where kind = 'application_declined' and payload->>'applicationId' = $1`,
      [fixture.applicationId],
    );
    expect(count.rows[0]?.count).toBe("1");
  });

  it("rolls back the decline and notification when the audit write fails after the mutation", async () => {
    const fixture = await makeReviewCase();
    const trigger = `fail_review_audit_${randomUUID().replaceAll("-", "")}`;
    const functionName = `${trigger}_fn`;
    triggerNames.push(trigger);
    functionNames.push(functionName);
    await pool.query(`create function ${functionName}() returns trigger language plpgsql as $$
      begin
        if new.target_id = '${fixture.applicationId}' then
          raise exception 'forced audit failure';
        end if;
        return new;
      end;
    $$`);
    await pool.query(
      `create trigger ${trigger} before insert on audit_logs
       for each row execute function ${functionName}()`,
    );

    const response = await decline(makeApp(), fixture.applicationId, {
      rejectionNote: "監査の失敗確認",
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "internal_error" },
    });
    await pool.query(`drop trigger ${trigger} on audit_logs`);
    await pool.query(`drop function ${functionName}()`);
    triggerNames.splice(triggerNames.indexOf(trigger), 1);
    functionNames.splice(functionNames.indexOf(functionName), 1);

    const afterFailure = await pool.query<{
      contract_status: string;
      review_result: string | null;
      rejection_note: string | null;
      notice_count: string;
      audit_count: string;
    }>(
      `select c.status as contract_status, a.review_result, a.rejection_note,
              (select count(*)::text from notifications n where n.kind = 'application_declined'
                and n.payload->>'applicationId' = a.id::text) as notice_count,
              (select count(*)::text from audit_logs l where l.action = 'application.declined'
                and l.target_id = a.id::text) as audit_count
         from applications a join contracts c on c.application_id = a.id
        where a.id = $1`,
      [fixture.applicationId],
    );
    expect(afterFailure.rows[0]).toEqual({
      contract_status: "under_review",
      review_result: null,
      rejection_note: null,
      notice_count: "0",
      audit_count: "0",
    });
  });
});
