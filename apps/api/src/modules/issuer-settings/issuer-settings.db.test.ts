import { randomUUID } from "node:crypto";
import {
  adminIssuerSettingsResponseSchema,
  updateAdminIssuerSettingsRequestSchema,
} from "@kobito/shared";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AppDependencies, createApp } from "../../app.js";
import type { VerifiedIdentity } from "../../platform/auth.js";
import type { RuntimeConfig } from "../../platform/config.js";
import { AccountsRepository } from "../accounts/repository.js";
import { IssuerSettingsRepository } from "./repository.js";
import { IssuerSettingsService } from "./service.js";

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const testPrefix = `issuer-settings-${randomUUID()}`;
const adminUid = `${testPrefix}-admin`;
const adminToken = `${testPrefix}-verified-token`;
const originalSettings = new Map<string, unknown>();
const settingKeys = [
  "service_name",
  "company_name",
  "company_address",
  "invoice_registration_no",
  "invoice_prefix",
  "bank_account",
] as const;
const identities = new Map<string, VerifiedIdentity>([
  [adminToken, { uid: adminUid, firebase: { sign_in_second_factor: "phone" } }],
]);
const config: RuntimeConfig = {
  nodeEnv: "test",
  databaseUrl: "postgres://kobito:kobito@127.0.0.1:55433/kobito_support",
  firebaseProjectId: "demo-kobito-support",
  webOrigin: "http://localhost:5173",
  port: 3000,
  invoicePrefix: "KS",
};

