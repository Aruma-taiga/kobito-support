import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { KomojuEventProcessor } from "./komoju-processor.js";
import { KomojuInboxRepository } from "./komoju-repository.js";

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const repository = new KomojuInboxRepository(pool);
const processor = new KomojuEventProcessor(repository);

const customerIds: string[] = [];
const planIds: string[] = [];
const applicationIds: string[] = [];
const contractIds: string[] = [];
const invoiceIds: string[] = [];
const eventIds = new Set<string>();

function newEventId(): string {
  const id = `evt_${randomUUID().replaceAll("-", "")}`;
  eventIds.add(id);
  return id;
}

beforeAll(async () => {
  // Remove fixtures left by an interrupted earlier run of this test.
  await pool.query(`delete from komoju_events where payload->'data'->>'external_order_num' in
    (select i.invoice_no from invoices i join contracts c on c.id=i.contract_id
     join plans p on p.id=c.plan_id where p.code like 'kmj-%')`);
  await pool.query(`delete from komoju_events
    where payload->'data'->>'external_order_num' like 'KS-TEST-NOT-FOUND-%'`);
  await pool.query(`delete from credit_entries where contract_id in
    (select c.id from contracts c join plans p on p.id=c.plan_id where p.code like 'kmj-%')`);
  await pool.query(`delete from payments where invoice_id in
    (select i.id from invoices i join contracts c on c.id=i.contract_id
     join plans p on p.id=c.plan_id where p.code like 'kmj-%')`);
  await pool.query(`delete from invoices where contract_id in
    (select c.id from contracts c join plans p on p.id=c.plan_id where p.code like 'kmj-%')`);
  await pool.query(`delete from billing_periods where contract_id in
    (select c.id from contracts c join plans p on p.id=c.plan_id where p.code like 'kmj-%')`);
  await pool.query(`delete from contracts where plan_id in
    (select id from plans where code like 'kmj-%')`);
  await pool.query(`delete from applications where plan_id in
    (select id from plans where code like 'kmj-%')`);
  await pool.query("delete from plans where code like 'kmj-%'");
  await pool.query(`delete from customers where shop_name like 'Komoju %'
    and not exists (select 1 from applications a where a.customer_id=customers.id)
    and not exists (select 1 from contracts c where c.customer_id=customers.id)`);
});

afterAll(async () => {
  try {
    await pool.query("delete from komoju_events where id=any($1::text[])", [
      [...eventIds],
    ]);
    await pool.query(
      "delete from credit_entries where contract_id=any($1::uuid[])",
      [contractIds],
    );
    await pool.query("delete from payments where invoice_id=any($1::uuid[])", [
      invoiceIds,
    ]);
    await pool.query("delete from invoices where id=any($1::uuid[])", [
      invoiceIds,
    ]);
    await pool.query(
      "delete from billing_periods where contract_id=any($1::uuid[])",
      [contractIds],
    );
    await pool.query("delete from contracts where id=any($1::uuid[])", [
      contractIds,
    ]);
    await pool.query("delete from applications where id=any($1::uuid[])", [
      applicationIds,
    ]);
    await pool.query("delete from plans where id=any($1::uuid[])", [planIds]);
    await pool.query("delete from customers where id=any($1::uuid[])", [
      customerIds,
    ]);
  } finally {
    await pool.end();
  }
});

interface Fixture {
  customerId: string;
  planId: string;
  applicationId: string;
  contractId: string;
  invoiceId: string;
  invoiceNo: string;
}

