import { randomUUID } from "node:crypto";
import type {
  AdminPlanQuote,
  AdminPlanQuoteVersion,
  ApprovePlanQuoteResponse,
  CreatePlanQuote,
  CreatePlanQuoteResponse,
  CustomerPlanQuote,
} from "@kobito/shared";
import {
  derivePlanQuoteStatus,
  planQuoteTaxFor,
  toTokyoDate,
} from "@kobito/shared";
import type { Pool, PoolClient } from "pg";
import { withAdminAudit } from "../../platform/audit.js";
import { withTransaction } from "../../platform/db/transaction.js";
import type { CustomerScope } from "../../platform/scope.js";
import { ApiError, type Principal } from "../../platform/types.js";
import type { InitialInvoiceInput } from "../invoices/repository.js";
import type { PlanQuoteModule } from "./contracts.js";

/** 初月の請求書の発行は請求書モジュールの処理を使う（税の計算・採番・PDFを重複させない）。 */
export interface InitialInvoiceIssuer {
  issueInitialInvoiceForQuote(
    client: PoolClient,
    input: InitialInvoiceInput,
  ): Promise<unknown>;
}

interface QuoteRow {
  id: string;
  version: number;
  price_excl_tax: number;
  credits: number;
  description: string;
  expires_on: string;
  sent_at: Date | string | null;
  approved_at: Date | string | null;
  superseded_at: Date | string | null;
}

