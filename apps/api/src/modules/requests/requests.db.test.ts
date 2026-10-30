import { randomUUID } from "node:crypto";
import {
  adminRequestDetailSchema,
  completeRequestResponseSchema,
  createRequestResponseSchema,
  customerRequestDetailSchema,
  toTokyoDate,
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
import { RequestRepository } from "./repository.js";
import { RequestService } from "./service.js";

const pool = new Pool({
  connectionString:
    process.env.TEST_DATABASE_URL ??
    "postgres://kobito:kobito@127.0.0.1:5432/kobito_support_test",
});
const prefix = `requests-${randomUUID()}`;
const identities = new Map<string, VerifiedIdentity>();
const customerIds: string[] = [];
const contractIds: string[] = [];
const requestIds: string[] = [];
const estimateIds: string[] = [];
const applicationIds: string[] = [];
const planIds: string[] = [];
const userIds: string[] = [];
const adminUid = `${prefix}-admin`;
const adminToken = `${prefix}-admin-token`;
const secondAdminUid = `${prefix}-second-admin`;
const secondAdminToken = `${prefix}-second-admin-token`;
const noMfaUid = `${prefix}-no-mfa-admin`;
const noMfaToken = `${prefix}-no-mfa-admin-token`;
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
function requireRow<T>(row: T | undefined): T {
  if (!row) throw new Error("Expected test database row");
  return row;
}

function makeApp(
  now: () => Date = () => new Date("2026-10-26T15:30:00.000Z"),
  appPool: Pool = pool,
): ReturnType<typeof createApp> {
  const accounts = new AccountsRepository(appPool);
  const invoices = new InvoiceService(
    new InvoiceRepository(
      appPool,
      config,
      {
        render: async () => Buffer.from("%PDF"),
      },
      now,
    ),
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
    admin: new AdminService(new AdminRepository(appPool)),
    invoices,
    requests: new RequestService(new RequestRepository(appPool, now)),
    customerAccess: new CustomerAccessService(
      new PostgresCustomerAccessRepository(appPool, now),
      now,
    ),
    publicSettings: { getServiceName: async () => "Test" },
    logger: { info: () => {}, error: () => {} },
    komojuInbox: { receive: async () => "accepted" },
  };
  return createApp(dependencies);
}

async function makeContract(
  label: string,
  status: "active" | "ended" = "active",
  fundedCredits = 2,
  periodMode: "current" | "expired" | "none" = "current",
) {
  const suffix = randomUUID();
  const customer = await pool.query<{ id: string }>(
    "insert into customers(shop_name,contact_name,billing_name,billing_address,email) values($1,'担当者','請求先','住所',$2) returning id",
    [`${prefix}-${label}-${suffix}`, `${suffix}@example.test`],
  );
  const customerId = requireRow(customer.rows[0]).id;
  customerIds.push(customerId);
  const plan = await pool.query<{ id: string }>(
    "insert into plans(code,name,price_incl_tax,credits,is_custom,valid_from) values($1,'test',5000,2,false,current_date) returning id",
    [`${prefix}-${suffix}`],
  );
  const planId = requireRow(plan.rows[0]).id;
  planIds.push(planId);
  const app = await pool.query<{ id: string }>(
    "insert into applications(customer_id,plan_id,payment_method,terms_version,privacy_version,disclosure_version,consent_business_use,consent_terms,consent_marketing,shown_terms) values($1,$2,'bank_transfer','t','p','d',true,true,false,'{}') returning id",
    [customerId, planId],
  );
  const applicationId = requireRow(app.rows[0]).id;
  applicationIds.push(applicationId);
  const contract = await pool.query<{ id: string }>(
    "insert into contracts(customer_id,application_id,plan_id,payment_method,status,anchor_date) values($1,$2,$3,'bank_transfer',$4,'2026-10-01') returning id",
    [customerId, applicationId, planId, status],
  );
  const contractId = requireRow(contract.rows[0]).id;
  contractIds.push(contractId);
  if (status === "active" && periodMode !== "none") {
    const startsOn = periodMode === "expired" ? "2026-09-01" : "2026-10-01";
    const endsOn = periodMode === "expired" ? "2026-09-30" : "2026-10-31";
    const period = await pool.query<{ id: string }>(
      "insert into billing_periods(contract_id,seq,starts_on,ends_on,plan_id,price_incl_tax,credits) values($1,1,$2,$3,$4,5000,2) returning id",
      [contractId, startsOn, endsOn, planId],
    );
    await pool.query(
      "insert into credit_entries(contract_id,period_id,kind,amount) values($1,$2,'grant',$3)",
      [contractId, requireRow(period.rows[0]).id, fundedCredits],
    );
  }
  const uid = `${prefix}-${label}-${suffix}`;
  const token = `${uid}-token`;
  userIds.push(uid);
  identities.set(token, { uid });
  await pool.query(
    "insert into user_accounts(auth_user_id,customer_id,role) values($1,$2,'customer')",
    [uid, customerId],
  );
  return { customerId, contractId, token };
}

async function makeInProgressRequest(
  label: string,
  estimateCredits: number,
  fundedCredits = 5,
  now: () => Date = () => new Date("2026-10-26T15:30:00.000Z"),
) {
  const customer = await makeContract(label, "active", fundedCredits);
  const app = makeApp(now);
  const adminHeaders = {
    authorization: `Bearer ${adminToken}`,
    "content-type": "application/json",
  };
  const created = await app.request("/api/v1/admin/requests", {
    method: "POST",
    headers: { ...adminHeaders, "idempotency-key": randomUUID() },
    body: JSON.stringify({
      contractId: customer.contractId,
      receivedOn: "2026-10-26",
      summary: `完了テスト ${label}`,
      urgent: false,
    }),
  });
  if (created.status !== 201)
    throw new Error("Failed to create request fixture");
  const requestId = ((await created.json()) as { id: string }).id;
  requestIds.push(requestId);
  const sent = await app.request(
    `/api/v1/admin/requests/${requestId}/estimates`,
    {
      method: "POST",
      headers: { ...adminHeaders, "idempotency-key": randomUUID() },
      body: JSON.stringify({
        credits: estimateCredits,
        dueOn: "2026-10-30",
        workItems: ["対応"],
        doneCriteria: "対応完了",
      }),
    },
  );
  if (sent.status !== 201) throw new Error("Failed to send estimate fixture");
  const estimateId = ((await sent.json()) as { id: string }).id;
  estimateIds.push(estimateId);
  const approved = await app.request(
    `/api/v1/me/estimates/${estimateId}/approve`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${customer.token}`,
        "content-type": "application/json",
      },
      body: "{}",
    },
  );
  if (approved.status !== 200)
    throw new Error("Failed to approve estimate fixture");
  const reservation = await pool.query<{ period_id: string }>(
    "select period_id from credit_entries where request_id=$1 and kind='reserve'",
    [requestId],
  );
  return {
    customer,
    app,
    requestId,
    estimateId,
    periodId: requireRow(reservation.rows[0]).period_id,
  };
}

beforeAll(async () => {
  identities.set(adminToken, {
    uid: adminUid,
    firebase: { sign_in_second_factor: "phone" },
  });
  identities.set(secondAdminToken, {
    uid: secondAdminUid,
    firebase: { sign_in_second_factor: "phone" },
  });
  identities.set(noMfaToken, { uid: noMfaUid });
  await pool.query(
    "insert into user_accounts(auth_user_id,customer_id,role) values($1,null,'admin')",
    [adminUid],
  );
  await pool.query(
    "insert into user_accounts(auth_user_id,customer_id,role) values($1,null,'admin'),($2,null,'admin')",
    [secondAdminUid, noMfaUid],
  );
});
afterAll(async () => {
  await pool.query(
    "delete from notifications where customer_id=any($1::uuid[])",
    [customerIds],
  );
  await pool.query(
    "delete from request_command_keys where target_id=any($1::uuid[])",
    [requestIds],
  );
  await pool.query("delete from audit_logs where target_id=any($1::text[])", [
    [...requestIds, ...contractIds],
  ]);
  await pool.query(
    "delete from credit_entries where contract_id=any($1::uuid[])",
    [contractIds],
  );
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
  await pool.query("delete from invoices where contract_id=any($1::uuid[])", [
    contractIds,
  ]);
  await pool.query("delete from contracts where id=any($1::uuid[])", [
    contractIds,
  ]);
  await pool.query("delete from applications where id=any($1::uuid[])", [
    applicationIds,
  ]);
  await pool.query(
    "delete from user_accounts where auth_user_id=any($1::text[])",
    [userIds.concat(adminUid, secondAdminUid, noMfaUid)],
  );
  await pool.query("delete from customers where id=any($1::uuid[])", [
    customerIds,
  ]);
  await pool.query("delete from plans where id=any($1::uuid[])", [planIds]);
  await pool.end();
});

describe("request estimate API integration", () => {
  it("selects and reserves the Tokyo billing period at the midnight boundary", async () => {
    const databaseTimezone = await pool.query<{ TimeZone: string }>(
      "show timezone",
    );
    expect(databaseTimezone.rows[0]?.TimeZone.toLowerCase()).toBe("etc/utc");
    const tokyoMidnight = new Date("2026-01-31T15:30:00.000Z");
    expect(toTokyoDate(tokyoMidnight)).toBe("2026-02-01");

    const customer = await makeContract("tokyo-period-boundary", "active", 1);
    const periods = await pool.query<{ id: string; seq: number }>(
      "select id,seq from billing_periods where contract_id=$1 order by seq",
      [customer.contractId],
    );
    const january = requireRow(periods.rows[0]);
    await pool.query(
      "update billing_periods set starts_on='2026-01-01',ends_on='2026-01-31' where id=$1",
      [january.id],
    );
    await pool.query(
      "update credit_entries set amount=1 where period_id=$1 and kind='grant'",
      [january.id],
    );
    const february = await pool.query<{ id: string }>(
      "insert into billing_periods(contract_id,seq,starts_on,ends_on,plan_id,price_incl_tax,credits) select contract_id,2,'2026-02-01','2026-02-28',plan_id,5000,4 from billing_periods where id=$1 returning id",
      [january.id],
    );
    const februaryId = requireRow(february.rows[0]).id;
    await pool.query(
      "insert into credit_entries(contract_id,period_id,kind,amount) values($1,$2,'grant',4)",
      [customer.contractId, februaryId],
    );

    const app = makeApp(() => tokyoMidnight);
    const adminHeaders = {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
    };
    const requestResponse = await app.request("/api/v1/admin/requests", {
      method: "POST",
      headers: { ...adminHeaders, "idempotency-key": randomUUID() },
      body: JSON.stringify({
        contractId: customer.contractId,
        receivedOn: "2026-02-01",
        summary: "東京日付境界の確認",
        urgent: false,
      }),
    });
    expect(requestResponse.status).toBe(201);
    const requestId = ((await requestResponse.json()) as { id: string }).id;
    requestIds.push(requestId);
    const estimateResponse = await app.request(
      `/api/v1/admin/requests/${requestId}/estimates`,
      {
        method: "POST",
        headers: { ...adminHeaders, "idempotency-key": randomUUID() },
        body: JSON.stringify({
          credits: 1,
          dueOn: "2026-01-15",
          workItems: ["作業"],
          doneCriteria: "反映済み",
        }),
      },
    );
    expect(estimateResponse.status).toBe(201);
    const estimateId = ((await estimateResponse.json()) as { id: string }).id;

    const detail = await app.request(`/api/v1/me/requests/${requestId}`, {
      headers: { authorization: `Bearer ${customer.token}` },
    });
    expect(await detail.json()).toMatchObject({
      currentPeriodId: februaryId,
      availableCredits: 4,
      canApprove: true,
    });
    const approval = await app.request(
      `/api/v1/me/estimates/${estimateId}/approve`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${customer.token}`,
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    expect(approval.status).toBe(200);
    const reservations = await pool.query<{
      period_id: string;
      amount: number;
    }>(
      "select period_id,amount from credit_entries where request_id=$1 and kind='reserve'",
      [requestId],
    );
    expect(reservations.rows).toEqual([{ period_id: februaryId, amount: -1 }]);
  });

  it("creates and sends immutable estimate versions, reserves once, and scopes customer access", async () => {
    const customer = await makeContract("a");
    const app = makeApp(() => new Date("2026-10-27T02:00:00.000Z"));
    const adminHeaders = {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
    };
    const createKey = randomUUID();
    const createBody = {
      contractId: customer.contractId,
      receivedOn: "2026-10-26",
      summary: "画像の差し替え",
      urgent: false,
    };
    const created = await app.request("/api/v1/admin/requests", {
      method: "POST",
      headers: { ...adminHeaders, "idempotency-key": createKey },
      body: JSON.stringify(createBody),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { id: string };
    requestIds.push(createdBody.id);
    const replayedCreate = await app.request("/api/v1/admin/requests", {
      method: "POST",
      headers: { ...adminHeaders, "idempotency-key": createKey },
      body: JSON.stringify(createBody),
    });
    expect(replayedCreate.status).toBe(200);
    expect(await replayedCreate.json()).toMatchObject({
      id: createdBody.id,
      replayed: true,
    });
    const adminDetail = await app.request(
      `/api/v1/admin/requests/${createdBody.id}`,
      { headers: { authorization: `Bearer ${adminToken}` } },
    );
    expect(adminDetail.status).toBe(200);
    const adminDetailBody = await adminDetail.json();
    expect(adminRequestDetailSchema.safeParse(adminDetailBody).success).toBe(
      true,
    );
    expect(adminDetailBody).toMatchObject({
      id: createdBody.id,
      customer: { customerId: customer.customerId },
      estimates: [],
    });
    const estimateResponse = await app.request(
      `/api/v1/admin/requests/${createdBody.id}/estimates`,
      {
        method: "POST",
        headers: { ...adminHeaders, "idempotency-key": randomUUID() },
        body: JSON.stringify({
          credits: 1,
          dueOn: "2026-10-20",
          workItems: ["画像を差し替える"],
          doneCriteria: "指定画像が表示される",
        }),
      },
    );
    expect(estimateResponse.status).toBe(201);
    const estimate = (await estimateResponse.json()) as {
      id: string;
      version: number;
    };
    estimateIds.push(estimate.id);
    expect(estimate.version).toBe(1);
    const createReplayAfterEstimate = await app.request(
      "/api/v1/admin/requests",
      {
        method: "POST",
        headers: { ...adminHeaders, "idempotency-key": createKey },
        body: JSON.stringify(createBody),
      },
    );
    expect(createReplayAfterEstimate.status).toBe(200);
    const createReplayBody = await createReplayAfterEstimate.json();
    expect(
      createRequestResponseSchema.safeParse(createReplayBody).success,
    ).toBe(true);
    expect(createReplayBody).toMatchObject({
      id: createdBody.id,
      status: "awaiting_approval",
      replayed: true,
    });
    const createConflictRequests = [
      await app.request("/api/v1/admin/requests", {
        method: "POST",
        headers: { ...adminHeaders, "idempotency-key": createKey },
        body: JSON.stringify({ ...createBody, summary: "別の内容" }),
      }),
      await app.request("/api/v1/admin/requests", {
        method: "POST",
        headers: {
          authorization: `Bearer ${secondAdminToken}`,
          "content-type": "application/json",
          "idempotency-key": createKey,
        },
        body: JSON.stringify(createBody),
      }),
      await app.request(`/api/v1/admin/requests/${createdBody.id}/estimates`, {
        method: "POST",
        headers: { ...adminHeaders, "idempotency-key": createKey },
        body: JSON.stringify({
          credits: 1,
          dueOn: "2026-10-20",
          workItems: ["作業"],
          doneCriteria: "反映済み",
        }),
      }),
    ];
    expect(createConflictRequests.map((response) => response.status)).toEqual([
      409, 409, 409,
    ]);
    const requestCount = await pool.query<{ count: number }>(
      "select count(*)::int count from service_requests where contract_id=$1",
      [customer.contractId],
    );
    const estimateCount = await pool.query<{ count: number }>(
      "select count(*)::int count from estimates where request_id=$1",
      [createdBody.id],
    );
    expect(requestCount.rows[0]?.count).toBe(1);
    expect(estimateCount.rows[0]?.count).toBe(1);
    const revisedResponse = await app.request(
      `/api/v1/admin/requests/${createdBody.id}/estimates`,
      {
        method: "POST",
        headers: { ...adminHeaders, "idempotency-key": randomUUID() },
        body: JSON.stringify({
          credits: 1,
          dueOn: "2026-10-20",
          workItems: ["画像を差し替える", "表示を確認する"],
          doneCriteria: "指定画像が表示される",
        }),
      },
    );
    expect(revisedResponse.status).toBe(201);
    const revised = (await revisedResponse.json()) as {
      id: string;
      version: number;
    };
    estimateIds.push(revised.id);
    expect(revised.version).toBe(2);
    const listed = await app.request("/api/v1/me/requests", {
      headers: { authorization: `Bearer ${customer.token}` },
    });
    expect(listed.status).toBe(200);
    const customerDetail = await app.request(
      `/api/v1/me/requests/${createdBody.id}`,
      { headers: { authorization: `Bearer ${customer.token}` } },
    );
    expect(customerDetail.status).toBe(200);
    expect(await customerDetail.json()).toMatchObject({
      request: { id: createdBody.id },
      latestEstimate: { version: 2, dueOn: "2026-10-20" },
      availableCredits: 2,
      canApprove: true,
    });
    const customerOther = await makeContract("b");
    const foreign = await app.request(`/api/v1/me/requests/${createdBody.id}`, {
      headers: { authorization: `Bearer ${customerOther.token}` },
    });
    expect(foreign.status).toBe(404);
    const foreignApprove = await app.request(
      `/api/v1/me/estimates/${revised.id}/approve`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${customerOther.token}`,
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    expect(foreignApprove.status).toBe(404);
    const stale = await app.request(
      `/api/v1/me/estimates/${estimate.id}/approve`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${customer.token}`,
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    expect(stale.status).toBe(409);
    const approveOnce = () =>
      app.request(`/api/v1/me/estimates/${revised.id}/approve`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${customer.token}`,
          "content-type": "application/json",
        },
        body: "{}",
      });
    const approvals = await Promise.all([approveOnce(), approveOnce()]);
    expect(approvals.map((r) => r.status)).toEqual([200, 200]);
    const balance = await pool.query<{ balance: number }>(
      "select sum(amount)::int balance from credit_entries where request_id=$1",
      [createdBody.id],
    );
    expect(balance.rows[0]?.balance).toBe(-1);
    const notifications = await pool.query<{ count: number }>(
      "select count(*)::int count from notifications where kind='NT-06' and customer_id=$1",
      [customer.customerId],
    );
    expect(notifications.rows[0]?.count).toBe(2);
    const statusNotifications = await pool.query<{ count: number }>(
      "select count(*)::int count from notifications where kind='NT-07' and customer_id=$1",
      [customer.customerId],
    );
    expect(statusNotifications.rows[0]?.count).toBe(1);
  });

  it("requires verified second factor for the nested admin request API", async () => {
    const app = makeApp(() => new Date("2026-10-27T02:00:00.000Z"));
    const response = await app.request("/api/v1/admin/requests", {
      headers: { authorization: `Bearer ${noMfaToken}` },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "forbidden" } });
  });

  it("rolls back estimate send and approval when their audit insert fails", async () => {
    const customer = await makeContract("audit-rollback");
    const app = makeApp();
    const adminHeaders = {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
    };
    const create = await app.request("/api/v1/admin/requests", {
      method: "POST",
      headers: { ...adminHeaders, "idempotency-key": randomUUID() },
      body: JSON.stringify({
        contractId: customer.contractId,
        receivedOn: "2026-10-26",
        summary: "監査記録失敗時のロールバック",
        urgent: false,
      }),
    });
    expect(create.status).toBe(201);
    const requestId = ((await create.json()) as { id: string }).id;
    requestIds.push(requestId);

    await pool.query(
      "alter table audit_logs add constraint test_reject_estimate_sent check (action <> 'estimate.sent') not valid",
    );
    let send: Response;
    try {
      send = await app.request(
        `/api/v1/admin/requests/${requestId}/estimates`,
        {
          method: "POST",
          headers: { ...adminHeaders, "idempotency-key": randomUUID() },
          body: JSON.stringify({
            credits: 1,
            dueOn: "2026-10-30",
            workItems: ["作業"],
            doneCriteria: "反映済み",
          }),
        },
      );
    } finally {
      await pool.query(
        "alter table audit_logs drop constraint test_reject_estimate_sent",
      );
    }
    expect(send?.status).toBe(500);
    const afterSend = await pool.query<{
      status: string;
      estimates: number;
      commandKeys: number;
      notices: number;
    }>(
      `select r.status,
        (select count(*)::int from estimates where request_id=r.id) estimates,
        (select count(*)::int from request_command_keys where target_id=r.id and command='estimate') "commandKeys",
        (select count(*)::int from notifications where customer_id=$2 and kind='NT-06') notices
       from service_requests r where r.id=$1`,
      [requestId, customer.customerId],
    );
    expect(requireRow(afterSend.rows[0])).toEqual({
      status: "received",
      estimates: 0,
      commandKeys: 0,
      notices: 0,
    });

    const sent = await app.request(
      `/api/v1/admin/requests/${requestId}/estimates`,
      {
        method: "POST",
        headers: { ...adminHeaders, "idempotency-key": randomUUID() },
        body: JSON.stringify({
          credits: 1,
          dueOn: "2026-10-30",
          workItems: ["作業"],
          doneCriteria: "反映済み",
        }),
      },
    );
    expect(sent.status).toBe(201);
    const estimateId = ((await sent.json()) as { id: string }).id;
    estimateIds.push(estimateId);

    await pool.query(
      "alter table audit_logs add constraint test_reject_estimate_approved check (action <> 'estimate.approved') not valid",
    );
    let approval: Response;
    try {
      approval = await app.request(
        `/api/v1/me/estimates/${estimateId}/approve`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${customer.token}`,
            "content-type": "application/json",
          },
          body: "{}",
        },
      );
    } finally {
      await pool.query(
        "alter table audit_logs drop constraint test_reject_estimate_approved",
      );
    }
    expect(approval?.status).toBe(500);
    const afterApproval = await pool.query<{
      status: string;
      approved_estimate_id: string | null;
      approved_at: string | null;
      reserves: number;
      notices: number;
    }>(
      `select r.status,r.approved_estimate_id::text,e.approved_at::text,
        (select count(*)::int from credit_entries where request_id=r.id and kind='reserve') reserves,
        (select count(*)::int from notifications where customer_id=$2 and kind='NT-07') notices
       from service_requests r join estimates e on e.id=$3 where r.id=$1`,
      [requestId, customer.customerId, estimateId],
    );
    expect(requireRow(afterApproval.rows[0])).toEqual({
      status: "awaiting_approval",
      approved_estimate_id: null,
      approved_at: null,
      reserves: 0,
      notices: 0,
    });
  });

  it("suppresses estimate and approval notices for preview initial invoices", async () => {
    const customer = await makeContract("preview-notices");
    await pool.query(
      `insert into invoices(invoice_no,contract_id,kind,payment_method,issued_on,total_incl_tax,total_excl_tax,tax_amount,billing_name,issuer_snapshot)
       values($1,$2,'initial','bank_transfer','2026-10-01',5000,5000,0,'請求先','{"preview":true}'::jsonb)`,
      [`KS-REQ-${randomUUID()}`, customer.contractId],
    );
    const app = makeApp(() => new Date("2026-10-27T02:00:00.000Z"));
    const adminHeaders = {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
    };
    const created = await app.request("/api/v1/admin/requests", {
      method: "POST",
      headers: { ...adminHeaders, "idempotency-key": randomUUID() },
      body: JSON.stringify({
        contractId: customer.contractId,
        receivedOn: "2026-10-26",
        summary: "プレビュー契約の依頼",
        urgent: false,
      }),
    });
    expect(created.status).toBe(201);
    const requestId = ((await created.json()) as { id: string }).id;
    requestIds.push(requestId);
    const sent = await app.request(
      `/api/v1/admin/requests/${requestId}/estimates`,
      {
        method: "POST",
        headers: { ...adminHeaders, "idempotency-key": randomUUID() },
        body: JSON.stringify({
          credits: 1,
          dueOn: "2026-10-30",
          workItems: ["作業"],
          doneCriteria: "反映済み",
        }),
      },
    );
    expect(sent.status).toBe(201);
    const estimateId = ((await sent.json()) as { id: string }).id;
    estimateIds.push(estimateId);
    const approved = await app.request(
      `/api/v1/me/estimates/${estimateId}/approve`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${customer.token}`,
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    expect(approved.status).toBe(200);
    const completed = await app.request(
      `/api/v1/admin/requests/${requestId}/complete`,
      {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
          completedOn: "2026-10-27",
          actualMinutes: 20,
          actualCredits: 1,
        }),
      },
    );
    expect(completed.status).toBe(200);
    const notices = await pool.query<{ count: number }>(
      "select count(*)::int count from notifications where customer_id=$1 and kind in ('NT-06','NT-07')",
      [customer.customerId],
    );
    expect(notices.rows[0]?.count).toBe(0);
  });

  it("completes an approved request and settles its original credit reservation", async () => {
    const customer = await makeContract("completion-red");
    const app = makeApp(() => new Date("2026-10-27T02:00:00.000Z"));
    const adminHeaders = {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
    };
    const created = await app.request("/api/v1/admin/requests", {
      method: "POST",
      headers: { ...adminHeaders, "idempotency-key": randomUUID() },
      body: JSON.stringify({
        contractId: customer.contractId,
        receivedOn: "2026-10-26",
        summary: "完了APIのTDD確認",
        urgent: false,
      }),
    });
    expect(created.status).toBe(201);
    const requestId = ((await created.json()) as { id: string }).id;
    requestIds.push(requestId);
    const sent = await app.request(
      `/api/v1/admin/requests/${requestId}/estimates`,
      {
        method: "POST",
        headers: { ...adminHeaders, "idempotency-key": randomUUID() },
        body: JSON.stringify({
          credits: 1,
          dueOn: "2026-10-30",
          workItems: ["対応"],
          doneCriteria: "対応完了",
        }),
      },
    );
    expect(sent.status).toBe(201);
    const estimateId = ((await sent.json()) as { id: string }).id;
    estimateIds.push(estimateId);
    const approved = await app.request(
      `/api/v1/me/estimates/${estimateId}/approve`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${customer.token}`,
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    expect(approved.status).toBe(200);
    const reservation = await pool.query<{
      period_id: string;
      amount: number;
    }>(
      "select period_id,amount from credit_entries where request_id=$1 and kind='reserve'",
      [requestId],
    );
    expect(reservation.rows).toHaveLength(1);
    const periodId = requireRow(reservation.rows[0]).period_id;

    const completed = await app.request(
      `/api/v1/admin/requests/${requestId}/complete`,
      {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
          completedOn: "2026-10-27",
          actualMinutes: 35,
          actualCredits: 1,
        }),
      },
    );
    expect(completed.status).toBe(200);
    const completedBody = await completed.json();
    expect(completeRequestResponseSchema.safeParse(completedBody).success).toBe(
      true,
    );
    expect(completedBody).toMatchObject({
      requestId,
      status: "done",
      completedOn: "2026-10-27",
      actualMinutes: 35,
      actualCredits: 1,
      reservedCredits: 1,
      periodId,
      replayed: false,
    });
    const replayedCompletion = await app.request(
      `/api/v1/admin/requests/${requestId}/complete`,
      {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
          completedOn: "2026-10-27",
          actualMinutes: 35,
          actualCredits: 1,
        }),
      },
    );
    expect(replayedCompletion.status).toBe(200);
    expect(await replayedCompletion.json()).toMatchObject({ replayed: true });
    const settled = await pool.query<{
      status: string;
      completed_on: string;
      actual_minutes: number;
      kind: string;
      period_id: string;
      amount: number;
    }>(
      `select r.status,r.completed_on::text,r.actual_minutes,e.kind,e.period_id,e.amount
       from service_requests r join credit_entries e on e.request_id=r.id
       where r.id=$1 order by e.kind`,
      [requestId],
    );
    expect(settled.rows).toEqual([
      {
        status: "done",
        completed_on: "2026-10-27",
        actual_minutes: 35,
        kind: "consume",
        period_id: periodId,
        amount: -1,
      },
      {
        status: "done",
        completed_on: "2026-10-27",
        actual_minutes: 35,
        kind: "release",
        period_id: periodId,
        amount: 1,
      },
      {
        status: "done",
        completed_on: "2026-10-27",
        actual_minutes: 35,
        kind: "reserve",
        period_id: periodId,
        amount: -1,
      },
    ]);
    const adminDetail = await app.request(
      `/api/v1/admin/requests/${requestId}`,
      { headers: { authorization: `Bearer ${adminToken}` } },
    );
    const adminDetailBody = await adminDetail.json();
    expect(adminRequestDetailSchema.safeParse(adminDetailBody).success).toBe(
      true,
    );
    expect(adminDetailBody).toMatchObject({
      status: "done",
      completion: {
        actualCredits: 1,
        actualMinutes: 35,
        periodId,
        reservedPeriod: { startsOn: "2026-10-01", endsOn: "2026-10-31" },
      },
    });
  });

  it("replays identical completion, rejects a changed replay, and releases zero actual credits", async () => {
    const fixture = await makeInProgressRequest("completion-zero-replay", 2, 3);
    const completionBody = {
      completedOn: "2026-10-27",
      actualMinutes: 0,
      actualCredits: 0,
    };
    const complete = () =>
      fixture.app.request(
        `/api/v1/admin/requests/${fixture.requestId}/complete`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${adminToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(completionBody),
        },
      );
    const concurrent = await Promise.all([complete(), complete()]);
    expect(concurrent.map((response) => response.status)).toEqual([200, 200]);
    const concurrentBodies = await Promise.all(
      concurrent.map((response) => response.json()),
    );
    expect(concurrentBodies.map((body) => body.replayed).sort()).toEqual([
      false,
      true,
    ]);
    expect(concurrentBodies[0]).toMatchObject({
      status: "done",
      actualCredits: 0,
      reservedCredits: 2,
    });
    const approvalReplay = await fixture.app.request(
      `/api/v1/me/estimates/${fixture.estimateId}/approve`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${fixture.customer.token}`,
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    expect(approvalReplay.status).toBe(200);
    expect(await approvalReplay.json()).toMatchObject({
      status: "in_progress",
      replayed: true,
    });
    const changedReplay = await fixture.app.request(
      `/api/v1/admin/requests/${fixture.requestId}/complete`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${adminToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...completionBody, actualMinutes: 1 }),
      },
    );
    expect(changedReplay.status).toBe(409);
    const entries = await pool.query<{ kind: string; amount: number }>(
      "select kind,amount from credit_entries where request_id=$1 order by kind",
      [fixture.requestId],
    );
    expect(entries.rows).toEqual([
      { kind: "consume", amount: 0 },
      { kind: "release", amount: 2 },
      { kind: "reserve", amount: -2 },
    ]);
    const completedNotices = await pool.query<{ count: number }>(
      "select count(*)::int count from notifications where dedupe_key=$1",
      [`NT-07:${fixture.requestId}:completed`],
    );
    expect(completedNotices.rows[0]?.count).toBe(1);
    const noticeSnapshots = await pool.query<{
      dedupe_key: string;
      payload: { requestId: string; status: string };
    }>(
      "select dedupe_key,payload from notifications where dedupe_key=any($1::text[]) order by dedupe_key",
      [
        [
          `NT-07:${fixture.requestId}:approved`,
          `NT-07:${fixture.requestId}:completed`,
        ],
      ],
    );
    expect(noticeSnapshots.rows).toEqual([
      {
        dedupe_key: `NT-07:${fixture.requestId}:approved`,
        payload: { requestId: fixture.requestId, status: "in_progress" },
      },
      {
        dedupe_key: `NT-07:${fixture.requestId}:completed`,
        payload: { requestId: fixture.requestId, status: "done" },
      },
    ]);
    const customerDetail = await fixture.app.request(
      `/api/v1/me/requests/${fixture.requestId}`,
      { headers: { authorization: `Bearer ${fixture.customer.token}` } },
    );
    const customerDetailBody = await customerDetail.json();
    expect(
      customerRequestDetailSchema.safeParse(customerDetailBody).success,
    ).toBe(true);
    expect(customerDetailBody).toMatchObject({
      request: {
        status: "done",
        completion: {
          completedOn: "2026-10-27",
          actualMinutes: 0,
          actualCredits: 0,
          reservedCredits: 2,
          periodId: fixture.periodId,
        },
      },
    });
  });

  it("expires unused released credits in the expired reservation period without carrying them forward", async () => {
    const fixture = await makeInProgressRequest(
      "completion-expired-period",
      3,
      5,
    );
    await pool.query(
      "update billing_periods set ends_on='2026-10-31' where id=$1",
      [fixture.periodId],
    );
    const nextPeriod = await pool.query<{ id: string }>(
      `insert into billing_periods(contract_id,seq,starts_on,ends_on,plan_id,price_incl_tax,credits)
       select contract_id,2,'2026-11-01','2026-11-30',plan_id,5000,5
       from billing_periods where id=$1 returning id`,
      [fixture.periodId],
    );
    const nextPeriodId = requireRow(nextPeriod.rows[0]).id;
    await pool.query(
      "insert into credit_entries(contract_id,period_id,kind,amount) values($1,$2,'grant',5)",
      [fixture.customer.contractId, nextPeriodId],
    );
    await pool.query("update contracts set status='ended' where id=$1", [
      fixture.customer.contractId,
    ]);
    const completionApp = makeApp(() => new Date("2026-11-01T00:30:00.000Z"));
    const response = await completionApp.request(
      `/api/v1/admin/requests/${fixture.requestId}/complete`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${adminToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          completedOn: "2026-11-01",
          actualMinutes: 45,
          actualCredits: 1,
        }),
      },
    );
    expect(response.status).toBe(200);
    const oldEntries = await pool.query<{ kind: string; amount: number }>(
      "select kind,amount from credit_entries where request_id=$1 order by kind",
      [fixture.requestId],
    );
    expect(oldEntries.rows).toEqual([
      { kind: "consume", amount: -1 },
      { kind: "expire", amount: -2 },
      { kind: "release", amount: 3 },
      { kind: "reserve", amount: -3 },
    ]);
    const balances = await pool.query<{ period_id: string; balance: number }>(
      "select period_id,coalesce(sum(amount),0)::int balance from credit_entries where contract_id=$1 and period_id=any($2::uuid[]) group by period_id order by period_id",
      [fixture.customer.contractId, [fixture.periodId, nextPeriodId]],
    );
    expect(balances.rows).toHaveLength(2);
    expect(
      balances.rows.find((row) => row.period_id === nextPeriodId)?.balance,
    ).toBe(5);
    // screen-flow-spec-v1 §2 exposes invoice history, not request history, after contract end.
    const customerList = await completionApp.request("/api/v1/me/requests", {
      headers: { authorization: `Bearer ${fixture.customer.token}` },
    });
    expect.soft(customerList.status).toBe(404);
    const customerDetail = await completionApp.request(
      `/api/v1/me/requests/${fixture.requestId}`,
      { headers: { authorization: `Bearer ${fixture.customer.token}` } },
    );
    expect.soft(customerDetail.status).toBe(404);
    const adminDetail = await completionApp.request(
      `/api/v1/admin/requests/${fixture.requestId}`,
      { headers: { authorization: `Bearer ${adminToken}` } },
    );
    expect(adminDetail.status).toBe(200);
    expect(await adminDetail.json()).toMatchObject({
      status: "done",
      completion: {
        periodId: fixture.periodId,
        reservedPeriod: { startsOn: "2026-10-01", endsOn: "2026-10-31" },
      },
    });
  });

  it("replays completion based on stored settlement after the reservation period expires", async () => {
    let instant = new Date("2026-10-30T12:00:00.000Z");
    const fixture = await makeInProgressRequest(
      "completion-replay-after-expiry",
      2,
      5,
      () => instant,
    );
    const body = {
      completedOn: "2026-10-30",
      actualMinutes: 30,
      actualCredits: 1,
    };
    const complete = () =>
      fixture.app.request(
        `/api/v1/admin/requests/${fixture.requestId}/complete`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${adminToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
    const first = await complete();
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ replayed: false });
    instant = new Date("2026-11-01T00:30:00.000Z");
    const replay = await complete();
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      status: "done",
      actualCredits: 1,
      replayed: true,
    });
    const settlement = await pool.query<{ kind: string; amount: number }>(
      "select kind,amount from credit_entries where request_id=$1 and kind in ('release','consume','expire') order by kind",
      [fixture.requestId],
    );
    expect(settlement.rows).toEqual([
      { kind: "consume", amount: -1 },
      { kind: "release", amount: 2 },
    ]);
  });

  it("returns safe signed balances after valid maximum-int overrun completions", async () => {
    const customer = await makeContract("completion-balance-int8", "active", 2);
    const today = toTokyoDate(new Date());
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));
    const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
    const periodEnd = new Date(Date.UTC(year, month, 0))
      .toISOString()
      .slice(0, 10);
    const grant = await pool.query<{ period_id: string }>(
      "select period_id from credit_entries where contract_id=$1 and kind='grant'",
      [customer.contractId],
    );
    const periodId = requireRow(grant.rows[0]).period_id;
    await pool.query(
      "update billing_periods set starts_on=$2,ends_on=$3 where id=$1",
      [periodId, periodStart, periodEnd],
    );
    const app = makeApp(() => new Date(`${today}T03:00:00.000Z`));
    const adminHeaders = {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
    };
    const createAndApprove = async (summaryText: string) => {
      const created = await app.request("/api/v1/admin/requests", {
        method: "POST",
        headers: { ...adminHeaders, "idempotency-key": randomUUID() },
        body: JSON.stringify({
          contractId: customer.contractId,
          receivedOn: today,
          summary: summaryText,
          urgent: false,
        }),
      });
      expect(created.status).toBe(201);
      const requestId = ((await created.json()) as { id: string }).id;
      requestIds.push(requestId);
      const sent = await app.request(
        `/api/v1/admin/requests/${requestId}/estimates`,
        {
          method: "POST",
          headers: { ...adminHeaders, "idempotency-key": randomUUID() },
          body: JSON.stringify({
            credits: 1,
            dueOn: today,
            workItems: ["作業"],
            doneCriteria: "反映済み",
          }),
        },
      );
      expect(sent.status).toBe(201);
      const estimateId = ((await sent.json()) as { id: string }).id;
      estimateIds.push(estimateId);
      const approved = await app.request(
        `/api/v1/me/estimates/${estimateId}/approve`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${customer.token}`,
            "content-type": "application/json",
          },
          body: "{}",
        },
      );
      expect(approved.status).toBe(200);
      return requestId;
    };
    const requestIdsWithLargeActuals = await Promise.all([
      createAndApprove("最大整数の実績A"),
      createAndApprove("最大整数の実績B"),
    ]);
    for (const requestId of requestIdsWithLargeActuals) {
      const completed = await app.request(
        `/api/v1/admin/requests/${requestId}/complete`,
        {
          method: "POST",
          headers: adminHeaders,
          body: JSON.stringify({
            completedOn: today,
            actualMinutes: 1,
            actualCredits: 2_147_483_647,
          }),
        },
      );
      expect(completed.status).toBe(200);
    }
    const requestRead = await app.request(
      `/api/v1/me/requests/${requestIdsWithLargeActuals[0]}`,
      { headers: { authorization: `Bearer ${customer.token}` } },
    );
    expect(requestRead.status).toBe(200);
    expect(await requestRead.json()).toMatchObject({
      availableCredits: -4_294_967_292,
    });
    const homeRead = await app.request("/api/v1/me/contract", {
      headers: { authorization: `Bearer ${customer.token}` },
    });
    expect(homeRead.status).toBe(200);
    expect(await homeRead.json()).toMatchObject({
      contract: { currentPeriod: { balance: -4_294_967_292 } },
    });
  });

  it("records overrun above the reservation without capping it or creating a charge", async () => {
    const fixture = await makeInProgressRequest("completion-overrun", 2, 5);
    const response = await fixture.app.request(
      `/api/v1/admin/requests/${fixture.requestId}/complete`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${adminToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          completedOn: "2026-10-27",
          actualMinutes: 70,
          actualCredits: 4,
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      actualCredits: 4,
      reservedCredits: 2,
    });
    const accounting = await pool.query<{
      entries: number;
      balance: number;
      periodBalance: number;
      invoices: number;
    }>(
      `select
         (select count(*)::int from credit_entries where request_id=$1 and kind in ('reserve','release','consume')) entries,
         (select coalesce(sum(amount),0)::int from credit_entries where request_id=$1) balance,
         (select coalesce(sum(amount),0)::int from credit_entries where contract_id=$2 and period_id=$3) "periodBalance",
         (select count(*)::int from invoices where contract_id=$2 and kind='extra_credit') invoices`,
      [fixture.requestId, fixture.customer.contractId, fixture.periodId],
    );
    expect(accounting.rows[0]).toEqual({
      entries: 3,
      balance: -4,
      periodBalance: 1,
      invoices: 0,
    });
  });

  it("rolls back completion settlement when its audit insert fails", async () => {
    const fixture = await makeInProgressRequest(
      "completion-audit-rollback",
      2,
      3,
    );
    await pool.query(
      "alter table audit_logs add constraint test_reject_request_completed check (action <> 'request.completed') not valid",
    );
    let response: Response | undefined;
    try {
      response = await fixture.app.request(
        `/api/v1/admin/requests/${fixture.requestId}/complete`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${adminToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            completedOn: "2026-10-27",
            actualMinutes: 20,
            actualCredits: 1,
          }),
        },
      );
    } finally {
      await pool.query(
        "alter table audit_logs drop constraint test_reject_request_completed",
      );
    }
    expect(response?.status).toBe(500);
    const state = await pool.query<{
      status: string;
      completed_on: string | null;
      actual_minutes: number | null;
      settlements: number;
      completionNotices: number;
    }>(
      `select r.status,r.completed_on::text,r.actual_minutes,
         (select count(*)::int from credit_entries where request_id=r.id and kind in ('release','consume','expire')) settlements,
         (select count(*)::int from notifications where dedupe_key=$2) "completionNotices"
       from service_requests r where r.id=$1`,
      [fixture.requestId, `NT-07:${fixture.requestId}:completed`],
    );
    expect(requireRow(state.rows[0])).toEqual({
      status: "in_progress",
      completed_on: null,
      actual_minutes: null,
      settlements: 0,
      completionNotices: 0,
    });
  });

  it("rejects completion dates outside Tokyo today and malformed or unreserved work", async () => {
    const fixture = await makeInProgressRequest("completion-validation", 1, 2);
    const headers = {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
    };
    const invalidResponses = await Promise.all([
      fixture.app.request(
        `/api/v1/admin/requests/${fixture.requestId}/complete`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            completedOn: "2026-10-28",
            actualMinutes: 1,
            actualCredits: 1,
          }),
        },
      ),
      fixture.app.request(
        `/api/v1/admin/requests/${fixture.requestId}/complete`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            completedOn: "2026-10-27",
            actualMinutes: -1,
            actualCredits: 1,
          }),
        },
      ),
      fixture.app.request(
        `/api/v1/admin/requests/${fixture.requestId}/complete`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            completedOn: "2026-10-25",
            actualMinutes: 1,
            actualCredits: 1,
          }),
        },
      ),
      fixture.app.request(
        `/api/v1/admin/requests/${fixture.requestId}/complete`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${noMfaToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            completedOn: "2026-10-27",
            actualMinutes: 1,
            actualCredits: 1,
          }),
        },
      ),
    ]);
    expect(invalidResponses.map((response) => response.status)).toEqual([
      422, 422, 409, 403,
    ]);
    await pool.query(
      "delete from credit_entries where request_id=$1 and kind='reserve'",
      [fixture.requestId],
    );
    const missingReservation = await fixture.app.request(
      `/api/v1/admin/requests/${fixture.requestId}/complete`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          completedOn: "2026-10-27",
          actualMinutes: 1,
          actualCredits: 1,
        }),
      },
    );
    expect(missingReservation.status).toBe(409);
    const unchanged = await pool.query<{
      status: string;
      completed_on: string | null;
      settlements: number;
    }>(
      `select status,completed_on::text,
        (select count(*)::int from credit_entries where request_id=$1 and kind in ('release','consume','expire')) settlements
       from service_requests where id=$1`,
      [fixture.requestId],
    );
    expect(unchanged.rows[0]).toEqual({
      status: "in_progress",
      completed_on: null,
      settlements: 0,
    });
  });

  it("allows registration and estimating with no credit balance but rejects approval", async () => {
    const customer = await makeContract("unfunded", "active", 0);
    const app = makeApp();
    const adminHeaders = {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
    };
    const requestResponse = await app.request("/api/v1/admin/requests", {
      method: "POST",
      headers: { ...adminHeaders, "idempotency-key": randomUUID() },
      body: JSON.stringify({
        contractId: customer.contractId,
        receivedOn: "2026-10-26",
        summary: "相談",
        urgent: false,
      }),
    });
    expect(requestResponse.status).toBe(201);
    const requestId = ((await requestResponse.json()) as { id: string }).id;
    requestIds.push(requestId);
    const estimateResponse = await app.request(
      `/api/v1/admin/requests/${requestId}/estimates`,
      {
        method: "POST",
        headers: { ...adminHeaders, "idempotency-key": randomUUID() },
        body: JSON.stringify({
          credits: 1,
          dueOn: "2026-10-20",
          workItems: ["作業"],
          doneCriteria: "反映済み",
        }),
      },
    );
    expect(estimateResponse.status).toBe(201);
    const estimateId = ((await estimateResponse.json()) as { id: string }).id;
    const detail = await app.request(`/api/v1/me/requests/${requestId}`, {
      headers: { authorization: `Bearer ${customer.token}` },
    });
    expect(await detail.json()).toMatchObject({
      availableCredits: 0,
      canApprove: false,
    });
    const approval = await app.request(
      `/api/v1/me/estimates/${estimateId}/approve`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${customer.token}`,
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    expect(approval.status).toBe(409);
    expect(await approval.json()).toEqual({
      error: { code: "insufficient_credits" },
    });
  });

  it.each([
    "none",
    "expired",
  ] as const)("rejects approval when the active contract has no current funded period (%s)", async (periodMode) => {
    const customer = await makeContract(
      `no-period-${periodMode}`,
      "active",
      1,
      periodMode,
    );
    const app = makeApp();
    const adminHeaders = {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
    };
    const requestResponse = await app.request("/api/v1/admin/requests", {
      method: "POST",
      headers: { ...adminHeaders, "idempotency-key": randomUUID() },
      body: JSON.stringify({
        contractId: customer.contractId,
        receivedOn: "2026-10-26",
        summary: "相談",
        urgent: false,
      }),
    });
    expect(requestResponse.status).toBe(201);
    const requestId = ((await requestResponse.json()) as { id: string }).id;
    requestIds.push(requestId);
    const estimateResponse = await app.request(
      `/api/v1/admin/requests/${requestId}/estimates`,
      {
        method: "POST",
        headers: { ...adminHeaders, "idempotency-key": randomUUID() },
        body: JSON.stringify({
          credits: 1,
          dueOn: "2026-10-20",
          workItems: ["作業"],
          doneCriteria: "反映済み",
        }),
      },
    );
    expect(estimateResponse.status).toBe(201);
    const estimateId = ((await estimateResponse.json()) as { id: string }).id;
    const approval = await app.request(
      `/api/v1/me/estimates/${estimateId}/approve`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${customer.token}`,
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    expect(approval.status).toBe(409);
    expect(await approval.json()).toEqual({
      error: { code: "request_conflict" },
    });
  });

  it("does not accept new requests for ended contracts", async () => {
    const customer = await makeContract("ended", "ended", 0, "none");
    const app = makeApp();
    const response = await app.request("/api/v1/admin/requests", {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminToken}`,
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: JSON.stringify({
        contractId: customer.contractId,
        receivedOn: "2026-10-26",
        summary: "相談",
        urgent: false,
      }),
    });
    expect(response.status).toBe(404);
  });

  it("rechecks contract eligibility after waiting for its lock", async () => {
    const customer = await makeContract("estimate-send-lock");
    const appPoolUrl = new URL(
      process.env.TEST_DATABASE_URL ??
        "postgres://kobito:kobito@127.0.0.1:5432/kobito_support_test",
    );
    const applicationName = `request-estimate-lock-${randomUUID()}`;
    appPoolUrl.searchParams.set("application_name", applicationName);
    const appPool = new Pool({ connectionString: appPoolUrl.toString() });
    const app = makeApp(() => new Date("2026-10-26T12:00:00.000Z"), appPool);
    const adminHeaders = {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
    };
    const requestResponse = await app.request("/api/v1/admin/requests", {
      method: "POST",
      headers: { ...adminHeaders, "idempotency-key": randomUUID() },
      body: JSON.stringify({
        contractId: customer.contractId,
        receivedOn: "2026-10-26",
        summary: "見積送信時の契約状態を確認",
        urgent: false,
      }),
    });
    expect(requestResponse.status).toBe(201);
    const requestId = ((await requestResponse.json()) as { id: string }).id;
    requestIds.push(requestId);

    const blocker = await pool.connect();
    let blockerTransactionOpen = false;
    let estimatePromise: Promise<Response> | undefined;
    try {
      await blocker.query("begin");
      blockerTransactionOpen = true;
      const blockerPidResult = await blocker.query<{ pid: number }>(
        "select pg_backend_pid() as pid",
      );
      const blockerPid = requireRow(blockerPidResult.rows[0]).pid;
      await blocker.query("update contracts set status='ended' where id=$1", [
        customer.contractId,
      ]);

      estimatePromise = Promise.resolve(
        app.request(`/api/v1/admin/requests/${requestId}/estimates`, {
          method: "POST",
          headers: {
            ...adminHeaders,
            "idempotency-key": randomUUID(),
          },
          body: JSON.stringify({
            credits: 1,
            dueOn: "2026-10-30",
            workItems: ["作業"],
            doneCriteria: "反映済み",
          }),
        }),
      );

      let sendBackendBlocked = false;
      for (
        let attempt = 0;
        attempt < 200 && !sendBackendBlocked;
        attempt += 1
      ) {
        const blockers = await blocker.query<{
          pid: number;
          blocked_by: number[];
        }>(
          `select pid, pg_blocking_pids(pid) as blocked_by
             from pg_stat_activity
            where application_name=$1`,
          [applicationName],
        );
        sendBackendBlocked = blockers.rows.some((row) =>
          row.blocked_by.includes(blockerPid),
        );
        if (!sendBackendBlocked) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
      expect(sendBackendBlocked).toBe(true);

      await blocker.query("commit");
      blockerTransactionOpen = false;
      const response = await estimatePromise;
      expect([404, 409]).toContain(response.status);
      const after = await pool.query<{
        estimates: number;
        notices: number;
        estimateAudits: number;
      }>(
        `select
           (select count(*)::int from estimates where request_id=$1 and sent_at is not null) as estimates,
           (select count(*)::int from notifications where customer_id=$2 and kind='NT-06') as notices,
           (select count(*)::int from audit_logs where action='estimate.sent' and target_id=$1::text) as "estimateAudits"`,
        [requestId, customer.customerId],
      );
      expect(requireRow(after.rows[0])).toEqual({
        estimates: 0,
        notices: 0,
        estimateAudits: 0,
      });
    } finally {
      if (blockerTransactionOpen) await blocker.query("rollback");
      blocker.release();
      await estimatePromise?.catch(() => undefined);
      await appPool.end();
    }
  });

  it("serializes approvals for different requests against the same single-credit balance", async () => {
    const customer = await makeContract("concurrent", "active", 1);
    const app = makeApp();
    const adminHeaders = {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
    };
    const create = async (summary: string) => {
      const created = await app.request("/api/v1/admin/requests", {
        method: "POST",
        headers: { ...adminHeaders, "idempotency-key": randomUUID() },
        body: JSON.stringify({
          contractId: customer.contractId,
          receivedOn: "2026-10-26",
          summary,
          urgent: false,
        }),
      });
      expect(created.status).toBe(201);
      const requestId = ((await created.json()) as { id: string }).id;
      requestIds.push(requestId);
      const sent = await app.request(
        `/api/v1/admin/requests/${requestId}/estimates`,
        {
          method: "POST",
          headers: { ...adminHeaders, "idempotency-key": randomUUID() },
          body: JSON.stringify({
            credits: 1,
            dueOn: "2026-10-20",
            workItems: ["作業"],
            doneCriteria: "反映済み",
          }),
        },
      );
      expect(sent.status).toBe(201);
      return ((await sent.json()) as { id: string }).id;
    };
    const [first, second] = await Promise.all([
      create("一つ目"),
      create("二つ目"),
    ]);
    const approve = (id: string) =>
      app.request(`/api/v1/me/estimates/${id}/approve`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${customer.token}`,
          "content-type": "application/json",
        },
        body: "{}",
      });
    const results = await Promise.all([approve(first), approve(second)]);
    expect(results.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    const reserves = await pool.query<{ count: number; total: number }>(
      "select count(*)::int count,coalesce(sum(amount),0)::int total from credit_entries where contract_id=$1 and kind='reserve'",
      [customer.contractId],
    );
    expect(reserves.rows[0]).toEqual({ count: 1, total: -1 });
  });
});
