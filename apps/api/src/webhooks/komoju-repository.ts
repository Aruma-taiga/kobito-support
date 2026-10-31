import { createHash } from "node:crypto";
import { canTransitionInvoice, planCodes } from "@kobito/shared";
import type { Pool, PoolClient } from "pg";
import { settleInitialInvoicePayment } from "../modules/invoices/payment-settlement.js";
import { schedule } from "../modules/notifications/service.js";
import type {
  KomojuEventProcessorRepository,
  KomojuInbox,
  KomojuInboxEvent,
  KomojuInboxResult,
} from "./komoju-contracts.js";
import {
  invoiceNumberFromExternalOrderNum,
  parseKomojuInboxEvent,
} from "./komoju-validation.js";

export class KomojuInboxRepository
  implements KomojuInbox, KomojuEventProcessorRepository
{
  constructor(
    private readonly pool: Pool,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async receive(event: KomojuInboxEvent): Promise<KomojuInboxResult> {
    const payload = parseKomojuInboxEvent(event);
    if (!payload) throw new Error("Invalid KOMOJU inbox event");
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const inserted = await client.query(
        `insert into komoju_events (id, type, payload, fingerprint)
         values ($1, $2, $3::jsonb, $4) on conflict (id) do nothing returning id`,
        [event.id, event.type, JSON.stringify(payload), fingerprint],
      );
      const existing = await client.query<{
        fingerprint: string;
        collision_count: number;
      }>(
        "select fingerprint, collision_count from komoju_events where id = $1 for update",
        [event.id],
      );
      const row = existing.rows[0];
      if (!row) throw new Error("KOMOJU inbox insert was not available");
      if (row.fingerprint !== fingerprint) {
        await client.query(
          `update komoju_events set collision_detected_at = coalesce(collision_detected_at, now()),
             collision_count = collision_count + 1 where id = $1`,
          [event.id],
        );
        await client.query("commit");
        return "collision";
      }
      await client.query("commit");
      if (row.collision_count > 0) return "collision";
      return inserted.rowCount ? "accepted" : "duplicate";
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async listUnprocessed(limit: number): Promise<string[]> {
    const result = await this.pool.query<{ id: string }>(
      `select id from komoju_events where processed_at is null
       order by received_at, id limit $1`,
      [limit],
    );
    return result.rows.map((row) => row.id);
  }

  async recordProcessingFailure(eventId: string, code: string): Promise<void> {
    await this.pool.query(
      `update komoju_events set error=$2 where id=$1 and processed_at is null`,
      [eventId, `failed:${safeReasonCode(code)}`],
    );
  }

  async processEvent(eventId: string): Promise<"processed" | "review"> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const eventResult = await client.query<{
        type: string;
        payload: unknown;
        processed_at: Date | null;
        collision_count: number;
      }>(
        `select type,payload,processed_at,collision_count from komoju_events
         where id=$1 for update`,
        [eventId],
      );
      const stored = eventResult.rows[0];
      if (!stored || stored.processed_at) {
        await client.query("commit");
        return "processed";
      }
      if (stored.collision_count > 0) {
        await markEvent(client, eventId, "review:event_collision");
        await client.query("commit");
        return "review";
      }
      const event = parseKomojuInboxEvent(stored.payload);
      if (!event || event.id !== eventId || event.type !== stored.type) {
        await markEvent(client, eventId, "review:invalid_stored_event");
        await client.query("commit");
        return "review";
      }
      const isCaptured = ["payment.captured", "subscription.captured"].includes(
        event.type,
      );
      const isFailure = [
        "payment.failed",
        "payment.expired",
        "payment.cancelled",
        "subscription.failed",
      ].includes(event.type);
      if (!isCaptured && !isFailure) {
        await markEvent(client, eventId, "review:unsupported_event");
        await client.query("commit");
        return "review";
      }
      const externalOrderNum = event.data.external_order_num;
      const invoiceNo = externalOrderNum
        ? invoiceNumberFromExternalOrderNum(externalOrderNum)
        : undefined;
      if (!invoiceNo) {
        await markEvent(client, eventId, "review:missing_invoice_reference");
        await client.query("commit");
        return "review";
      }
      const reference = await client.query<{ contract_id: string }>(
        "select contract_id from invoices where invoice_no=$1",
        [invoiceNo],
      );
      const contractId = reference.rows[0]?.contract_id;
      if (!contractId) {
        await markEvent(client, eventId, "review:invoice_not_found");
        await client.query("commit");
        return "review";
      }
      await client.query("select id from contracts where id=$1 for update", [
        contractId,
      ]);
      const invoiceResult = await client.query<{
        id: string;
        contract_id: string;
        customer_id: string;
        contract_status: string;
        anchor_date: string | null;
        status: string;
        payment_method: string;
        kind: string;
        period_id: string | null;
        total_incl_tax: number;
        total_excl_tax: number;
        issuer_snapshot: unknown;
      }>(
        `select i.id,i.contract_id,c.customer_id,c.status as contract_status,c.anchor_date::text as anchor_date,
                i.status,i.payment_method,i.kind,i.period_id,i.total_incl_tax,i.total_excl_tax,i.issuer_snapshot
         from invoices i join contracts c on c.id=i.contract_id
         where i.invoice_no=$1 for update of i`,
        [invoiceNo],
      );
      const invoice = invoiceResult.rows[0];
      if (!invoice || invoice.contract_id !== contractId) {
        await markEvent(client, eventId, "review:invoice_not_found");
        await client.query("commit");
        return "review";
      }
      if (isFailure) {
        if (invoice.payment_method !== "card") {
          await markEvent(client, eventId, "review:payment_method_conflict");
          await client.query("commit");
          return "review";
        }
        if (invoice.status === "failed") {
          await markEvent(client, eventId, `failure:${event.type}`);
          await client.query("commit");
          return "processed";
        }
        if (
          !canTransitionInvoice(
            invoice.status as "issued" | "failed" | "overdue" | "paid" | "void",
            "failed",
          )
        ) {
          await markEvent(client, eventId, "review:invoice_state_conflict");
        } else {
          await client.query(
            "update invoices set status='failed' where id=$1",
            [invoice.id],
          );
          for (const [label, days] of [
            ["day1", 1],
            ["day3", 3],
          ] as const) {
            await schedule(client, {
              customerId: invoice.customer_id,
              kind: "NT-05",
              dedupeKey: `NT-05:${invoice.id}:${label}:email`,
              scheduledAt: tokyoMorningAfter(this.clock(), days),
              payload: { invoiceId: invoice.id },
            });
          }
          await markEvent(client, eventId, `failure:${event.type}`);
        }
        await client.query("commit");
        return invoice.status === "issued" || invoice.status === "failed"
          ? "processed"
          : "review";
      }
      const paymentId = event.data.id;
      if (
        !paymentId ||
        event.data.status !== "captured" ||
        event.data.currency !== "JPY" ||
        !event.data.captured_at ||
        !Number.isSafeInteger(event.data.total)
      ) {
        await markEvent(client, eventId, "review:invalid_payment_data");
        await client.query("commit");
        return "review";
      }
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [
        paymentId,
      ]);
      const priorByProviderId = await client.query<{ invoice_id: string }>(
        "select invoice_id from payments where komoju_payment_id=$1",
        [paymentId],
      );
      if (priorByProviderId.rows[0]) {
        const result =
          priorByProviderId.rows[0].invoice_id === invoice.id &&
          invoice.status === "paid"
            ? "processed"
            : "review";
        await markEvent(
          client,
          eventId,
          result === "processed" ? null : "review:payment_id_conflict",
        );
        await client.query("commit");
        return result;
      }
      if (objectValue(invoice.issuer_snapshot).preview === true) {
        await markEvent(client, eventId, "review:preview_invoice");
        await client.query("commit");
        return "review";
      }
      const priorForInvoice = await client.query(
        "select id from payments where invoice_id=$1 limit 1",
        [invoice.id],
      );
      if (
        invoice.payment_method !== "card" ||
        event.data.total !== invoice.total_incl_tax ||
        priorForInvoice.rowCount ||
        !canTransitionInvoice(
          invoice.status as "issued" | "failed" | "overdue" | "paid" | "void",
          "paid",
        )
      ) {
        await markEvent(
          client,
          eventId,
          event.data.total !== invoice.total_incl_tax
            ? "review:amount_mismatch"
            : "review:invoice_state_conflict",
        );
        await client.query("commit");
        return "review";
      }
      const paidOn = todayInTokyo(new Date(event.data.captured_at));
      let periodId = invoice.period_id;
      let credits: number;
      if (invoice.kind === "initial") {
        const accepted = objectValue(invoice.issuer_snapshot).acceptedPlan;
        const acceptedPlan = objectValue(accepted);
        const price = acceptedPlan.monthlyPriceExclTax;
        const planCredits = acceptedPlan.credits;
        const planId = acceptedPlan.planId;
        const planCode = acceptedPlan.planCode;
        if (
          invoice.contract_status !== "awaiting_payment" ||
          invoice.anchor_date ||
          typeof planId !== "string" ||
          typeof acceptedPlan.planName !== "string" ||
          !acceptedPlan.planName.trim() ||
          typeof planCode !== "string" ||
          !planCodes.includes(planCode as (typeof planCodes)[number]) ||
          !Number.isSafeInteger(price) ||
          price !== invoice.total_excl_tax ||
          !Number.isSafeInteger(planCredits) ||
          (planCredits as number) < 1
        ) {
          await markEvent(
            client,
            eventId,
            "review:initial_invoice_snapshot_invalid",
          );
          await client.query("commit");
          return "review";
        }
        credits = planCredits as number;
        const settlement = await settleInitialInvoicePayment(client, {
          invoiceId: invoice.id,
          contractId: invoice.contract_id,
          customerId: invoice.customer_id,
          paidOn,
          anchorDate: paidOn,
          amount: event.data.total,
          paymentMethod: "card",
          confirmedVia: "webhook",
          komojuPaymentId: paymentId,
          issuerSnapshot: invoice.issuer_snapshot,
          totalExclTax: invoice.total_excl_tax,
        });
        periodId = settlement.period.id;
        await markEvent(client, eventId, null);
        await client.query("commit");
        return "processed";
      } else {
        if (invoice.kind !== "monthly") {
          await markEvent(client, eventId, "review:unsupported_invoice_kind");
          await client.query("commit");
          return "review";
        }
        if (
          !periodId ||
          !["active", "cancel_scheduled", "ended"].includes(
            invoice.contract_status,
          )
        ) {
          await markEvent(client, eventId, "review:billing_period_not_found");
          await client.query("commit");
          return "review";
        }
        const periodResult = await client.query<{ credits: number }>(
          "select credits from billing_periods where id=$1 and contract_id=$2 for update",
          [periodId, invoice.contract_id],
        );
        const period = periodResult.rows[0];
        if (!period) {
          await markEvent(client, eventId, "review:billing_period_not_found");
          await client.query("commit");
          return "review";
        }
        credits = period.credits;
      }
      await client.query(
        `insert into payments (invoice_id,method,amount,paid_on,confirmed_via,komoju_payment_id)
         values ($1,'card',$2,$3,'webhook',$4)`,
        [invoice.id, event.data.total, paidOn, paymentId],
      );
      await client.query(
        "update invoices set status='paid',period_id=$2 where id=$1",
        [invoice.id, periodId],
      );
      await client.query(
        `insert into credit_entries (contract_id,period_id,kind,amount,invoice_id,note)
         values ($1,$2,'grant',$3,$4,'KOMOJU決済確認') on conflict (period_id) where kind='grant' do nothing`,
        [invoice.contract_id, periodId, credits, invoice.id],
      );
      if (invoice.kind === "monthly") {
        await schedule(client, {
          customerId: invoice.customer_id,
          kind: "NT-04",
          dedupeKey: `NT-04:${periodId}:email`,
          scheduledAt: this.clock(),
          payload: {
            contractId: invoice.contract_id,
            periodId,
            invoiceId: invoice.id,
          },
        });
      }
      await markEvent(client, eventId, null);
      await client.query("commit");
      return "processed";
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}

function tokyoMorningAfter(now: Date, daysAfter: number): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value;
  const date = new Date(
    Date.UTC(
      Number(part("year")),
      Number(part("month")) - 1,
      Number(part("day")) + daysAfter,
      0,
    ),
  );
  return date;
}

async function markEvent(
  client: PoolClient,
  eventId: string,
  error: string | null,
) {
  await client.query(
    "update komoju_events set processed_at=now(),error=$2 where id=$1",
    [eventId, error],
  );
}

function safeReasonCode(code: string): string {
  return /^[a-z0-9_.-]{1,64}$/.test(code) ? code : "processing_failed";
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function todayInTokyo(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (!year || !month || !day)
    throw new Error("Unable to resolve payment date");
  return `${year}-${month}-${day}`;
}
