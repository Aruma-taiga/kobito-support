import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { recordPartnerReward } from "./partner-rewards.js";

const pool = new Pool({
  connectionString:
    process.env.TEST_DATABASE_URL ??
    "postgres://kobito:kobito@127.0.0.1:5432/kobito_support_test",
});
const prefix = `partner-reward-${randomUUID()}`;
const partnerIds: string[] = [];
const customerIds: string[] = [];
const planIds: string[] = [];
const applicationIds: string[] = [];
const contractIds: string[] = [];
const periodIds: string[] = [];
const invoiceIds: string[] = [];
const paymentIds: string[] = [];

async function makeContract(options: {
  price?: number;
  custom?: boolean;
  status?: "active" | "cancel_scheduled" | "ended";
  cancelRequested?: boolean;
  referral?: boolean;
  activePartner?: boolean;
  rewardType?: "appointment" | "closing";
  rewardRate?: number;
  maxMonths?: number;
}) {
  const suffix = randomUUID();
  let partnerId: string | null = null;
  if (options.referral !== false) {
    const partner = await pool.query<{ id: string }>(
      `insert into partners (name,referral_code,reward_type,reward_rate,active)
       values ($1,$2,$3,$4,$5) returning id`,
      [
        `${prefix}-${suffix}`,
        `${prefix}-${suffix}`,
        options.rewardType ?? "closing",
        options.rewardRate ?? 0.2,
        options.activePartner ?? true,
      ],
    );
    partnerId = partner.rows[0]?.id ?? null;
    if (!partnerId) throw new Error("Partner fixture insert failed");
    partnerIds.push(partnerId);
  }
  const customer = await pool.query<{ id: string }>(
    `insert into customers (shop_name,contact_name,billing_name,billing_address,email)
     values ($1,'Contact','Billing','Address',$2) returning id`,
    [`${prefix}-${suffix}`, `${suffix}@example.test`],
  );
  const customerId = customer.rows[0]?.id;
  if (!customerId) throw new Error("Customer fixture insert failed");
  customerIds.push(customerId);
  const plan = await pool.query<{ id: string }>(
    `insert into plans (code,name,price_excl_tax,credits,is_custom,valid_from,valid_to)
     values ($1,$2,$3,$4,$5,date '1900-01-01',date '1900-12-31') returning id`,
    [
      `${prefix}-${suffix}`,
      options.custom ? "個別見積り" : "テストプラン",
      options.custom ? null : (options.price ?? 5000),
      options.custom ? null : 1,
      options.custom ?? false,
    ],
  );
  const planId = plan.rows[0]?.id;
  if (!planId) throw new Error("Plan fixture insert failed");
  planIds.push(planId);
  const application = await pool.query<{ id: string }>(
    `insert into applications
       (customer_id,plan_id,payment_method,terms_version,privacy_version,disclosure_version,
        consent_business_use,consent_terms,consent_marketing,shown_terms)
     values ($1,$2,'bank_transfer','terms','privacy','disclosure',true,true,false,'{}') returning id`,
    [customerId, planId],
  );
  const applicationId = application.rows[0]?.id;
  if (!applicationId) throw new Error("Application fixture insert failed");
  applicationIds.push(applicationId);
  const contract = await pool.query<{ id: string }>(
    `insert into contracts
       (customer_id,application_id,plan_id,payment_method,status,cancel_requested_at)
     values ($1,$2,$3,'bank_transfer',$4,$5) returning id`,
    [
      customerId,
      applicationId,
      planId,
      options.status ?? "active",
      options.cancelRequested ? new Date("2026-11-01T00:00:00Z") : null,
    ],
  );
  const contractId = contract.rows[0]?.id;
  if (!contractId) throw new Error("Contract fixture insert failed");
  contractIds.push(contractId);
  if (partnerId) {
    await pool.query(
      `insert into referrals (partner_id,contract_id,reward_type,reward_rate,max_months)
       values ($1,$2,$3,$4,$5)`,
      [
        partnerId,
        contractId,
        options.rewardType ?? "closing",
        options.rewardRate ?? 0.2,
        options.maxMonths ?? 12,
      ],
    );
  }
  let quoteId: string | null = null;
  let periodPrice = options.price ?? 5000;
  if (options.custom) {
    const quote = await pool.query<{ id: string }>(
      `insert into plan_quotes (contract_id,version,price_excl_tax,credits,description,expires_on)
       values ($1,1,12345,1,'custom quote',date '2026-12-31') returning id`,
      [contractId],
    );
    quoteId = quote.rows[0]?.id ?? null;
    if (!quoteId) throw new Error("Quote fixture insert failed");
    periodPrice = 12345;
    await pool.query("update contracts set plan_quote_id=$2 where id=$1", [
      contractId,
      quoteId,
    ]);
  }
  const period = await pool.query<{ id: string }>(
    `insert into billing_periods
       (contract_id,seq,starts_on,ends_on,plan_id,price_excl_tax,credits)
     values ($1,1,date '2026-01-01',date '2026-01-31',$2,$3,1) returning id`,
    [contractId, planId, periodPrice],
  );
  const periodId = period.rows[0]?.id;
  if (!periodId) throw new Error("Billing period fixture insert failed");
  periodIds.push(periodId);
  return { contractId, periodId, periodPrice };
}

