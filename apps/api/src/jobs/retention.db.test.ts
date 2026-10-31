import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { runRetentionPurge } from "./retention.js";

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const prefix = `retention-${randomUUID()}`;
const cleanup: Array<() => Promise<void>> = [];

async function makeCase(status: "ended" | "active" = "ended") {
  const suffix = randomUUID();
  const plan = await pool.query<{ id: string }>(
    "select id from plans where code='light' order by valid_from desc limit 1",
  );
  const planId = plan.rows[0]?.id;
  if (!planId) throw new Error("Retention fixture plan missing");
  const customer = await pool.query<{ id: string }>(
    `insert into customers(shop_name,contact_name,billing_name,billing_address,email,phone,line_display_name,line_user_id,deletion_due_on)
     values($1,'顧客氏名','請求先氏名','請求先住所',$2,'090-0000-0000','LINE表示名',$3,'2026-11-01') returning id`,
    [
      `${prefix}-${suffix}`,
      `${suffix}@example.test`,
      `${prefix}-${suffix}-line`,
    ],
  );
  const customerId = customer.rows[0]?.id;
  if (!customerId) throw new Error("Retention fixture customer missing");
  let applicationId: string | undefined;
  let contractId: string | undefined;
  let periodId: string | undefined;
  let invoiceId: string | undefined;
  let requestId: string | undefined;
  const uid = `${prefix}-${suffix}-uid`;
  cleanup.push(async () => {
    await pool.query("delete from notifications where customer_id=$1", [
      customerId,
    ]);
    await pool.query("delete from user_accounts where auth_user_id=$1", [uid]);
    if (contractId)
      await pool.query("delete from credit_entries where contract_id=$1", [
        contractId,
      ]);
    if (invoiceId) {
      await pool.query("delete from payments where invoice_id=$1", [invoiceId]);
      await pool.query("delete from invoice_lines where invoice_id=$1", [
        invoiceId,
      ]);
      await pool.query("delete from invoices where id=$1", [invoiceId]);
    }
    if (requestId) {
      await pool.query(
        "update service_requests set approved_estimate_id=null where id=$1",
        [requestId],
      );
      await pool.query("delete from estimates where request_id=$1", [
        requestId,
      ]);
      await pool.query("delete from service_requests where id=$1", [requestId]);
    }
    if (periodId)
      await pool.query("delete from billing_periods where id=$1", [periodId]);
    if (contractId)
      await pool.query("delete from contracts where id=$1", [contractId]);
    if (applicationId)
      await pool.query("delete from applications where id=$1", [applicationId]);
    await pool.query("delete from customers where id=$1", [customerId]);
  });
  const application = await pool.query<{ id: string }>(
    `insert into applications(customer_id,plan_id,payment_method,terms_version,privacy_version,disclosure_version,
       consent_business_use,consent_terms,consent_marketing,shown_terms,free_text,ip_address,user_agent)
     values($1,$2,'bank_transfer','terms-v1','privacy-v1','disclosure-v1',true,true,false,'{"price":5000}'::jsonb,
       '依頼のご要望','192.0.2.10','test-agent') returning id`,
    [customerId, planId],
  );
  applicationId = application.rows[0]?.id;
  if (!applicationId) throw new Error("Retention fixture application missing");
  const contract = await pool.query<{ id: string }>(
    `insert into contracts(customer_id,application_id,plan_id,payment_method,status,ended_at)
     values($1,$2,$3,'bank_transfer',$4,case when $4='ended' then '2025-11-01 00:00:00+00'::timestamptz else null end) returning id`,
    [customerId, applicationId, planId, status],
  );
  contractId = contract.rows[0]?.id;
  if (!contractId) throw new Error("Retention fixture contract missing");
  await pool.query(
    "insert into user_accounts(auth_user_id,customer_id,role) values($1,$2,'customer')",
    [uid, customerId],
  );
  const period = await pool.query<{ id: string }>(
    `insert into billing_periods(contract_id,seq,starts_on,ends_on,plan_id,price_excl_tax,credits)
     values($1,1,'2025-11-01','2025-11-30',$2,5000,1) returning id`,
    [contractId, planId],
  );
  periodId = period.rows[0]?.id;
  if (!periodId) throw new Error("Retention fixture period missing");
  const invoice = await pool.query<{ id: string }>(
    `insert into invoices(invoice_no,contract_id,period_id,kind,status,payment_method,issued_on,due_on,
       total_excl_tax,tax_amount,total_incl_tax,billing_name,issuer_snapshot)
     values($1,$2,$3,'monthly','paid','bank_transfer','2025-11-01','2025-11-08',5000,500,5500,'請求書の宛名スナップショット','{"issuer":"保持"}'::jsonb) returning id`,
    [
      `KS-2098-${String(Math.floor(Math.random() * 99999)).padStart(5, "0")}`,
      contractId,
      periodId,
    ],
  );
  invoiceId = invoice.rows[0]?.id;
  if (!invoiceId) throw new Error("Retention fixture invoice missing");
  await pool.query(
    `insert into invoice_lines(invoice_id,line_kind,description,quantity,unit_price_excl_tax,amount_excl_tax)
     values($1,'monthly_fee','月額',1,5000,5000)`,
    [invoiceId],
  );
  await pool.query(
    `insert into payments(invoice_id,method,amount,paid_on,confirmed_via) values($1,'bank_transfer',5500,'2025-11-01','manual')`,
    [invoiceId],
  );
  await pool.query(
    `insert into credit_entries(contract_id,period_id,kind,amount,note) values($1,$2,'grant',1,'保持')`,
    [contractId, periodId],
  );
  const request = await pool.query<{ id: string }>(
    `insert into service_requests(contract_id,received_on,summary,status,completed_on,actual_minutes,actual_credits)
     values($1,'2025-11-02','作業依頼の詳細','done','2025-11-03',60,1) returning id`,
    [contractId],
  );
  requestId = request.rows[0]?.id;
  if (!requestId) throw new Error("Retention fixture request missing");
  await pool.query(
    `insert into estimates(request_id,version,credits,due_on,work_items,done_criteria,exclusions,customer_prep)
     values($1,1,1,'2025-11-10','["作業内容"]'::jsonb,'完了条件','除外内容','準備内容')`,
    [requestId],
  );
  await pool.query(
    `insert into notifications(customer_id,kind,channel,dedupe_key,scheduled_at,payload)
     values($1,'test_pending','email',$2,now(),'{"private":"未送信"}'::jsonb),
           ($1,'test_sent','email',$3,now(),'{"private":"送信済み"}'::jsonb)`,
    [customerId, `${prefix}-${suffix}-pending`, `${prefix}-${suffix}-sent`],
  );
  await pool.query(
    "update notifications set sent_at=now() where dedupe_key=$1",
    [`${prefix}-${suffix}-sent`],
  );
  return { customerId, contractId, uid, invoiceId, requestId, status };
}

