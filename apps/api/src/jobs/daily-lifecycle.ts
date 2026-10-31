import { canTransitionContract, canTransitionInvoice } from "@kobito/shared";
import type { Pool } from "pg";

export interface DailyLifecycleResult {
  lapsed: number;
  skipped: number;
  failed: number;
}

interface LifecycleCandidate {
  id: string;
  status: "awaiting_payment" | "awaiting_quote_approval";
  initial_invoice_id: string | null;
  invoice_status: "issued" | "failed" | "overdue" | null;
  invoice_due_on: string | null;
  quote_id: string | null;
  quote_expires_on: string | null;
}

function assertTokyoDate(today: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today))
    throw new RangeError("today must be a Tokyo calendar date");
  const parsed = new Date(`${today}T00:00:00Z`);
  if (
    Number.isNaN(parsed.valueOf()) ||
    parsed.toISOString().slice(0, 10) !== today
  )
    throw new RangeError("today must be a valid calendar date");
}

export class DailyLifecycleJob {
  constructor(private readonly pool: Pool) {}

  /** Expire unpaid applications and unapproved custom plan quotes. */
  async runDailyLifecycle(
    today: string,
    options: { contractIds?: string[] } = {},
  ): Promise<DailyLifecycleResult> {
    assertTokyoDate(today);
    const candidates = await this.pool.query<{ id: string }>(
      `select c.id from contracts c
        where c.status in ('awaiting_payment','awaiting_quote_approval')
          and ($2::uuid[] is null or c.id = any($2::uuid[]))
          and ((c.status='awaiting_payment' and exists (
                 select 1 from invoices i where i.contract_id=c.id and i.kind='initial'
                   and i.status in ('issued','failed') and i.due_on < $1::date
                   and not exists (select 1 from invoices newer where newer.contract_id=i.contract_id
                     and newer.kind='initial' and newer.status<>'void'
                     and newer.created_at > i.created_at)))
            or (c.status='awaiting_quote_approval' and exists (
                 select 1 from plan_quotes q where q.contract_id=c.id and q.sent_at is not null
                   and q.approved_at is null and q.superseded_at is null and q.expires_on < $1::date)))
        order by c.id`,
      [today, options.contractIds ?? null],
    );
    const result: DailyLifecycleResult = { lapsed: 0, skipped: 0, failed: 0 };
    for (const candidate of candidates.rows) {
      const client = await this.pool.connect();
      try {
        await client.query("begin");
        const locked = await client.query<LifecycleCandidate>(
          `select c.id,c.status,i.id initial_invoice_id,i.status invoice_status,i.due_on::text invoice_due_on,
                  q.id quote_id,q.expires_on::text quote_expires_on
             from contracts c
             left join lateral (select id,status,due_on from invoices where contract_id=c.id and kind='initial'
                                  and status<>'void' order by created_at desc limit 1) i on true
             left join lateral (select id,expires_on from plan_quotes where contract_id=c.id and sent_at is not null
                                  and approved_at is null and superseded_at is null order by version desc limit 1) q on true
            where c.id=$1 for update of c`,
          [candidate.id],
        );
        const row = locked.rows[0];
        if (!row) {
          await client.query("rollback");
          result.skipped++;
          continue;
        }
        const invoiceExpired =
          row.status === "awaiting_payment" &&
          row.initial_invoice_id !== null &&
          row.invoice_due_on !== null &&
          row.invoice_due_on < today &&
          (row.invoice_status === "issued" || row.invoice_status === "failed");
        const quoteExpired =
          row.status === "awaiting_quote_approval" &&
          row.quote_id !== null &&
          row.quote_expires_on !== null &&
          row.quote_expires_on < today;
        if (
          (!invoiceExpired && !quoteExpired) ||
          !canTransitionContract(row.status, "lapsed")
        ) {
          await client.query("rollback");
          result.skipped++;
          continue;
        }
        if (
          invoiceExpired &&
          row.invoice_status === "issued" &&
          canTransitionInvoice("issued", "overdue")
        ) {
          await client.query(
            "update invoices set status='overdue' where id=$1 and status='issued'",
            [row.initial_invoice_id],
          );
        }
        const changed = await client.query(
          "update contracts set status='lapsed' where id=$1 and status=$2",
          [row.id, row.status],
        );
        if (changed.rowCount !== 1) {
          await client.query("rollback");
          result.skipped++;
          continue;
        }
        await client.query("commit");
        result.lapsed++;
      } catch (error) {
        console.error(
          "daily lifecycle failed for a contract",
          candidate.id,
          error instanceof Error ? error.name : "UnknownError",
        );
        await client.query("rollback");
        result.failed++;
      } finally {
        client.release();
      }
    }
    return result;
  }
}

export function runDailyLifecycle(
  today: string,
  pool: Pool,
  options: { contractIds?: string[] } = {},
) {
  return new DailyLifecycleJob(pool).runDailyLifecycle(today, options);
}