async function makePayment(
  contractId: string,
  periodId: string | null,
  kind: "initial" | "monthly" | "extra_credit" = "monthly",
) {
  const suffix = randomUUID();
  let invoicePeriodId = periodId;
  if (periodId && kind === "monthly") {
    const period = await pool.query<{ id: string }>(
      `insert into billing_periods
         (contract_id,seq,starts_on,ends_on,plan_id,price_excl_tax,credits)
       select contract_id,(select coalesce(max(seq),0)+1 from billing_periods where contract_id=$2),
              starts_on,ends_on,plan_id,price_excl_tax,credits
         from billing_periods where id=$1 returning id`,
      [periodId, contractId],
    );
    invoicePeriodId = period.rows[0]?.id ?? null;
    if (!invoicePeriodId) throw new Error("Billing period fixture copy failed");
    periodIds.push(invoicePeriodId);
  }
  const invoice = await pool.query<{ id: string }>(
    `insert into invoices
       (invoice_no,contract_id,period_id,kind,status,payment_method,issued_on,
        total_excl_tax,tax_amount,total_incl_tax,billing_name,issuer_snapshot)
     values ($1,$2,$3,$4,'paid','bank_transfer',date '2026-01-01',5000,500,5500,'Billing','{}')
     returning id`,
    [`${prefix}-${suffix}`, contractId, invoicePeriodId, kind],
  );
  const invoiceId = invoice.rows[0]?.id;
  if (!invoiceId) throw new Error("Invoice fixture insert failed");
  invoiceIds.push(invoiceId);
  const payment = await pool.query<{ id: string }>(
    `insert into payments (invoice_id,method,amount,paid_on,confirmed_via)
     values ($1,'bank_transfer',5500,date '2026-11-18','manual') returning id`,
    [invoiceId],
  );
  const paymentId = payment.rows[0]?.id;
  if (!paymentId) throw new Error("Payment fixture insert failed");
  paymentIds.push(paymentId);
  return { invoiceId, paymentId };
}

async function record(
  contractId: string,
  invoiceId: string,
  paymentId: string,
  paidOn = "2026-11-18",
) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await recordPartnerReward(client, {
      contractId,
      invoiceId,
      paymentId,
      paidOn,
    });
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function rewardsFor(contractId: string) {
  return pool.query<{
    target_month: string;
    month_index: number;
    base_amount: number;
    reward_amount: number;
    tax_amount: number;
  }>(
    `select pr.target_month::text,pr.month_index,pr.base_amount,pr.reward_amount,pr.tax_amount
       from partner_rewards pr join referrals r on r.id=pr.referral_id
      where r.contract_id=$1 order by pr.month_index`,
    [contractId],
  );
}

afterAll(async () => {
  await pool.query(
    "delete from partner_rewards where payment_id=any($1::uuid[])",
    [paymentIds],
  );
  await pool.query("delete from payments where id=any($1::uuid[])", [
    paymentIds,
  ]);
  await pool.query("delete from invoices where id=any($1::uuid[])", [
    invoiceIds,
  ]);
  await pool.query("delete from referrals where contract_id=any($1::uuid[])", [
    contractIds,
  ]);
  await pool.query("delete from billing_periods where id=any($1::uuid[])", [
    periodIds,
  ]);
  // contracts.plan_quote_id と plan_quotes.contract_id は互いに参照するので、先に契約側の参照を外す。
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
  await pool.query("delete from customers where id=any($1::uuid[])", [
    customerIds,
  ]);
  await pool.query("delete from plans where id=any($1::uuid[])", [planIds]);
  await pool.query("delete from partners where id=any($1::uuid[])", [
    partnerIds,
  ]);
  await pool.end();
});

