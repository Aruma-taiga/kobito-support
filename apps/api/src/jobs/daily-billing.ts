import { creditsToExpire, periodFor, retentionDueDate } from "@kobito/shared";
import type { Pool } from "pg";
import type { InvoiceRepository } from "../modules/invoices/repository.js";
import { runDailyLifecycle } from "./daily-lifecycle.js";

export interface DailyBillingResult {
  processedContracts: number;
  createdPeriods: number;
  issuedInvoices: number;
  expiredCredits: number;
  skipped: number;
  failed: number;
}

interface BillingContract {
  id: string;
  customer_id: string;
  status: string;
  anchor_date: string;
  ends_on: string | null;
  payment_method: "card" | "bank_transfer";
  billing_name: string;
  billing_address: string;
  plan_id: string;
  plan_name: string;
  plan_code: string;
  plan_quote_id: string | null;
  price_excl_tax: number;
  credits: number;
  next_plan_id: string | null;
  last_seq: number;
  last_period_id: string;
}

export class DailyBillingJob {
  constructor(
    private readonly pool: Pool,
    private readonly invoices: InvoiceRepository,
  ) {}

  /** `options.contractIds` を渡すと、その契約だけを対象にする（特定契約の再実行・テスト用）。 */
  async runDailyBilling(
    today: string,
    options: { contractIds?: string[] } = {},
  ): Promise<DailyBillingResult> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(today))
      throw new RangeError("today must be a Tokyo calendar date");
    const parsed = new Date(`${today}T00:00:00Z`);
    if (
      Number.isNaN(parsed.valueOf()) ||
      parsed.toISOString().slice(0, 10) !== today
    )
      throw new RangeError("today must be a valid calendar date");
    const candidates = await this.pool.query<{ id: string }>(
      `select c.id from contracts c where c.status in ('active','cancel_scheduled')
       and c.anchor_date is not null and c.anchor_date::text <= $1
       and exists (select 1 from billing_periods p where p.contract_id=c.id)
       and ($2::uuid[] is null or c.id = any($2::uuid[]))
       order by c.id`,
      [today, options.contractIds ?? null],
    );
    const result: DailyBillingResult = {
      processedContracts: 0,
      createdPeriods: 0,
      issuedInvoices: 0,
      expiredCredits: 0,
      skipped: 0,
      failed: 0,
    };
    for (const candidate of candidates.rows) {
      const client = await this.pool.connect();
      const before = {
        createdPeriods: result.createdPeriods,
        issuedInvoices: result.issuedInvoices,
        expiredCredits: result.expiredCredits,
      };
      try {
        await client.query("begin");
        const locked = await client.query<BillingContract>(
          `select c.id,c.customer_id,c.status,c.anchor_date::text anchor_date,c.ends_on::text ends_on,
                  c.payment_method,c.plan_id,c.plan_quote_id,c.next_plan_id,cu.billing_name,cu.billing_address,
                  p.name plan_name,p.code plan_code,coalesce(q.price_excl_tax,p.price_excl_tax) price_excl_tax,
                  coalesce(q.credits,p.credits) credits,
                  (select max(bp.seq) from billing_periods bp where bp.contract_id=c.id) last_seq,
                  (select bp.id from billing_periods bp where bp.contract_id=c.id order by bp.seq desc limit 1) last_period_id
             from contracts c join customers cu on cu.id=c.customer_id join plans p on p.id=c.plan_id
             left join plan_quotes q on q.id=c.plan_quote_id
            where c.id=$1 for update of c`,
          [candidate.id],
        );
        const contract = locked.rows[0];
        if (
          !contract ||
          !["active", "cancel_scheduled"].includes(contract.status)
        ) {
          await client.query("rollback");
          result.skipped++;
          continue;
        }
        let changed = false;
        while (true) {
          const nextSequence = contract.last_seq + 1;
          const nextPeriod = periodFor(contract.anchor_date, nextSequence - 1);
          const periodDue = nextPeriod.startsOn <= today;
          const cancellationDue = Boolean(
            contract.ends_on &&
              today > contract.ends_on &&
              nextPeriod.startsOn > contract.ends_on,
          );
          if (!periodDue && !cancellationDue) break;
          if (contract.ends_on && nextPeriod.startsOn > contract.ends_on) {
            const oldPeriod = await client.query<{
              kind:
                | "grant"
                | "extra"
                | "reserve"
                | "release"
                | "consume"
                | "expire";
              amount: number;
            }>("select kind,amount from credit_entries where period_id=$1", [
              contract.last_period_id,
            ]);
            const amount = creditsToExpire(
              oldPeriod.rows.map((entry) => ({
                ...entry,
                periodId: contract.last_period_id,
              })),
            );
            if (amount > 0) {
              await client.query(
                `insert into credit_entries (contract_id,period_id,kind,amount,note)
                 values ($1,$2,'expire',$3,'期間終了時の残クレジット失効') on conflict (period_id) where kind='expire' and request_id is null do nothing`,
                [contract.id, contract.last_period_id, -amount],
              );
              result.expiredCredits += amount;
            }
            const ended = await client.query(
              "update contracts set status='ended',ended_at=($2::date::timestamp at time zone 'Asia/Tokyo') where id=$1 and status='cancel_scheduled' returning customer_id",
              [contract.id, today],
            );
            if (ended.rowCount === 1) {
              await client.query(
                "update customers set deletion_due_on=coalesce(deletion_due_on,$2::date) where id=$1",
                [ended.rows[0].customer_id, retentionDueDate("ended", today)],
              );
              await client.query(
                `insert into notifications(customer_id,kind,channel,dedupe_key,scheduled_at,payload)
                 values($1,'NT-09','email', $2, ($3::date::timestamp at time zone 'Asia/Tokyo'), $4::jsonb)
                 on conflict (dedupe_key) do nothing`,
                [
                  ended.rows[0].customer_id,
                  `NT-09:${contract.id}`,
                  today,
                  JSON.stringify({ contractId: contract.id }),
                ],
              );
            }
            changed = true;
            break;
          }
          const oldPeriod = await client.query<{
            kind:
              | "grant"
              | "extra"
              | "reserve"
              | "release"
              | "consume"
              | "expire";
            amount: number;
          }>("select kind,amount from credit_entries where period_id=$1", [
            contract.last_period_id,
          ]);
          const amount = creditsToExpire(
            oldPeriod.rows.map((entry) => ({
              ...entry,
              periodId: contract.last_period_id,
            })),
          );
          if (amount > 0) {
            await client.query(
              `insert into credit_entries (contract_id,period_id,kind,amount,note)
               values ($1,$2,'expire',$3,'期間終了時の残クレジット失効') on conflict (period_id) where kind='expire' and request_id is null do nothing`,
              [contract.id, contract.last_period_id, -amount],
            );
            result.expiredCredits += amount;
          }
          let planId = contract.plan_id;
          let price = contract.price_excl_tax;
          let credits = contract.credits;
          let name = contract.plan_name;
          let code = contract.plan_code;
          if (contract.plan_quote_id) {
            const quote = await client.query<{
              price_excl_tax: number;
              credits: number;
            }>(
              "select price_excl_tax,credits from plan_quotes where id=$1 and contract_id=$2",
              [contract.plan_quote_id, contract.id],
            );
            if (!quote.rows[0]) throw new Error("accepted plan quote missing");
            price = quote.rows[0].price_excl_tax;
            credits = quote.rows[0].credits;
            code = "custom";
            name = "個別見積り";
          } else if (contract.next_plan_id) {
            const nextPlan = await client.query<{
              id: string;
              name: string;
              code: string;
              price_excl_tax: number;
              credits: number;
            }>(
              "select id,name,code,price_excl_tax,credits from plans where id=$1",
              [contract.next_plan_id],
            );
            if (!nextPlan.rows[0]) throw new Error("next plan missing");
            ({
              id: planId,
              name,
              code,
              price_excl_tax: price,
              credits,
            } = nextPlan.rows[0]);
            await client.query(
              "update contracts set plan_id=$2,next_plan_id=null where id=$1",
              [contract.id, planId],
            );
            contract.next_plan_id = null;
          }
          const period = await client.query<{ id: string }>(
            `insert into billing_periods (contract_id,seq,starts_on,ends_on,plan_id,price_excl_tax,credits)
             values ($1,$2,$3,$4,$5,$6,$7) on conflict (contract_id,seq) do nothing returning id`,
            [
              contract.id,
              nextSequence,
              nextPeriod.startsOn,
              nextPeriod.endsOn,
              planId,
              price,
              credits,
            ],
          );
          if (!period.rows[0]) {
            result.skipped++;
            break;
          }
          result.createdPeriods++;
          const invoice = await this.invoices.issueMonthlyInvoice(client, {
            contractId: contract.id,
            customerId: contract.customer_id,
            billingName: contract.billing_name,
            billingAddress: contract.billing_address,
            paymentMethod: contract.payment_method,
            periodId: period.rows[0].id,
            issuedOn: today,
            plan: {
              planId,
              planCode: code,
              planName: name,
              monthlyExcl: price,
              credits,
            },
          });
          if (!invoice) throw new Error("monthly invoice was not issued");
          result.issuedInvoices++;
          changed = true;
          // One run may catch up, but never creates a period whose start is after today.
          contract.last_seq = nextSequence;
          contract.last_period_id = period.rows[0].id;
          contract.plan_id = planId;
          contract.price_excl_tax = price;
          contract.credits = credits;
          contract.plan_name = name;
          contract.plan_code = code;
        }
        await client.query("commit");
        if (changed) result.processedContracts++;
        else result.skipped++;
      } catch (error) {
        // 契約IDとエラーの種類だけを記録する（請求先や金額などの内容は出さない）。
        console.error(
          "daily billing failed for a contract",
          candidate.id,
          error instanceof Error ? error.name : "UnknownError",
        );
        await client.query("rollback");
        result.createdPeriods = before.createdPeriods;
        result.issuedInvoices = before.issuedInvoices;
        result.expiredCredits = before.expiredCredits;
        result.failed++;
      } finally {
        client.release();
      }
    }
    return result;
  }
}

export function runDailyBilling(
  today: string,
  pool: Pool,
  invoices: InvoiceRepository,
) {
  return new DailyBillingJob(pool, invoices).runDailyBilling(today);
}

export async function runDaily(
  today: string,
  pool: Pool,
  invoices: InvoiceRepository,
) {
  const billing = await runDailyBilling(today, pool, invoices);
  const lifecycle = await runDailyLifecycle(today, pool);
  return { billing, lifecycle };
}