const quoteColumns = `q.id, q.version, q.price_excl_tax, q.credits, q.description,
  q.expires_on::text as expires_on, q.sent_at, q.approved_at, q.superseded_at`;

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}
function isoOrNull(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

function toVersion(row: QuoteRow, today: string): AdminPlanQuoteVersion {
  if (row.sent_at === null) throw new Error("Unsent plan quote exposed");
  const tax = planQuoteTaxFor(row.price_excl_tax);
  const approvedAt = isoOrNull(row.approved_at);
  const supersededAt = isoOrNull(row.superseded_at);
  return {
    id: row.id,
    version: row.version,
    priceExclTax: tax.exclYen,
    taxAmount: tax.taxYen,
    priceInclTax: tax.inclYen,
    credits: row.credits,
    description: row.description,
    expiresOn: row.expires_on,
    sentAt: iso(row.sent_at),
    approvedAt,
    supersededAt,
    status: derivePlanQuoteStatus({
      expiresOn: row.expires_on,
      approvedAt,
      supersededAt,
      today,
    }),
  };
}

const latestContract = `select c.id, c.status, c.plan_id, c.application_id, c.payment_method, c.plan_quote_id
  from contracts c where c.customer_id = $1 order by c.created_at desc, c.id desc limit 1`;

export class PlanQuoteRepository implements PlanQuoteModule {
  constructor(
    private readonly pool: Pool,
    private readonly invoices: InitialInvoiceIssuer,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getAdmin(
    principal: Principal,
    customerId: string,
  ): Promise<AdminPlanQuote> {
    if (principal.role !== "admin" || !principal.secondFactor)
      throw new ApiError(404, "not_found");
    const today = toTokyoDate(this.now());
    const head = await this.pool.query<{
      shop_name: string;
      contact_name: string;
      contract_id: string;
      status: AdminPlanQuote["contract"]["status"];
      plan_name: string;
      payment_method: AdminPlanQuote["application"]["paymentMethod"];
      submitted_at: Date;
      free_text: string | null;
    }>(
      `select cu.shop_name, cu.contact_name, c.id as contract_id, c.status,
              p.name as plan_name, c.payment_method, a.submitted_at, a.free_text
         from customers cu
         join lateral (${latestContract.replace("$1", "cu.id")}) c on true
         join applications a on a.id = c.application_id
         join plans p on p.id = c.plan_id
        where cu.id = $1 and cu.anonymized_at is null`,
      [customerId],
    );
    const row = head.rows[0];
    if (!row) throw new ApiError(404, "not_found");
    const quotes = await this.pool.query<QuoteRow>(
      `select ${quoteColumns} from plan_quotes q
        where q.contract_id = $1 order by q.version desc`,
      [row.contract_id],
    );
    const sent = quotes.rows.filter((quote) => quote.sent_at !== null);
    const latest = sent[0];
    return {
      customer: {
        id: customerId,
        shopName: row.shop_name,
        contactName: row.contact_name,
      },
      contract: { id: row.contract_id, status: row.status },
      application: {
        planName: row.plan_name,
        paymentMethod: row.payment_method,
        submittedAt: iso(row.submitted_at),
        freeText: row.free_text,
      },
      quotes: sent.map((quote) => toVersion(quote, today)),
      expectedVersion: quotes.rows[0]?.version ?? 0,
      canCreate:
        ["quoting", "awaiting_quote_approval"].includes(row.status) &&
        !latest?.approved_at,
      today,
    };
  }

  async createAdmin(
    principal: Principal,
    customerId: string,
    body: CreatePlanQuote,
  ): Promise<CreatePlanQuoteResponse> {
    const quoteId = randomUUID();
    return withAdminAudit(
      this.pool,
      principal,
      {
        action: "plan_quote.sent",
        targetType: "plan_quote",
        targetId: quoteId,
      },
      async (client) => {
        const contract = await client.query<{ id: string; status: string }>(
          `${latestContract} for update`,
          [customerId],
        );
        const locked = contract.rows[0];
        if (!locked) throw new ApiError(404, "not_found");
        if (!["quoting", "awaiting_quote_approval"].includes(locked.status))
          throw new ApiError(409, "plan_quote_conflict");
        const latest = await client.query<{
          version: number;
          approved_at: Date | null;
        }>(
          `select version, approved_at from plan_quotes
            where contract_id = $1 order by version desc limit 1`,
          [locked.id],
        );
        const latestVersion = latest.rows[0]?.version ?? 0;
        if (
          latestVersion !== body.expectedVersion ||
          latest.rows[0]?.approved_at
        )
          throw new ApiError(409, "plan_quote_conflict");
        const sentAt = this.now();
        await client.query(
          `update plan_quotes set superseded_at = $2
            where contract_id = $1 and superseded_at is null and approved_at is null`,
          [locked.id, sentAt],
        );
        const inserted = await client.query<QuoteRow>(
          `insert into plan_quotes
             (id, contract_id, version, price_excl_tax, credits, description, expires_on, sent_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8)
           returning id, version, price_excl_tax, credits, description,
                     expires_on::text as expires_on, sent_at, approved_at, superseded_at`,
          [
            quoteId,
            locked.id,
            latestVersion + 1,
            body.priceExclTax,
            body.credits,
            body.description,
            body.expiresOn,
            sentAt,
          ],
        );
        await client.query(
          "update contracts set status = 'awaiting_quote_approval' where id = $1",
          [locked.id],
        );
        const row = inserted.rows[0];
        if (!row) throw new Error("Plan quote insert returned no row");
        return {
          quote: toVersion(row, toTokyoDate(this.now())),
          contractStatus: "awaiting_quote_approval" as const,
        };
      },
    );
  }

  async getCustomer(scope: CustomerScope): Promise<CustomerPlanQuote> {
    const today = toTokyoDate(this.now());
    const result = await this.pool.query<
      QuoteRow & { contract_status: string }
    >(
      `select ${quoteColumns}, c.status as contract_status
         from (${latestContract}) c
         join plan_quotes q on q.contract_id = c.id and q.sent_at is not null
        order by q.version desc limit 1`,
      [scope.customerId],
    );
    const row = result.rows[0];
    if (!row) throw new ApiError(404, "not_found");
    const version = toVersion(row, today);
    const { supersededAt: _supersededAt, ...quote } = version;
    return {
      ...quote,
      canApprove:
        version.status === "awaiting" &&
        row.contract_status === "awaiting_quote_approval",
    };
  }

  approveCustomer(
    scope: CustomerScope,
    principal: Principal,
    quoteId: string,
  ): Promise<ApprovePlanQuoteResponse> {
    return withTransaction(this.pool, async (client) => {
      const today = toTokyoDate(this.now());
      const found = await client.query<
        QuoteRow & {
          contract_id: string;
          contract_status: string;
          payment_method: string;
          plan_id: string;
          plan_quote_id: string | null;
          plan_name: string;
          billing_name: string;
          billing_address: string;
        }
      >(
        `select ${quoteColumns}, c.id as contract_id, c.status as contract_status,
                c.payment_method, c.plan_id, c.plan_quote_id, p.name as plan_name,
                cu.billing_name, cu.billing_address
           from plan_quotes q
           join contracts c on c.id = q.contract_id
           join customers cu on cu.id = c.customer_id
           join plans p on p.id = c.plan_id
          where q.id = $1 and c.customer_id = $2 and q.sent_at is not null
          for update of q, c`,
        [quoteId, scope.customerId],
      );
      const row = found.rows[0];
      if (!row) throw new ApiError(404, "not_found");
      if (row.approved_at) {
        if (row.plan_quote_id !== row.id)
          throw new ApiError(409, "plan_quote_conflict");
        return {
          quoteId: row.id,
          approvedAt: iso(row.approved_at),
          contractStatus: "awaiting_payment",
          replayed: true,
        };
      }
      if (row.superseded_at) throw new ApiError(409, "plan_quote_conflict");
      if (row.expires_on < today) throw new ApiError(409, "plan_quote_expired");
      if (row.contract_status !== "awaiting_quote_approval")
        throw new ApiError(409, "plan_quote_conflict");
      if (row.payment_method !== "bank_transfer")
        throw new ApiError(409, "application_conflict");

      const approvedAt = this.now();
      await this.invoices.issueInitialInvoiceForQuote(client, {
        contractId: row.contract_id,
        customerId: scope.customerId,
        billingName: row.billing_name,
        billingAddress: row.billing_address,
        plan: {
          planId: row.plan_id,
          planCode: "custom",
          planName: row.plan_name,
          monthlyExcl: row.price_excl_tax,
          credits: row.credits,
        },
      });
      await client.query(
        "update plan_quotes set approved_at = $2, approved_by = $3 where id = $1",
        [row.id, approvedAt, principal.authUserId],
      );
      await client.query(
        "update contracts set plan_quote_id = $2 where id = $1",
        [row.contract_id, row.id],
      );
      await client.query(
        `insert into audit_logs (actor, action, target_type, target_id, detail)
         values ($1, 'plan_quote.approved', 'plan_quote', $2, '{}'::jsonb)`,
        [principal.authUserId, row.id],
      );
      return {
        quoteId: row.id,
        approvedAt: approvedAt.toISOString(),
        contractStatus: "awaiting_payment",
        replayed: false,
      };
    });
  }
}