afterAll(async () => {
  const errors: unknown[] = [];
  try {
    for (const remove of cleanup.reverse()) {
      try {
        await remove();
      } catch (error) {
        errors.push(error);
      }
    }
  } finally {
    await pool.end();
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "Retention DB test cleanup failed");
  }
});

describe("retention purge with PostgreSQL", () => {
  it("supports dry-run, anonymizes only personal columns, preserves ledgers and snapshots, and is idempotent", async () => {
    const fixture = await makeCase();
    const beforeDue = await runRetentionPurge("2026-10-31", pool, {
      contractIds: [fixture.contractId],
    });
    expect(beforeDue.customers).toBe(0);
    const dryRun = await runRetentionPurge("2026-11-01", pool, {
      contractIds: [fixture.contractId],
      dryRun: true,
    });
    expect(dryRun).toMatchObject({
      customers: 1,
      serviceRequests: 1,
      estimates: 1,
      applications: 1,
      pendingNotifications: 1,
    });
    const unchanged = await pool.query<{
      shop_name: string;
      anonymized_at: string | null;
    }>("select shop_name,anonymized_at::text from customers where id=$1", [
      fixture.customerId,
    ]);
    expect(unchanged.rows[0]).toMatchObject({
      shop_name: expect.stringContaining(prefix),
      anonymized_at: null,
    });

    const purged = await runRetentionPurge("2026-11-01", pool, {
      contractIds: [fixture.contractId],
    });
    expect(purged.customers).toBe(1);
    expect(purged.authUserIds).toContain(fixture.uid);
    const retained = await pool.query<{
      shop_name: string;
      contact_name: string;
      billing_address: string;
      deleted: boolean;
      billing_name: string;
      issuer_name: string;
      total_excl_tax: number;
      tax_amount: number;
      total_incl_tax: number;
      consent_terms: boolean;
      terms_version: string;
    }>(
      `select c.shop_name,c.contact_name,c.email,c.billing_address,(c.anonymized_at is not null) deleted,
              i.billing_name,i.issuer_snapshot->>'issuer' as issuer_name,
              i.total_excl_tax,i.tax_amount,i.total_incl_tax,a.consent_terms,a.terms_version
         from customers c join contracts ct on ct.customer_id=c.id join invoices i on i.contract_id=ct.id
         join applications a on a.customer_id=c.id
        where c.id=$1`,
      [fixture.customerId],
    );
    expect(retained.rows[0]).toMatchObject({
      shop_name: "削除済み",
      contact_name: "削除済み",
      billing_address: "削除済み",
      deleted: true,
      billing_name: "請求書の宛名スナップショット",
      issuer_name: "保持",
      total_excl_tax: 5000,
      tax_amount: 500,
      total_incl_tax: 5500,
      consent_terms: true,
      terms_version: "terms-v1",
    });
    const personal = await pool.query<{
      summary: string;
      actual_minutes: number | null;
      completed_on: string | null;
      actual_credits: number | null;
      work_items: unknown;
      done_criteria: string;
      free_text: string | null;
      notifications: string;
      account_count: string;
      payment_total: string;
      credit_total: string;
    }>(
      `select r.summary,r.actual_minutes,r.completed_on::text,r.actual_credits,e.work_items,e.done_criteria,a.free_text,
        (select count(*)::text from notifications n where n.customer_id=c.id and n.sent_at is null) notifications,
        (select count(*)::text from user_accounts u where u.customer_id=c.id) account_count,
        (select sum(p.amount)::text from payments p join invoices i on i.id=p.invoice_id where i.contract_id=ct.id) payment_total,
        (select sum(ce.amount)::text from credit_entries ce where ce.contract_id=ct.id) credit_total
       from customers c join contracts ct on ct.customer_id=c.id join service_requests r on r.contract_id=ct.id
       join estimates e on e.request_id=r.id join applications a on a.customer_id=c.id where c.id=$1`,
      [fixture.customerId],
    );
    expect(personal.rows[0]).toMatchObject({
      summary: "（削除済み）",
      actual_minutes: 60,
      completed_on: "2025-11-03",
      actual_credits: 1,
      work_items: ["（削除済み）"],
      done_criteria: "（削除済み）",
      free_text: null,
      notifications: "0",
      account_count: "0",
      payment_total: "5500",
      credit_total: "1",
    });
    expect(
      (
        await runRetentionPurge("2026-11-01", pool, {
          contractIds: [fixture.contractId],
        })
      ).customers,
    ).toBe(0);
  });

  it("skips active customers even if a stale due date exists and serializes concurrent runs", async () => {
    const active = await makeCase("active");
    expect(
      (
        await runRetentionPurge("2026-11-01", pool, {
          contractIds: [active.contractId],
        })
      ).customers,
    ).toBe(0);
    const ended = await makeCase();
    const results = await Promise.all([
      runRetentionPurge("2026-11-01", pool, {
        contractIds: [ended.contractId],
      }),
      runRetentionPurge("2026-11-01", pool, {
        contractIds: [ended.contractId],
      }),
    ]);
    expect(results.reduce((sum, result) => sum + result.customers, 0)).toBe(1);
  });
});
