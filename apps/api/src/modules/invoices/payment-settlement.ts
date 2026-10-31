import { randomUUID } from "node:crypto";
import { periodFor, planCodes } from "@kobito/shared";
import type { PoolClient } from "pg";
import { schedule } from "../notifications/service.js";

export interface InitialInvoiceSettlementInput {
  invoiceId: string;
  contractId: string;
  customerId: string;
  notificationsEnabled?: boolean;
  paidOn: string;
  anchorDate: string;
  amount: number;
  paymentMethod: "card" | "bank_transfer";
  confirmedVia: "webhook" | "manual";
  confirmedBy?: string;
  komojuPaymentId?: string;
  issuerSnapshot: unknown;
  totalExclTax: number;
}

export class InvalidInitialInvoiceSnapshot extends Error {}

export async function settleInitialInvoicePayment(
  client: PoolClient,
  input: InitialInvoiceSettlementInput,
) {
  const snapshot = asObject(input.issuerSnapshot);
  const acceptedPlan = asObject(snapshot.acceptedPlan);
  const planId = acceptedPlan.planId;
  const planCode = acceptedPlan.planCode;
  const price = acceptedPlan.monthlyPriceExclTax;
  const credits = acceptedPlan.credits;
  if (
    typeof planId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(planId) ||
    typeof acceptedPlan.planName !== "string" ||
    !acceptedPlan.planName.trim() ||
    typeof planCode !== "string" ||
    !planCodes.includes(planCode as (typeof planCodes)[number]) ||
    !Number.isSafeInteger(price) ||
    price !== input.totalExclTax ||
    !Number.isSafeInteger(credits) ||
    (credits as number) <= 0
  ) {
    throw new InvalidInitialInvoiceSnapshot();
  }
  const period = periodFor(input.anchorDate, 0);
  const periodId = randomUUID();
  const paymentId = randomUUID();
  await client.query(
    `insert into billing_periods (id,contract_id,seq,starts_on,ends_on,plan_id,price_excl_tax,credits)
     values ($1,$2,1,$3,$4,$5,$6,$7)`,
    [
      periodId,
      input.contractId,
      period.startsOn,
      period.endsOn,
      planId,
      price,
      credits,
    ],
  );
  await client.query(
    `insert into payments
      (id,invoice_id,method,amount,paid_on,confirmed_via,confirmed_by,komoju_payment_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      paymentId,
      input.invoiceId,
      input.paymentMethod,
      input.amount,
      input.paidOn,
      input.confirmedVia,
      input.confirmedBy ?? null,
      input.komojuPaymentId ?? null,
    ],
  );
  await client.query(
    "update invoices set status='paid',period_id=$2 where id=$1",
    [input.invoiceId, periodId],
  );
  await client.query(
    "update contracts set status='active',anchor_date=$2 where id=$1",
    [input.contractId, input.anchorDate],
  );
  await client.query("update customers set deletion_due_on=null where id=$1", [
    input.customerId,
  ]);
  await client.query(
    `insert into credit_entries (contract_id,period_id,kind,amount,invoice_id,note)
     values ($1,$2,'grant',$3,$4,$5)`,
    [
      input.contractId,
      periodId,
      credits,
      input.invoiceId,
      "初月請求の入金確認",
    ],
  );
  if (input.notificationsEnabled !== false) {
    await schedule(client, {
      customerId: input.customerId,
      kind: "NT-02b",
      dedupeKey: `NT-02b:${input.contractId}:email`,
      scheduledAt: new Date(),
      payload: { contractId: input.contractId, invoiceId: input.invoiceId },
    });
  }
  return {
    paymentId,
    period: {
      id: periodId,
      seq: 1,
      ...period,
      priceExclTax: price as number,
      credits: credits as number,
    },
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