function makeApp(): ReturnType<typeof createApp> {
  const accounts = new AccountsRepository(pool);
  const dependencies: AppDependencies = {
    config,
    verifier: {
      verifyIdToken: async (token) => {
        const identity = identities.get(token);
        if (!identity) throw new Error("invalid issuer settings test identity");
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
        throw new Error("not used");
      },
    },
    admin: {
      listPaymentReviews: async () => ({
        events: [],
        failedInvoices: [],
        eventCount: 0,
        failedInvoiceCount: 0,
      }),
      resolvePaymentReview: async (_principal, eventId) => ({
        eventId,
        resolved: true,
      }),
      listNotificationFailures: async () => ({ items: [], totalCount: 0 }),
      retryNotificationFailure: async () => ({
        id: "11111111-1111-4111-8111-111111111111",
        scheduled: true as const,
      }),
      listApplications: async () => ({
        items: [],
        page: 1,
        pageSize: 25,
        total: 0,
      }),
      getCustomerDetail: async () => {
        throw new Error("not used");
      },
      getCancellation: async () => {
        throw new Error("not used");
      },
      scheduleCancellation: async () => {
        throw new Error("not used");
      },
      revokeCancellation: async () => {
        throw new Error("not used");
      },
      updateCancellationChecklist: async () => {
        throw new Error("not used");
      },
      declineApplication: async () => {
        throw new Error("not used");
      },
    },
    issuerSettings: new IssuerSettingsService(
      new IssuerSettingsRepository(pool),
    ),
    invoices: {
      getReadiness: async () => ({
        canIssue: false,
        mode: "unavailable",
        reason: "issuer_not_configured",
      }),
      approveApplication: async () => {
        throw new Error("not used");
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
      voidInvoice: async () => {
        throw new Error("not used");
      },
      getCustomerContract: async () => ({ contract: null }),
      purchaseExtraCredits: async () => {
        throw new Error("not implemented");
      },
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
    publicSettings: {
      getServiceName: async () => "test",
      getContactEmail: async () => null,
    },
    logger: { info: () => {}, error: () => {} },
    komojuInbox: { receive: async () => "accepted" },
  };
  return createApp(dependencies);
}

function authHeaders() {
  return { authorization: `Bearer ${adminToken}` };
}

async function readSettings(app: ReturnType<typeof createApp>) {
  const response = await app.request("/api/v1/admin/settings", {
    headers: authHeaders(),
  });
  expect(response.status).toBe(200);
  return adminIssuerSettingsResponseSchema.parse(await response.json());
}

async function updateSettings(
  app: ReturnType<typeof createApp>,
  expectedRevision: string,
  settings: unknown,
) {
  const body = updateAdminIssuerSettingsRequestSchema.parse({
    expectedRevision,
    settings,
  });
  return app.request("/api/v1/admin/settings", {
    method: "PUT",
    headers: { ...authHeaders(), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function waitForAdvisoryWaiters(expected: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ count: number }>(
      `select count(*)::int as count from pg_stat_activity
        where wait_event_type = 'Lock' and wait_event = 'advisory'
          and query = 'select pg_advisory_xact_lock(902771, 1)'`,
    );
    if (result.rows[0]?.count === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Expected ${expected} issuer settings advisory lock waiters`);
}

beforeAll(async () => {
  const prior = await pool.query<{ key: string; value: unknown }>(
    "select key, value from settings where key = any($1::text[])",
    [settingKeys],
  );
  for (const row of prior.rows) originalSettings.set(row.key, row.value);
  await pool.query(
    `insert into user_accounts (auth_user_id, customer_id, role)
     values ($1, null, 'admin')`,
    [adminUid],
  );
});

afterAll(async () => {
  await pool.query("delete from audit_logs where actor = $1", [adminUid]);
  await pool.query("delete from user_accounts where auth_user_id = $1", [
    adminUid,
  ]);
  for (const key of settingKeys) {
    const prior = originalSettings.get(key);
    if (prior === undefined) {
      await pool.query("delete from settings where key = $1", [key]);
    } else {
      await pool.query("update settings set value = $2::jsonb where key = $1", [
        key,
        JSON.stringify(prior),
      ]);
    }
  }
  await pool.end();
});

describe("admin issuer settings through PostgreSQL", () => {
  it("returns the actual settings DTO and permits incomplete issuer configuration", async () => {
    const app = makeApp();
    const initial = await readSettings(app);
    const settings = {
      ...initial.settings,
      companyName: "",
      companyAddress: "",
      invoiceRegistrationNo: null,
      bankAccount: {
        bankName: "",
        branchName: "",
        accountType: "",
        accountNumber: "0012345",
        accountHolder: "",
      },
    };
    const saved = await updateSettings(app, initial.revision, settings);
    expect(saved.status).toBe(200);
    const result = adminIssuerSettingsResponseSchema.parse(await saved.json());
    expect(result).toMatchObject({
      settings: { bankAccount: { accountNumber: "0012345" } },
      issuanceReady: false,
    });

    const beforeNoopAudit = await pool.query<{ count: string }>(
      "select count(*)::text as count from audit_logs where actor=$1 and action='issuer_settings.updated'",
      [adminUid],
    );
    const noOp = await updateSettings(app, result.revision, result.settings);
    expect(noOp.status).toBe(200);
    expect((await noOp.json()).revision).toBe(result.revision);
    const afterNoopAudit = await pool.query<{ count: string }>(
      "select count(*)::text as count from audit_logs where actor=$1 and action='issuer_settings.updated'",
      [adminUid],
    );
    expect(afterNoopAudit.rows[0]?.count).toBe(beforeNoopAudit.rows[0]?.count);

    const audit = await pool.query<{ detail: unknown }>(
      "select detail from audit_logs where actor=$1 and action='issuer_settings.updated'",
      [adminUid],
    );
    expect(audit.rows).toEqual([{ detail: {} }]);
    expect(JSON.stringify(audit.rows)).not.toContain("0012345");
  });

  it("rejects stale settings and lets only one concurrent writer use a revision", async () => {
    const app = makeApp();
    const current = await readSettings(app);
    const base = current.settings;
    const firstSettings = { ...base, companyName: `${testPrefix}-one` };
    const stale = await updateSettings(app, current.revision, firstSettings);
    expect(stale.status).toBe(200);

    const rejectedStale = await updateSettings(app, current.revision, {
      ...base,
      companyName: `${testPrefix}-stale`,
    });
    expect(rejectedStale.status).toBe(409);
    expect(await rejectedStale.json()).toEqual({
      error: { code: "settings_revision_conflict" },
    });

    const afterFirst = await readSettings(app);
    const blocker = await pool.connect();
    await blocker.query("begin");
    await blocker.query("select pg_advisory_xact_lock(902771, 1)");
    const candidatesPending = [
      updateSettings(app, afterFirst.revision, {
        ...afterFirst.settings,
        companyName: `${testPrefix}-race-a`,
      }),
      updateSettings(app, afterFirst.revision, {
        ...afterFirst.settings,
        companyName: `${testPrefix}-race-b`,
      }),
    ];
    try {
      await waitForAdvisoryWaiters(2);
    } finally {
      await blocker.query("rollback");
      blocker.release();
    }
    const candidates = await Promise.all(candidatesPending);
    expect(candidates.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
  });

  it("rolls settings back when the required audit insert fails", async () => {
    const app = makeApp();
    const current = await readSettings(app);
    const constraint = `reject_issuer_audit_${randomUUID().replaceAll("-", "")}`;
    await pool.query(
      `alter table audit_logs add constraint ${constraint}
       check (action <> 'issuer_settings.updated') not valid`,
    );
    try {
      const failed = await updateSettings(app, current.revision, {
        ...current.settings,
        companyName: `${testPrefix}-must-rollback`,
      });
      expect(failed.status).toBe(500);
      const after = await readSettings(app);
      expect(after).toEqual(current);
    } finally {
      await pool.query(`alter table audit_logs drop constraint ${constraint}`);
    }
  });
});