async function createInvoice(
  status: "awaiting_payment" | "active" = "awaiting_payment",
  paymentMethod: "card" | "bank_transfer" = "card",
): Promise<Fixture> {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const customer = await pool.query<{ id: string }>(
    `insert into customers (shop_name,contact_name,billing_name,billing_address,email)
     values ($1,'Webhook contact','Webhook billing','Address',$2) returning id`,
    [`Komoju ${suffix}`, `${suffix}@example.test`],
  );
  const customerId = customer.rows[0]?.id;
  if (!customerId) throw new Error("KOMOJU test customer insert failed");
  customerIds.push(customerId);
  const plan = await pool.query<{ id: string }>(
    `insert into plans (code,name,price_excl_tax,credits,is_custom,valid_from,valid_to)
     values ($1,'Accepted plan',5000,3,false,'2026-01-01','2026-10-31') returning id`,
    [`kmj-${suffix}`],
  );
  const planId = plan.rows[0]?.id;
  if (!planId) throw new Error("KOMOJU test plan insert failed");
  planIds.push(planId);
  const application = await pool.query<{ id: string }>(
    `insert into applications (customer_id,plan_id,payment_method,terms_version,privacy_version,disclosure_version,
      consent_business_use,consent_terms,consent_marketing,shown_terms)
     values ($1,$2,$3,'v1','v1','v1',true,true,false,'{}') returning id`,
    [customerId, planId, paymentMethod],
  );
  const applicationId = application.rows[0]?.id;
  if (!applicationId) throw new Error("KOMOJU test application insert failed");
  applicationIds.push(applicationId);
  const contract = await pool.query<{ id: string }>(
    `insert into contracts (customer_id,application_id,plan_id,payment_method,status,anchor_date)
     values ($1,$2,$3,$4,$5,$6) returning id`,
    [
      customerId,
      applicationId,
      planId,
      paymentMethod,
      status,
      status === "active" ? "2026-10-01" : null,
    ],
  );
  const contractId = contract.rows[0]?.id;
  if (!contractId) throw new Error("KOMOJU test contract insert failed");
  contractIds.push(contractId);
  let periodId: string | null = null;
  if (status === "active") {
    const period = await pool.query<{ id: string }>(
      `insert into billing_periods (contract_id,seq,starts_on,ends_on,plan_id,price_excl_tax,credits)
       values ($1,2,'2026-11-01','2026-11-30',$2,5000,3) returning id`,
      [contractId, planId],
    );
    const insertedPeriodId = period.rows[0]?.id;
    if (!insertedPeriodId)
      throw new Error("KOMOJU test billing period insert failed");
    periodId = insertedPeriodId;
  }
  const invoiceNumberSuffix = (
    BigInt(`0x${randomUUID().replaceAll("-", "")}`) % 10_000_000_000n
  )
    .toString()
    .padStart(10, "0");
  const invoiceNo = `KS-2026-${invoiceNumberSuffix}`;
  const invoice = await pool.query<{ id: string }>(
    `insert into invoices (invoice_no,contract_id,period_id,kind,status,payment_method,issued_on,due_on,
      total_excl_tax,tax_amount,total_incl_tax,billing_name,issuer_snapshot)
     values ($1,$2,$3,$4,'issued',$5,'2026-11-01','2026-11-08',5000,500,5500,'Billing snapshot',$6::jsonb)
     returning id`,
    [
      invoiceNo,
      contractId,
      periodId,
      status === "active" ? "monthly" : "initial",
      paymentMethod,
      JSON.stringify({
        preview: false,
        acceptedPlan: {
          planId,
          planCode: "light",
          planName: "ライト",
          monthlyPriceExclTax: 5000,
          credits: 3,
        },
      }),
    ],
  );
  const invoiceId = invoice.rows[0]?.id;
  if (!invoiceId) throw new Error("KOMOJU test invoice insert failed");
  invoiceIds.push(invoiceId);
  return {
    customerId,
    planId,
    applicationId,
    contractId,
    invoiceId,
    invoiceNo,
  };
}

async function cleanup(fixture: Fixture, eventIds: string[]) {
  await pool.query("delete from komoju_events where id=any($1::text[])", [
    eventIds,
  ]);
  await pool.query("delete from credit_entries where contract_id=$1", [
    fixture.contractId,
  ]);
  await pool.query("delete from payments where invoice_id=$1", [
    fixture.invoiceId,
  ]);
  await pool.query("delete from invoices where id=$1", [fixture.invoiceId]);
  await pool.query("delete from billing_periods where contract_id=$1", [
    fixture.contractId,
  ]);
  await pool.query("delete from contracts where id=$1", [fixture.contractId]);
  await pool.query("delete from applications where id=$1", [
    fixture.applicationId,
  ]);
  await pool.query("delete from plans where id=$1", [fixture.planId]);
  await pool.query("delete from customers where id=$1", [fixture.customerId]);
}

function capturedEvent(id: string, invoiceNo: string, paymentId: string) {
  return {
    id,
    type: "payment.captured",
    data: {
      id: paymentId,
      status: "captured",
      amount: 5000,
      tax: 500,
      total: 5500,
      captured_at: "2026-11-01T15:00:00.000Z",
      currency: "JPY",
      external_order_num: invoiceNo,
    },
  };
}