describe("recordPartnerReward database behavior", () => {
  it("records monthly and custom quote amounts, payment month, and increasing indexes", async () => {
    const closing = await makeContract({ price: 5000 });
    const appointment = await makeContract({
      price: 10000,
      rewardType: "appointment",
      rewardRate: 0.1,
    });
    const custom = await makeContract({ custom: true });
    for (const fixture of [closing, appointment, custom]) {
      const expected =
        fixture.periodPrice === 12345
          ? [2469, 246]
          : fixture.periodPrice === 10000
            ? [1000, 100]
            : [1000, 100];
      for (let index = 0; index < 3; index += 1) {
        const { invoiceId, paymentId } = await makePayment(
          fixture.contractId,
          fixture.periodId,
          index === 0 ? "initial" : "monthly",
        );
        await record(
          fixture.contractId,
          invoiceId,
          paymentId,
          `2026-${String(index + 1).padStart(2, "0")}-18`,
        );
      }
      const rows = await rewardsFor(fixture.contractId);
      expect(rows.rows).toHaveLength(3);
      expect(
        rows.rows.map((row) => [
          row.month_index,
          row.base_amount,
          row.reward_amount,
          row.tax_amount,
        ]),
      ).toEqual([
        [1, fixture.periodPrice, expected[0], expected[1]],
        [2, fixture.periodPrice, expected[0], expected[1]],
        [3, fixture.periodPrice, expected[0], expected[1]],
      ]);
      expect(rows.rows.map((row) => row.target_month)).toEqual([
        "2026-01-01",
        "2026-02-01",
        "2026-03-01",
      ]);
    }
  });

  it("stops at max_months and skips cancellation, ended, and cancellation-requested contracts", async () => {
    const limited = await makeContract({ maxMonths: 12 });
    for (let index = 0; index < 13; index += 1) {
      const { invoiceId, paymentId } = await makePayment(
        limited.contractId,
        limited.periodId,
      );
      await record(limited.contractId, invoiceId, paymentId);
    }
    expect((await rewardsFor(limited.contractId)).rows).toHaveLength(12);
    for (const options of [
      { status: "cancel_scheduled" as const },
      { status: "ended" as const },
      { cancelRequested: true },
    ]) {
      const fixture = await makeContract(options);
      const { invoiceId, paymentId } = await makePayment(
        fixture.contractId,
        fixture.periodId,
      );
      await record(fixture.contractId, invoiceId, paymentId);
      expect((await rewardsFor(fixture.contractId)).rows).toHaveLength(0);
    }
  });

  it("skips extra-credit invoices, missing referrals, inactive partners, and preserves other referrals", async () => {
    const eligible = await makeContract({});
    const otherContract = await makeContract({});
    const noReferral = await makeContract({ referral: false });
    const inactive = await makeContract({ activePartner: false });
    const extra = await makePayment(eligible.contractId, null, "extra_credit");
    await record(eligible.contractId, extra.invoiceId, extra.paymentId);
    const noRefPayment = await makePayment(
      noReferral.contractId,
      noReferral.periodId,
    );
    await record(
      noReferral.contractId,
      noRefPayment.invoiceId,
      noRefPayment.paymentId,
    );
    const inactivePayment = await makePayment(
      inactive.contractId,
      inactive.periodId,
    );
    await record(
      inactive.contractId,
      inactivePayment.invoiceId,
      inactivePayment.paymentId,
    );
    const eligiblePayment = await makePayment(
      eligible.contractId,
      eligible.periodId,
    );
    await record(
      eligible.contractId,
      eligiblePayment.invoiceId,
      eligiblePayment.paymentId,
    );
    expect((await rewardsFor(eligible.contractId)).rows).toHaveLength(1);
    expect((await rewardsFor(otherContract.contractId)).rows).toHaveLength(0);
    expect((await rewardsFor(noReferral.contractId)).rows).toHaveLength(0);
    expect((await rewardsFor(inactive.contractId)).rows).toHaveLength(0);
  });

  it("is idempotent for a repeated payment and concurrent calls", async () => {
    const fixture = await makeContract({});
    const repeated = await makePayment(fixture.contractId, fixture.periodId);
    await record(fixture.contractId, repeated.invoiceId, repeated.paymentId);
    await record(fixture.contractId, repeated.invoiceId, repeated.paymentId);
    const concurrent = await makePayment(fixture.contractId, fixture.periodId);
    await Promise.all([
      record(fixture.contractId, concurrent.invoiceId, concurrent.paymentId),
      record(fixture.contractId, concurrent.invoiceId, concurrent.paymentId),
    ]);
    expect((await rewardsFor(fixture.contractId)).rows).toHaveLength(2);
    expect(
      (await rewardsFor(fixture.contractId)).rows.map((row) => row.month_index),
    ).toEqual([1, 2]);
  });
});