describe("KOMOJU event processing database behavior", () => {
  it("settles an initial invoice from the accepted snapshot and ignores duplicate event/payment delivery", async () => {
    const fixture = await createInvoice();
    const eventId = newEventId();
    const repeatedEventId = newEventId();
    const paymentId = `pay_test_${randomUUID().replaceAll("-", "")}`;
    try {
      await repository.receive(
        capturedEvent(eventId, fixture.invoiceNo, paymentId),
      );
      await expect(processor.processPending()).resolves.toEqual({
        processed: 1,
        review: 0,
        failed: 0,
      });
      await expect(repository.processEvent(eventId)).resolves.toBe("processed");
      await repository.receive(
        capturedEvent(repeatedEventId, fixture.invoiceNo, paymentId),
      );
      await expect(processor.processPending()).resolves.toEqual({
        processed: 1,
        review: 0,
        failed: 0,
      });
      const state = await pool.query<{
        contract_status: string;
        anchor_date: string;
        invoice_status: string;
        payment_count: string;
        grant_count: string;
        starts_on: string;
        ends_on: string;
        paid_on: string;
      }>(
        `select c.status contract_status,c.anchor_date::text anchor_date,i.status invoice_status,
          (select count(*)::text from payments where invoice_id=i.id) payment_count,
          (select count(*)::text from credit_entries where invoice_id=i.id and kind='grant') grant_count,
          bp.starts_on::text,bp.ends_on::text,p.paid_on::text
         from invoices i join contracts c on c.id=i.contract_id
         join billing_periods bp on bp.id=i.period_id join payments p on p.invoice_id=i.id
         where i.id=$1`,
        [fixture.invoiceId],
      );
      expect(state.rows[0]).toEqual({
        contract_status: "active",
        anchor_date: "2026-11-02",
        invoice_status: "paid",
        payment_count: "1",
        grant_count: "1",
        starts_on: "2026-11-02",
        ends_on: "2026-12-01",
        paid_on: "2026-11-02",
      });
    } finally {
      await cleanup(fixture, [eventId, repeatedEventId]);
    }
  });

  it("marks amount mismatches and unknown invoices for review without changing a customer invoice", async () => {
    const fixture = await createInvoice();
    const other = await createInvoice();
    const mismatchId = newEventId();
    const unknownId = newEventId();
    try {
      const mismatch = capturedEvent(
        mismatchId,
        fixture.invoiceNo,
        "pay_mismatch",
      );
      mismatch.data.total = 5501;
      await repository.receive(mismatch);
      await repository.receive(
        capturedEvent(
          unknownId,
          `KS-NOTFOUND-2026-${(BigInt(`0x${randomUUID().replaceAll("-", "")}`) % 10_000_000_000n).toString().padStart(10, "0")}`,
          `pay_test_${randomUUID().replaceAll("-", "")}`,
        ),
      );
      await expect(processor.processPending()).resolves.toEqual({
        processed: 0,
        review: 2,
        failed: 0,
      });
      const states = await pool.query<{ id: string; status: string }>(
        "select id,status from invoices where id=any($1::uuid[]) order by id",
        [[fixture.invoiceId, other.invoiceId]],
      );
      expect(
        new Map(states.rows.map(({ id, status }) => [id, status])),
      ).toEqual(
        new Map([
          [fixture.invoiceId, "issued"],
          [other.invoiceId, "issued"],
        ]),
      );
      const events = await pool.query<{
        error: string;
        processed_at: Date | null;
      }>(
        "select error,processed_at from komoju_events where id=any($1::text[]) order by id",
        [[mismatchId, unknownId]],
      );
      expect(events.rows).toHaveLength(2);
      expect(
        events.rows.every(
          (row) => row.processed_at && row.error?.startsWith("review:"),
        ),
      ).toBe(true);
      expect(events.rows.map((row) => row.error)).toContain(
        "review:amount_mismatch",
      );
      expect(events.rows.map((row) => row.error)).toContain(
        "review:invoice_not_found",
      );
    } finally {
      await cleanup(fixture, [mismatchId, unknownId]);
      await cleanup(other, []);
    }
  });

  it.each([
    "payment.failed",
    "payment.expired",
    "payment.cancelled",
  ] as const)("marks %s invoice as failed with only the provider reason code", async (type) => {
    const fixture = await createInvoice();
    const eventId = newEventId();
    try {
      await repository.receive({
        id: eventId,
        type,
        data: {
          id: "pay_failed",
          status:
            type === "payment.expired"
              ? "expired"
              : type === "payment.cancelled"
                ? "cancelled"
                : "failed",
          currency: "JPY",
          external_order_num: fixture.invoiceNo,
        },
      });
      await expect(processor.processPending()).resolves.toEqual({
        processed: 1,
        review: 0,
        failed: 0,
      });
      const result = await pool.query<{
        status: string;
        error: string | null;
        payment_count: string;
      }>(
        `select i.status,e.error,(select count(*)::text from payments where invoice_id=i.id) payment_count
         from invoices i join komoju_events e on e.id=$2 where i.id=$1`,
        [fixture.invoiceId, eventId],
      );
      expect(result.rows[0]).toEqual({
        status: "failed",
        error: `failure:${type}`,
        payment_count: "0",
      });
    } finally {
      await cleanup(fixture, [eventId]);
    }
  });

  it("does not let a failure webhook change a bank-transfer invoice", async () => {
    const fixture = await createInvoice("awaiting_payment", "bank_transfer");
    const eventId = newEventId();
    try {
      await repository.receive({
        id: eventId,
        type: "payment.failed",
        data: {
          id: "pay_wrong_method",
          status: "failed",
          currency: "JPY",
          external_order_num: fixture.invoiceNo,
        },
      });
      await expect(processor.processPending()).resolves.toEqual({
        processed: 0,
        review: 1,
        failed: 0,
      });
      const result = await pool.query<{ status: string; error: string | null }>(
        `select i.status,e.error from invoices i join komoju_events e on e.id=$2 where i.id=$1`,
        [fixture.invoiceId, eventId],
      );
      expect(result.rows[0]).toEqual({
        status: "issued",
        error: "review:payment_method_conflict",
      });
    } finally {
      await cleanup(fixture, [eventId]);
    }
  });

  it("serializes simultaneous deliveries for one invoice and only grants a monthly period once", async () => {
    const fixture = await createInvoice("active");
    const eventIds = [0, 1].map(() => newEventId());
    try {
      await Promise.all(
        eventIds.map((id) =>
          repository.receive(capturedEvent(id, fixture.invoiceNo, `pay_${id}`)),
        ),
      );
      const results = await Promise.all(
        eventIds.map((id) => repository.processEvent(id)),
      );
      expect(results.filter((value) => value === "processed")).toHaveLength(1);
      expect(results.filter((value) => value === "review")).toHaveLength(1);
      const state = await pool.query<{
        payments: string;
        grants: string;
        status: string;
      }>(
        `select i.status,(select count(*)::text from payments where invoice_id=i.id) payments,
          (select count(*)::text from credit_entries where invoice_id=i.id and kind='grant') grants
         from invoices i where i.id=$1`,
        [fixture.invoiceId],
      );
      expect(state.rows[0]).toEqual({
        status: "paid",
        payments: "1",
        grants: "1",
      });
    } finally {
      await cleanup(fixture, eventIds);
    }
  });

  it("prevents one KOMOJU payment ID from settling two invoices", async () => {
    const first = await createInvoice();
    const second = await createInvoice();
    const firstEventId = newEventId();
    const secondEventId = newEventId();
    const eventIds = [firstEventId, secondEventId];
    try {
      await Promise.all([
        repository.receive(
          capturedEvent(firstEventId, first.invoiceNo, "pay_shared_id"),
        ),
        repository.receive(
          capturedEvent(secondEventId, second.invoiceNo, "pay_shared_id"),
        ),
      ]);
      const results = await Promise.all(
        eventIds.map((id) => repository.processEvent(id)),
      );
      expect(results.filter((value) => value === "processed")).toHaveLength(1);
      expect(results.filter((value) => value === "review")).toHaveLength(1);
      const paid = await pool.query<{ status: string; payments: string }>(
        `select i.status,(select count(*)::text from payments where invoice_id=i.id) payments
         from invoices i where i.id=any($1::uuid[])`,
        [[first.invoiceId, second.invoiceId]],
      );
      expect(paid.rows.filter((row) => row.status === "paid")).toHaveLength(1);
      expect(paid.rows.filter((row) => row.payments === "1")).toHaveLength(1);
    } finally {
      await cleanup(first, eventIds);
      await cleanup(second, eventIds);
    }
  });
});
