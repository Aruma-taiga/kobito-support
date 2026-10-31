import { createHash, randomUUID } from "node:crypto";
import type {
  ApproveApplicationResponse,
  ConfirmBankPaymentRequest,
  ConfirmBankPaymentResponse,
  CustomerContractResponse,
  ExtraCreditPurchaseRequest,
  ExtraCreditPurchaseResponse,
  InvoiceDetail,
  InvoiceList,
  InvoiceListItem,
  InvoiceReadiness,
  PendingBankTransfers,
} from "@kobito/shared";
import {
  addCalendarDays,
  confirmBankPaymentResponseSchema,
  customerContractResponseSchema,
  extraCreditExclYen,
  extraCreditPurchaseResponseSchema,
  invoiceDetailSchema,
  invoiceTotals,
  planCodes,
} from "@kobito/shared";
import type { Pool, PoolClient } from "pg";
import { withAdminAudit } from "../../platform/audit.js";
import type { RuntimeConfig } from "../../platform/config.js";
import { safePgInteger } from "../../platform/db/integers.js";
import { withTransaction } from "../../platform/db/transaction.js";
import type { CustomerScope } from "../../platform/scope.js";
import { ApiError, type Principal } from "../../platform/types.js";
import { schedule } from "../notifications/service.js";
import type { InvoiceModule } from "./contracts.js";
import {
  InvalidInitialInvoiceSnapshot,
  settleInitialInvoicePayment,
} from "./payment-settlement.js";
import type { InvoicePdfRenderer } from "./renderer.js";

const maxPdfBytes = 5 * 1024 * 1024;

interface InvoiceRow {
  id: string;
  invoice_no: string;
  kind: "initial" | "monthly" | "extra_credit";
  status: InvoiceListItem["status"];
  payment_method: InvoiceListItem["paymentMethod"];
  issued_on: string;
  due_on: string;
  total_incl_tax: number;
  total_excl_tax: number;
  tax_amount: number;
  billing_name: string;
  billing_address: string;
  issuer_snapshot: unknown;
  lines: unknown;
}

interface BankInvoiceRow {
  id: string;
  invoice_no: string;
  contract_id: string;
  customer_id: string;
  contract_status: string;
  anchor_date: string | null;
  invoice_status: string;
  payment_method: string;
  kind: string;
  period_id: string | null;
  issued_on: string;
  due_on: string | null;
  total_incl_tax: number;
  total_excl_tax: number;
  issuer_snapshot: unknown;
  shop_name: string;
  billing_name: string;
  email: string;
  line_user_id: string | null;
}

type IssuerSnapshot = InvoiceDetail["issuer"];

export interface InitialInvoiceInput {
  contractId: string;
  customerId: string;
  billingName: string;
  billingAddress: string;
  paymentMethod?: "card" | "bank_transfer";
  kind?: "initial" | "monthly" | "extra_credit";
  quantity?: number;
  invoiceId?: string;
  periodId?: string;
  issuedOn?: string;
  dueOn?: string;
  plan: {
    planId: string;
    planCode: string;
    planName: string;
    monthlyExcl: number;
    credits: number;
    acceptedPlanMonthlyExcl?: number;
  };
}

function safeObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringSetting(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function isLocalInvoicePreviewEnvironment(
  config: RuntimeConfig,
): boolean {
  if (!config.devInvoicePreview || config.nodeEnv !== "development")
    return false;
  if (!config.firebaseProjectId.startsWith("demo-")) return false;
  if (
    !config.authEmulatorHost ||
    !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(config.authEmulatorHost)
  )
    return false;
  try {
    const database = new URL(config.databaseUrl);
    return (
      ["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) &&
      database.pathname === "/kobito_support" &&
      !database.search &&
      !database.hash
    );
  } catch {
    return false;
  }
}

function localPreviewPermitted(
  config: RuntimeConfig,
  settingsEnabled: boolean,
): boolean {
  return settingsEnabled && isLocalInvoicePreviewEnvironment(config);
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
    throw new Error("Unable to resolve invoice issue date");
  return `${year}-${month}-${day}`;
}

export class InvoiceRepository implements InvoiceModule {
  constructor(
    private readonly pool: Pool,
    private readonly config: RuntimeConfig,
    private readonly renderer: InvoicePdfRenderer,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async listPendingBankTransfers(
    principal: Principal,
  ): Promise<PendingBankTransfers> {
    this.assertAdmin(principal);
    const rows = await this.pool.query<
      InvoiceRow & {
        contract_id: string;
        customer_id: string;
        shop_name: string;
        customer_billing_name: string;
      }
    >(
      `select i.id, i.invoice_no, i.kind, i.status, i.payment_method, i.issued_on::text as issued_on,
              i.due_on::text as due_on, i.total_incl_tax, i.total_excl_tax, i.tax_amount,
              i.billing_name, coalesce(i.billing_address_snapshot,cst.billing_address) as billing_address,
              i.issuer_snapshot, coalesce(l.lines,'[]'::jsonb) as lines, c.id as contract_id, cst.id as customer_id,
              cst.shop_name, cst.billing_name as customer_billing_name
         from invoices i join contracts c on c.id=i.contract_id join customers cst on cst.id=c.customer_id
        left join lateral (
          select jsonb_agg(jsonb_build_object('description',line.description,'quantity',line.quantity,
            'unit_price_excl_tax',line.unit_price_excl_tax,'amount_excl_tax',line.amount_excl_tax,'tax_rate',line.tax_rate)
            order by line.id) as lines from invoice_lines line where line.invoice_id=i.id
        ) l on true
        where i.payment_method='bank_transfer' and i.status in ('issued','overdue')
          and ((i.kind='initial' and c.status='awaiting_payment') or
               (i.kind='monthly' and c.status in ('active','cancel_scheduled','ended')) or
               (i.kind='extra_credit' and c.status in ('active','cancel_scheduled')))
        order by i.due_on asc nulls last, i.issued_on asc, i.invoice_no asc limit 100`,
    );
    return {
      items: rows.rows.map((row) => ({
        invoice: this.listItem(this.toDetail(row)),
        customer: {
          id: row.customer_id,
          shopName: row.shop_name,
          billingName: row.customer_billing_name,
        },
        contractId: row.contract_id,
      })),
    };
  }

  confirmBankPayment(
    principal: Principal,
    invoiceId: string,
    request: ConfirmBankPaymentRequest,
  ): Promise<ConfirmBankPaymentResponse> {
    this.assertAdmin(principal);
    return withAdminAudit(
      this.pool,
      principal,
      {
        action: "invoice.bank_payment.confirmed",
        targetType: "invoice",
        targetId: invoiceId,
        detail: { toStatus: "paid" },
      },
      (client) =>
        this.confirmBankPaymentInTransaction(
          client,
          principal,
          invoiceId,
          request,
        ),
    );
  }

  private async confirmBankPaymentInTransaction(
    client: PoolClient,
    principal: Principal,
    invoiceId: string,
    request: ConfirmBankPaymentRequest,
  ): Promise<ConfirmBankPaymentResponse> {
    await client.query("set local lock_timeout = '5s'");
    await client.query("set local statement_timeout = '30s'");
    const reference = await client.query<{ contract_id: string }>(
      "select contract_id from invoices where id=$1 and kind in ('initial','monthly','extra_credit')",
      [invoiceId],
    );
    const contractId = reference.rows[0]?.contract_id;
    if (!contractId) throw new ApiError(404, "not_found");
    const contractResult = await client.query<{
      id: string;
      customer_id: string;
      status: string;
      anchor_date: string | null;
    }>(
      "select id, customer_id, status, anchor_date::text as anchor_date from contracts where id=$1 for update",
      [contractId],
    );
    const contract = contractResult.rows[0];
    if (!contract) throw new ApiError(404, "not_found");
    const result = await client.query<BankInvoiceRow>(
      `select i.id, i.invoice_no, i.contract_id, c.customer_id, c.status as contract_status,
              c.anchor_date::text as anchor_date, i.status as invoice_status, i.payment_method, i.kind,
              i.issued_on::text as issued_on, i.due_on::text as due_on, i.total_incl_tax, i.total_excl_tax,
              i.issuer_snapshot, i.period_id, customer.shop_name, customer.billing_name, customer.email, customer.line_user_id
         from invoices i join contracts c on c.id=i.contract_id join customers customer on customer.id=c.customer_id
        where i.id=$1 for update of i`,
      [invoiceId],
    );
    const invoice = result.rows[0];
    if (!invoice) throw new ApiError(404, "not_found");
    const snapshot = safeObject(invoice.issuer_snapshot);
    const preview = snapshot.preview === true;
    if (
      preview &&
      (!request.previewAcknowledged ||
        !isLocalInvoicePreviewEnvironment(this.config))
    )
      throw new ApiError(409, "application_conflict");

    if (
      invoice.payment_method !== "bank_transfer" ||
      !["initial", "monthly", "extra_credit"].includes(invoice.kind)
    )
      throw new ApiError(409, "application_conflict");
    const existingPayment = await client.query<{
      id: string;
      amount: number;
      paid_on: string;
      method: string;
      confirmed_via: string;
    }>(
      "select id, amount, paid_on::text as paid_on, method, confirmed_via from payments where invoice_id=$1 order by created_at",
      [invoiceId],
    );
    if (invoice.invoice_status === "paid") {
      const payment = existingPayment.rows[0];
      const periodResult = await client.query<{
        id: string;
        seq: number;
        starts_on: string;
        ends_on: string;
        price_excl_tax: number;
        credits: number;
      }>(
        `select bp.id,bp.seq,bp.starts_on::text as starts_on,bp.ends_on::text as ends_on,bp.price_excl_tax,bp.credits
           from billing_periods bp where bp.id=coalesce(
             (select period_id from invoices where id=$1),
             (select p.id from payments pay join billing_periods p on p.contract_id=$2
               where pay.invoice_id=$1 and pay.paid_on between p.starts_on and p.ends_on order by p.seq desc limit 1),
             (select id from billing_periods where contract_id=$2 and seq=1))`,
        [invoiceId, contractId],
      );
      const period = periodResult.rows[0];
      if (
        existingPayment.rows.length !== 1 ||
        !payment ||
        payment.method !== "bank_transfer" ||
        payment.confirmed_via !== "manual" ||
        payment.amount !== request.amount ||
        payment.paid_on !== request.paidOn ||
        !period ||
        (invoice.kind === "initial" && !contract.anchor_date) ||
        (invoice.kind === "monthly" && !contract.anchor_date)
      )
        throw new ApiError(409, "application_conflict");
      return confirmBankPaymentResponseSchema.parse({
        invoiceId,
        paymentId: payment.id,
        amount: payment.amount,
        paidOn: payment.paid_on,
        contractId,
        anchorDate: contract.anchor_date,
        period: {
          id: period.id,
          seq: period.seq,
          startsOn: period.starts_on,
          endsOn: period.ends_on,
          priceExclTax: period.price_excl_tax,
          credits: period.credits,
        },
        preview,
        replayed: true,
      });
    }
    if (
      !new Set(["issued", "overdue"]).has(invoice.invoice_status) ||
      (invoice.kind === "initial" &&
        invoice.contract_status !== "awaiting_payment") ||
      (invoice.kind === "monthly" &&
        !["active", "cancel_scheduled", "ended"].includes(
          invoice.contract_status,
        )) ||
      (invoice.kind === "extra_credit" &&
        !["active", "cancel_scheduled"].includes(invoice.contract_status))
    )
      throw new ApiError(409, "application_conflict");
    if (request.amount !== invoice.total_incl_tax)
      throw new ApiError(422, "validation_error");
    const today = todayInTokyo(this.clock());
    if (
      !invoice.due_on ||
      request.paidOn < invoice.issued_on ||
      (invoice.kind === "initial" && request.paidOn > invoice.due_on) ||
      request.paidOn > today
    )
      throw new ApiError(422, "validation_error");
    if (existingPayment.rows.length)
      throw new ApiError(409, "application_conflict");
    if (invoice.kind === "initial" && contract.anchor_date)
      throw new ApiError(409, "application_conflict");

    if (invoice.kind === "extra_credit") {
      if (
        !contract.anchor_date ||
        !["active", "cancel_scheduled"].includes(contract.status)
      )
        throw new ApiError(409, "application_conflict");
      const periodResult = await client.query<{
        id: string;
        seq: number;
        starts_on: string;
        ends_on: string;
        price_excl_tax: number;
        credits: number;
      }>(
        `select id,seq,starts_on::text as starts_on,ends_on::text as ends_on,price_excl_tax,credits
           from billing_periods where contract_id=$1 and starts_on <= $2::date and ends_on >= $2::date
           order by seq desc limit 1 for update`,
        [contractId, request.paidOn],
      );
      const period = periodResult.rows[0];
      if (!period) throw new ApiError(409, "application_conflict");
      const paymentId = randomUUID();
      await client.query(
        `insert into payments (id,invoice_id,method,amount,paid_on,confirmed_via,confirmed_by)
         values ($1,$2,'bank_transfer',$3,$4,'manual',$5)`,
        [
          paymentId,
          invoiceId,
          request.amount,
          request.paidOn,
          principal.authUserId,
        ],
      );
      await client.query("update invoices set status='paid' where id=$1", [
        invoiceId,
      ]);
      const line = await client.query<{ quantity: number }>(
        "select quantity from invoice_lines where invoice_id=$1 and line_kind='extra_credit'",
        [invoiceId],
      );
      const quantity = line.rows[0]?.quantity;
      if (!quantity) throw new ApiError(409, "application_conflict");
      await client.query(
        `insert into credit_entries(contract_id,period_id,kind,amount,invoice_id,note)
         values($1,$2,'extra',$3,$4,'追加クレジット請求の入金確認')
         on conflict (invoice_id) where kind='extra' and invoice_id is not null do nothing`,
        [contractId, period.id, quantity, invoiceId],
      );
      if (!preview)
        await schedule(client, {
          customerId: invoice.customer_id,
          kind: "NT-04",
          dedupeKey: `NT-04:invoice:${invoiceId}:email`,
          scheduledAt: this.clock(),
          payload: {
            contractId,
            periodId: period.id,
            invoiceId,
            extraCredits: quantity,
          },
        });
      return confirmBankPaymentResponseSchema.parse({
        invoiceId,
        paymentId,
        amount: request.amount,
        paidOn: request.paidOn,
        contractId,
        anchorDate: contract.anchor_date,
        period: {
          id: period.id,
          seq: period.seq,
          startsOn: period.starts_on,
          endsOn: period.ends_on,
          priceExclTax: period.price_excl_tax,
          credits: period.credits,
        },
        preview,
        replayed: false,
      });
    }

    if (invoice.kind === "monthly") {
      if (!contract.anchor_date || !invoice.period_id)
        throw new ApiError(409, "application_conflict");
      const periodResult = await client.query<{
        id: string;
        seq: number;
        starts_on: string;
        ends_on: string;
        price_excl_tax: number;
        credits: number;
      }>(
        "select id,seq,starts_on::text as starts_on,ends_on::text as ends_on,price_excl_tax,credits from billing_periods where id=$1 and contract_id=$2 for update",
        [invoice.period_id, contractId],
      );
      const period = periodResult.rows[0];
      if (!period) throw new ApiError(409, "application_conflict");
      const paymentId = randomUUID();
      await client.query(
        `insert into payments (id,invoice_id,method,amount,paid_on,confirmed_via,confirmed_by)
         values ($1,$2,'bank_transfer',$3,$4,'manual',$5)`,
        [
          paymentId,
          invoiceId,
          request.amount,
          request.paidOn,
          principal.authUserId,
        ],
      );
      await client.query("update invoices set status='paid' where id=$1", [
        invoiceId,
      ]);
      await client.query(
        `insert into credit_entries (contract_id,period_id,kind,amount,invoice_id,note)
         values ($1,$2,'grant',$3,$4,'月額請求の入金確認') on conflict (period_id) where kind='grant' do nothing`,
        [contractId, period.id, period.credits, invoiceId],
      );
      if (!preview) {
        await schedule(client, {
          customerId: invoice.customer_id,
          kind: "NT-04",
          dedupeKey: `NT-04:${period.id}:email`,
          scheduledAt: new Date(),
          payload: { contractId, periodId: period.id, invoiceId },
        });
      }
      return confirmBankPaymentResponseSchema.parse({
        invoiceId,
        paymentId,
        amount: request.amount,
        paidOn: request.paidOn,
        contractId,
        anchorDate: contract.anchor_date,
        period: {
          id: period.id,
          seq: period.seq,
          startsOn: period.starts_on,
          endsOn: period.ends_on,
          priceExclTax: period.price_excl_tax,
          credits: period.credits,
        },
        preview,
        replayed: false,
      });
    }

    let settlement: Awaited<ReturnType<typeof settleInitialInvoicePayment>>;
    try {
      settlement = await settleInitialInvoicePayment(client, {
        invoiceId,
        contractId,
        customerId: invoice.customer_id,
        notificationsEnabled: !preview,
        paidOn: request.paidOn,
        anchorDate: today,
        amount: request.amount,
        paymentMethod: "bank_transfer",
        confirmedVia: "manual",
        confirmedBy: principal.authUserId,
        issuerSnapshot: snapshot,
        totalExclTax: invoice.total_excl_tax,
      });
    } catch (error) {
      if (error instanceof InvalidInitialInvoiceSnapshot)
        throw new ApiError(409, "application_conflict");
      throw error;
    }
    const { paymentId, period } = settlement;
    return confirmBankPaymentResponseSchema.parse({
      invoiceId,
      paymentId,
      amount: request.amount,
      paidOn: request.paidOn,
      contractId,
      anchorDate: today,
      period,
      preview,
      replayed: false,
    });
  }

  async getCustomerContract(
    scope: CustomerScope,
  ): Promise<CustomerContractResponse> {
    const result = await this.pool.query<{
      id: string;
      status: string;
      anchor_date: string | null;
      preview: boolean;
      accepted_plan: unknown;
      period_id: string | null;
      seq: number | null;
      starts_on: string | null;
      ends_on: string | null;
      price_excl_tax: number | null;
      credits: number | null;
      balance: string | null;
    }>(
      `select c.id,c.status,c.anchor_date::text as anchor_date, coalesce((i.issuer_snapshot->>'preview')::boolean,false) as preview,
              i.issuer_snapshot->'acceptedPlan' as accepted_plan, bp.id as period_id,bp.seq,bp.starts_on::text as starts_on,
              bp.ends_on::text as ends_on,bp.price_excl_tax,bp.credits,coalesce(cb.balance,0)::text as balance
         from contracts c
         left join lateral (select invoice.* from invoices invoice where invoice.contract_id=c.id and invoice.kind='initial' order by invoice.created_at desc limit 1) i on true
         left join lateral (select period.* from billing_periods period where period.contract_id=c.id and c.status in ('active','cancel_scheduled') and period.starts_on <= $2::date and period.ends_on >= $2::date order by period.seq desc limit 1) bp on true
         left join credit_balances cb on cb.period_id=bp.id and cb.contract_id=c.id
        where c.customer_id=$1 order by c.created_at desc,c.id desc limit 1`,
      [scope.customerId, todayInTokyo(this.clock())],
    );
    const row = result.rows[0];
    if (!row) return customerContractResponseSchema.parse({ contract: null });
    const accepted = safeObject(row.accepted_plan);
    const plan =
      typeof accepted.planName === "string" &&
      Number.isSafeInteger(accepted.monthlyPriceExclTax) &&
      Number.isSafeInteger(accepted.credits)
        ? {
            name: accepted.planName,
            priceExclTax: accepted.monthlyPriceExclTax as number,
            credits: accepted.credits as number,
          }
        : null;
    const currentPeriod =
      row.period_id &&
      row.seq &&
      row.starts_on &&
      row.ends_on &&
      row.price_excl_tax !== null &&
      row.credits !== null
        ? {
            id: row.period_id,
            seq: row.seq,
            startsOn: row.starts_on,
            endsOn: row.ends_on,
            priceExclTax: row.price_excl_tax,
            credits: row.credits,
            balance: safePgInteger(row.balance ?? "0"),
          }
        : null;
    return customerContractResponseSchema.parse({
      contract: {
        id: row.id,
        status: row.status,
        anchorDate: row.anchor_date,
        preview: row.preview,
        plan,
        currentPeriod,
      },
    });
  }

  approveApplication(
    principal: Principal,
    applicationId: string,
  ): Promise<ApproveApplicationResponse> {
    if (this.config.nodeEnv === "production")
      throw new ApiError(503, "invoice_unavailable");
    return withAdminAudit(
      this.pool,
      principal,
      {
        action: "application.approved",
        targetType: "application",
        targetId: applicationId,
        detail: { fromStatus: "under_review" },
      },
      (client) => this.approveInTransaction(client, applicationId),
    );
  }

  async getReadiness(principal: Principal): Promise<InvoiceReadiness> {
    this.assertAdmin(principal);
    if (this.config.nodeEnv === "production")
      return {
        canIssue: false,
        mode: "unavailable",
        reason: "document_store_unavailable",
      };
    const client = await this.pool.connect();
    try {
      const settings = await this.readIssuerSettings(client);
      if (localPreviewPermitted(this.config, settings.previewEnabled))
        return { canIssue: true, mode: "preview", reason: "preview_only" };
      if (this.isLiveIssuerReady(settings))
        return { canIssue: true, mode: "live", reason: "ready" };
      return {
        canIssue: false,
        mode: "unavailable",
        reason: "issuer_not_configured",
      };
    } finally {
      client.release();
    }
  }

  private async approveInTransaction(
    client: PoolClient,
    applicationId: string,
  ): Promise<ApproveApplicationResponse> {
    await client.query("set local lock_timeout = '5s'");
    await client.query("set local statement_timeout = '60s'");
    const result = await client.query<{
      application_id: string;
      contract_id: string;
      customer_id: string;
      plan_id: string;
      status: string;
      review_result: string | null;
      payment_method: string;
      shown_terms: unknown;
      billing_name: string;
      billing_address: string;
    }>(
      `select a.id as application_id, c.id as contract_id, c.customer_id, c.plan_id,
              c.status, a.review_result, a.payment_method, a.shown_terms,
              customer.billing_name, customer.billing_address
         from applications a join contracts c on c.application_id = a.id
         join customers customer on customer.id = c.customer_id
        where a.id = $1 for update of a, c, customer`,
      [applicationId],
    );
    const row = result.rows[0];
    if (!row) throw new ApiError(404, "not_found");

    if (row.review_result === "approved" && row.status === "quoting") {
      return {
        applicationId: row.application_id,
        contractId: row.contract_id,
        status: "quoting",
        invoice: null,
        replayed: true,
      };
    }
    if (row.review_result === "approved" && row.status === "awaiting_payment") {
      const existing = await this.getByContract(client, row.contract_id);
      if (!existing)
        throw new Error("Approved payment-waiting contract has no invoice");
      return {
        applicationId: row.application_id,
        contractId: row.contract_id,
        status: "awaiting_payment",
        invoice: this.listItem(existing),
        replayed: true,
      };
    }
    if (row.status !== "under_review" || row.review_result !== null)
      throw new ApiError(409, "application_conflict");

    const terms = safeObject(row.shown_terms);
    if (
      terms.paymentMethod !== row.payment_method ||
      (row.payment_method !== "bank_transfer" &&
        (row.payment_method !== "card" ||
          this.config.cardPaymentEnabled !== true))
    )
      throw new ApiError(409, "application_conflict");
    if (
      typeof terms.planCode !== "string" ||
      !planCodes.includes(terms.planCode as (typeof planCodes)[number])
    )
      throw new ApiError(409, "application_conflict");
    if (terms.planCode === "custom") {
      if (terms.priceExclTax !== null || terms.credits !== null)
        throw new ApiError(409, "application_conflict");
      await client.query(
        `update applications set reviewed_at = now(), review_result = 'approved' where id = $1`,
        [row.application_id],
      );
      await client.query(
        `update contracts set status = 'quoting' where id = $1`,
        [row.contract_id],
      );
      return {
        applicationId: row.application_id,
        contractId: row.contract_id,
        status: "quoting",
        invoice: null,
        replayed: false,
      };
    }
    if (terms.priceExclTax === null)
      throw new ApiError(409, "application_conflict");
    const monthlyExcl = terms.priceExclTax;
    const planName = terms.planName;
    const planId = terms.planId;
    const planCode = terms.planCode;
    const credits = terms.credits;
    if (
      !Number.isSafeInteger(monthlyExcl) ||
      (monthlyExcl as number) <= 0 ||
      typeof planName !== "string" ||
      !planName.trim() ||
      typeof planId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(planId) ||
      typeof planCode !== "string" ||
      !Number.isSafeInteger(credits) ||
      (credits as number) <= 0
    )
      throw new ApiError(409, "application_conflict");
    const invoice = await this.issueInitialInvoice(client, {
      contractId: row.contract_id,
      customerId: row.customer_id,
      billingName: row.billing_name,
      billingAddress: row.billing_address,
      paymentMethod: row.payment_method as "card" | "bank_transfer",
      plan: {
        planId,
        planCode,
        planName,
        monthlyExcl: monthlyExcl as number,
        credits: credits as number,
      },
    });
    await client.query(
      "update applications set reviewed_at = now(), review_result = 'approved' where id = $1",
      [row.application_id],
    );
    return {
      applicationId: row.application_id,
      contractId: row.contract_id,
      status: "awaiting_payment",
      invoice,
      replayed: false,
    };
  }

  /** 個別見積りの了承で、了承した版の金額・クレジットから初月の請求書を発行する。 */
  issueInitialInvoiceForQuote(
    client: PoolClient,
    input: InitialInvoiceInput,
  ): Promise<InvoiceListItem> {
    if (this.config.nodeEnv === "production")
      throw new ApiError(503, "invoice_unavailable");
    return this.issueInitialInvoice(client, input);
  }

  issueMonthlyInvoice(client: PoolClient, input: InitialInvoiceInput) {
    if (!input.periodId) throw new Error("Monthly invoice period is required");
    return this.issueInitialInvoice(client, { ...input, kind: "monthly" });
  }

  private async issueInitialInvoice(
    client: PoolClient,
    input: InitialInvoiceInput,
  ): Promise<InvoiceListItem> {
    const { monthlyExcl, planName, planId, planCode, credits } = input.plan;
    const currentSettings = await this.readIssuerSettings(client);
    const preview = localPreviewPermitted(
      this.config,
      currentSettings.previewEnabled,
    );
    const issuer = this.makeIssuer(currentSettings, preview);
    if (!preview && !this.isLiveIssuerReady(currentSettings))
      throw new ApiError(503, "invoice_unavailable");

    const kind = input.kind ?? "initial";
    const issuedOn = input.issuedOn ?? todayInTokyo(this.clock());
    const dueOn = input.dueOn ?? addCalendarDays(issuedOn, 7);
    const quantity = input.quantity ?? 1;
    const total = invoiceTotals([monthlyExcl]);
    const invoiceId = input.invoiceId ?? randomUUID();
    const year = Number(issuedOn.slice(0, 4));
    const prefix = currentSettings.prefix;
    if (
      !prefix ||
      !/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(prefix) ||
      prefix.length > 20
    ) {
      if (!preview) throw new ApiError(503, "invoice_unavailable");
    }
    const actualPrefix =
      prefix && /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(prefix)
        ? prefix
        : "DEV";
    const numberResult = await client.query<{ invoice_no: string }>(
      "select next_invoice_no($1, $2) as invoice_no",
      [year, actualPrefix],
    );
    const invoiceNo = numberResult.rows[0]?.invoice_no;
    if (!invoiceNo)
      throw new Error("Invoice number function returned no value");
    const details = invoiceDetailSchema.parse({
      id: invoiceId,
      invoiceNo,
      kind,
      status: "issued",
      issuedOn,
      dueOn,
      totalInclTax: total.inclYen,
      totalExclTax: total.exclYen,
      taxAmount: total.taxYen,
      paymentMethod: input.paymentMethod ?? "bank_transfer",
      preview,
      billingName: input.billingName,
      billingAddress: input.billingAddress,
      acceptedPlan: {
        planId,
        planCode,
        planName: planName.trim(),
        monthlyPriceExclTax: input.plan.acceptedPlanMonthlyExcl ?? monthlyExcl,
        credits,
      },
      issuer,
      lines: [
        {
          description:
            kind === "extra_credit"
              ? "追加クレジット"
              : `${planName.trim()} ${kind === "initial" ? "初月" : "月額"}利用料`,
          quantity,
          unitPriceExclTax:
            kind === "extra_credit" ? extraCreditExclYen : monthlyExcl,
          amountExclTax: monthlyExcl,
          taxRate: 0.1,
        },
      ],
    });
    const firstLine = details.lines[0];
    if (!firstLine) throw new Error("Invoice has no lines");
    const pdf = await this.renderer.render(details);
    if (
      !pdf.byteLength ||
      pdf.byteLength > maxPdfBytes ||
      !Buffer.from(pdf).subarray(0, 5).equals(Buffer.from("%PDF-"))
    )
      throw new Error("Invoice PDF renderer output invalid");
    const issuerSnapshot = {
      ...issuer,
      acceptedPlan: details.acceptedPlan,
      preview,
    };
    await client.query(
      `insert into invoices (id, invoice_no, contract_id, period_id, kind, status, payment_method,
         issued_on, due_on, total_incl_tax, total_excl_tax, tax_amount, billing_name,
         billing_address_snapshot, issuer_snapshot, pdf_path)
       values ($1,$2,$3,$14,$15,'issued',$13,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        invoiceId,
        invoiceNo,
        input.contractId,
        issuedOn,
        dueOn,
        total.inclYen,
        total.exclYen,
        total.taxYen,
        input.billingName,
        input.billingAddress,
        JSON.stringify(issuerSnapshot),
        `invoice_documents:${invoiceId}`,
        input.paymentMethod ?? "bank_transfer",
        input.periodId ?? null,
        kind,
      ],
    );
    await client.query(
      `insert into invoice_lines (invoice_id, line_kind, description, quantity, unit_price_excl_tax, amount_excl_tax, tax_rate)
       values ($1,$5,$2,$3,$4,$6,0.100)`,
      [
        invoiceId,
        firstLine.description,
        firstLine.quantity,
        firstLine.unitPriceExclTax,
        kind === "extra_credit" ? "extra_credit" : "monthly_fee",
        firstLine.amountExclTax,
      ],
    );
    await client.query(
      "insert into invoice_documents (invoice_id, mime_type, sha256, content) values ($1,'application/pdf',$2,$3)",
      [
        invoiceId,
        createHash("sha256").update(pdf).digest("hex"),
        Buffer.from(pdf),
      ],
    );
    if (kind === "initial")
      await client.query(
        "update contracts set status = 'awaiting_payment', first_invoice_due_on = $2 where id = $1",
        [input.contractId, dueOn],
      );
    if (!preview && kind === "initial") {
      await schedule(client, {
        customerId: input.customerId,
        kind: "NT-02",
        dedupeKey: `NT-02:invoice:${invoiceId}:customer`,
        scheduledAt: new Date(),
        payload: { invoiceId },
      });
    }
    if (!preview && (kind === "monthly" || kind === "extra_credit")) {
      await schedule(client, {
        customerId: input.customerId,
        kind: "NT-03",
        dedupeKey: `NT-03:invoice:${invoiceId}:customer`,
        scheduledAt: new Date(),
        payload: {
          invoiceId,
          ...(kind === "extra_credit" ? { extraCredits: quantity } : {}),
        },
      });
    }
    return this.listItem(details);
  }

  private async readIssuerSettings(client: PoolClient): Promise<{
    serviceName: string | undefined;
    companyName: string | undefined;
    companyAddress: string | undefined;
    registrationNo: string | undefined;
    prefix: string | undefined;
    bank: Record<string, unknown>;
    previewEnabled: boolean;
  }> {
    const result = await client.query<{ key: string; value: unknown }>(
      `select key, value from settings where key = any($1::text[])`,
      [
        [
          "service_name",
          "company_name",
          "company_address",
          "invoice_registration_no",
          "invoice_prefix",
          "bank_account",
          "invoice_preview_enabled",
        ],
      ],
    );
    const values = new Map(result.rows.map(({ key, value }) => [key, value]));
    const get = (key: string) => stringSetting(values.get(key));
    return {
      serviceName: get("service_name"),
      companyName: get("company_name"),
      companyAddress: get("company_address"),
      registrationNo: get("invoice_registration_no"),
      prefix: get("invoice_prefix"),
      bank: safeObject(values.get("bank_account")),
      previewEnabled: values.get("invoice_preview_enabled") === true,
    };
  }

  private isLiveIssuerReady(
    settings: Awaited<ReturnType<InvoiceRepository["readIssuerSettings"]>>,
  ): boolean {
    const bank = settings.bank;
    return Boolean(
      settings.serviceName &&
        settings.companyName &&
        settings.companyAddress &&
        settings.registrationNo &&
        /^T\d{13}$/.test(settings.registrationNo) &&
        settings.prefix &&
        stringSetting(bank.bank_name) &&
        stringSetting(bank.branch_name) &&
        stringSetting(bank.account_type) &&
        stringSetting(bank.account_number) &&
        stringSetting(bank.account_holder),
    );
  }

  private makeIssuer(
    settings: Awaited<ReturnType<InvoiceRepository["readIssuerSettings"]>>,
    preview: boolean,
  ): IssuerSnapshot {
    const missing = (value: string | undefined) =>
      value ?? (preview ? "未設定" : "");
    const account = (key: string) => stringSetting(settings.bank[key]) ?? null;
    return {
      serviceName: missing(settings.serviceName),
      companyName: missing(settings.companyName),
      companyAddress: missing(settings.companyAddress),
      invoiceRegistrationNo:
        settings.registrationNo && /^T\d{13}$/.test(settings.registrationNo)
          ? settings.registrationNo
          : null,
      bankAccountName: account("bank_name")
        ? `${account("bank_name")} / ${account("account_holder") ?? "未設定"}`
        : null,
      bankAccountBranch: account("branch_name"),
      bankAccountType: account("account_type"),
      bankAccountNumber: account("account_number"),
    };
  }

  private async getByContract(
    client: PoolClient,
    contractId: string,
  ): Promise<InvoiceDetail | undefined> {
    const result = await client.query<InvoiceRow>(
      `${detailQuery} where i.contract_id = $1 and i.kind = 'initial' and i.status <> 'void' order by i.created_at limit 1`,
      [contractId],
    );
    return result.rows[0] ? this.toDetail(result.rows[0]) : undefined;
  }

  async purchaseExtraCredits(
    scope: CustomerScope,
    request: ExtraCreditPurchaseRequest,
    idempotencyKey: string,
  ): Promise<ExtraCreditPurchaseResponse> {
    const purchaseId = deterministicUuid(
      `${scope.customerId}:${idempotencyKey}`,
    );
    return withTransaction(this.pool, async (client) => {
      await client.query("set local lock_timeout = '5s'");
      await client.query("set local statement_timeout = '60s'");
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [
        purchaseId,
      ]);
      const replay = await client.query<{
        invoice_no: string;
        total_excl_tax: number;
        tax_amount: number;
        total_incl_tax: number;
        payment_method: "bank_transfer" | "card";
        quantity: number;
      }>(
        `select i.invoice_no,i.total_excl_tax,i.tax_amount,i.total_incl_tax,i.payment_method,
                l.quantity
           from invoices i join contracts c on c.id=i.contract_id
           join invoice_lines l on l.invoice_id=i.id and l.line_kind='extra_credit'
          where i.id=$1 and c.customer_id=$2 and i.kind='extra_credit'`,
        [purchaseId, scope.customerId],
      );
      const existing = replay.rows[0];
      if (existing) {
        if (existing.quantity !== request.quantity)
          throw new ApiError(409, "application_conflict");
        return extraCreditPurchaseResponseSchema.parse({
          invoiceId: purchaseId,
          invoiceNo: existing.invoice_no,
          totalExclTax: existing.total_excl_tax,
          taxAmount: existing.tax_amount,
          totalInclTax: existing.total_incl_tax,
          paymentMethod: existing.payment_method,
        });
      }
      const contractResult = await client.query<{
        id: string;
        customer_id: string;
        status: string;
        payment_method: "card" | "bank_transfer";
        plan_id: string;
        plan_code: string;
        plan_name: string;
        credits: number;
        billing_name: string;
        billing_address: string;
      }>(
        `select c.id,c.customer_id,c.status,c.payment_method,p.id as plan_id,p.code as plan_code,
                p.name as plan_name,bp.credits,customer.billing_name,customer.billing_address
           from contracts c join customers customer on customer.id=c.customer_id
           join plans p on p.id=c.plan_id
           join lateral (select credits from billing_periods where contract_id=c.id order by seq desc limit 1) bp on true
          where c.customer_id=$1 order by c.created_at desc,c.id desc limit 1 for update of c`,
        [scope.customerId],
      );
      const contract = contractResult.rows[0];
      if (!contract) throw new ApiError(404, "not_found");
      if (!["active", "cancel_scheduled"].includes(contract.status))
        throw new ApiError(409, "application_conflict");
      const today = todayInTokyo(this.clock());
      const periodResult = await client.query<{
        id: string;
        credits: number;
        price_excl_tax: number;
      }>(
        `select id,credits,price_excl_tax from billing_periods where contract_id=$1
          and starts_on <= $2::date and ends_on >= $2::date order by seq desc limit 1 for update`,
        [contract.id, today],
      );
      const period = periodResult.rows[0];
      if (!period) throw new ApiError(409, "application_conflict");
      const item = await this.issueInitialInvoice(client, {
        contractId: contract.id,
        customerId: contract.customer_id,
        billingName: contract.billing_name,
        billingAddress: contract.billing_address,
        paymentMethod: contract.payment_method,
        kind: "extra_credit",
        invoiceId: purchaseId,
        quantity: request.quantity,
        plan: {
          planId: contract.plan_id,
          planCode: contract.plan_code,
          planName: contract.plan_name,
          monthlyExcl: extraCreditExclYen * request.quantity,
          credits: period.credits,
          acceptedPlanMonthlyExcl: period.price_excl_tax,
        },
      });
      const response = extraCreditPurchaseResponseSchema.parse({
        invoiceId: item.id,
        invoiceNo: item.invoiceNo,
        totalExclTax: item.totalExclTax,
        taxAmount: item.taxAmount,
        totalInclTax: item.totalInclTax,
        paymentMethod: item.paymentMethod,
      });
      return response;
    });
  }

  async listCustomer(scope: CustomerScope): Promise<InvoiceList> {
    const result = await this.pool.query<InvoiceRow>(
      `${detailQuery} where c.customer_id = $1 and i.kind in ('initial','monthly','extra_credit') order by i.issued_on desc, i.invoice_no desc`,
      [scope.customerId],
    );
    return {
      invoices: result.rows.map((row) => this.listItem(this.toDetail(row))),
    };
  }
  async getCustomer(
    scope: CustomerScope,
    invoiceId: string,
  ): Promise<InvoiceDetail> {
    const result = await this.pool.query<InvoiceRow>(
      `${detailQuery} where c.customer_id = $1 and i.id = $2 and i.kind in ('initial','monthly','extra_credit')`,
      [scope.customerId, invoiceId],
    );
    const row = result.rows[0];
    if (!row) throw new ApiError(404, "not_found");
    return this.toDetail(row);
  }
  getCustomerPdf(scope: CustomerScope, invoiceId: string) {
    return this.getPdf("customer", scope, invoiceId);
  }
  async listAdmin(principal: Principal): Promise<InvoiceList> {
    this.assertAdmin(principal);
    const result = await this.pool.query<InvoiceRow>(
      `${detailQuery} where i.kind in ('initial','monthly','extra_credit') order by i.issued_on desc, i.invoice_no desc limit 100`,
      [],
    );
    return {
      invoices: result.rows.map((row) => this.listItem(this.toDetail(row))),
    };
  }
  async getAdmin(
    principal: Principal,
    invoiceId: string,
  ): Promise<InvoiceDetail> {
    this.assertAdmin(principal);
    const result = await this.pool.query<InvoiceRow>(
      `${detailQuery} where i.id = $1 and i.kind in ('initial','monthly','extra_credit')`,
      [invoiceId],
    );
    const row = result.rows[0];
    if (!row) throw new ApiError(404, "not_found");
    return this.toDetail(row);
  }
  getAdminPdf(principal: Principal, invoiceId: string) {
    this.assertAdmin(principal);
    return this.getPdf("admin", undefined, invoiceId);
  }

  private assertAdmin(principal: Principal) {
    if (principal.role !== "admin") throw new ApiError(404, "not_found");
    if (!principal.secondFactor) throw new ApiError(403, "forbidden");
  }
  private async getPdf(
    kind: "admin" | "customer",
    scope: CustomerScope | undefined,
    invoiceId: string,
  ): Promise<{ invoiceNo: string; content: Uint8Array }> {
    if (kind === "customer" && !scope) throw new ApiError(404, "not_found");
    if (this.config.nodeEnv === "production")
      throw new ApiError(503, "invoice_unavailable");
    const result = await this.pool.query<{
      invoice_no: string;
      content: Buffer;
    }>(
      `select i.invoice_no, d.content from invoices i join invoice_documents d on d.invoice_id = i.id
       join contracts c on c.id = i.contract_id where i.id = $1 and i.kind in ('initial','monthly','extra_credit')
       and ($2::text is null or c.customer_id::text = $2)`,
      [invoiceId, kind === "customer" ? (scope?.customerId ?? null) : null],
    );
    const row = result.rows[0];
    if (!row) throw new ApiError(404, "not_found");
    if (!/^[A-Za-z0-9-]{1,64}$/.test(row.invoice_no))
      throw new Error("Invalid persisted invoice number");
    return { invoiceNo: row.invoice_no, content: row.content };
  }

  private listItem(detail: InvoiceDetail): InvoiceListItem {
    const {
      id,
      invoiceNo,
      kind,
      status,
      issuedOn,
      dueOn,
      totalInclTax,
      totalExclTax,
      taxAmount,
      paymentMethod,
      preview,
    } = detail;
    return {
      id,
      invoiceNo,
      kind,
      status,
      issuedOn,
      dueOn,
      totalInclTax,
      totalExclTax,
      taxAmount,
      paymentMethod,
      preview,
    };
  }

  private toDetail(row: InvoiceRow): InvoiceDetail {
    const snapshot = safeObject(row.issuer_snapshot);
    const preview = snapshot.preview === true;
    const acceptedPlan = safeObject(snapshot.acceptedPlan);
    const issuer = {
      serviceName: snapshot.serviceName,
      companyName: snapshot.companyName,
      companyAddress: snapshot.companyAddress,
      invoiceRegistrationNo: snapshot.invoiceRegistrationNo ?? null,
      bankAccountName: snapshot.bankAccountName ?? null,
      bankAccountBranch: snapshot.bankAccountBranch ?? null,
      bankAccountType: snapshot.bankAccountType ?? null,
      bankAccountNumber: snapshot.bankAccountNumber ?? null,
    };
    const lines = Array.isArray(row.lines)
      ? row.lines.map((line) => safeObject(line))
      : [];
    return invoiceDetailSchema.parse({
      id: row.id,
      invoiceNo: row.invoice_no,
      kind: row.kind,
      status: row.status,
      issuedOn: row.issued_on,
      dueOn: row.due_on,
      totalInclTax: row.total_incl_tax,
      totalExclTax: row.total_excl_tax,
      taxAmount: row.tax_amount,
      paymentMethod: row.payment_method,
      preview,
      billingName: row.billing_name,
      billingAddress: row.billing_address,
      acceptedPlan,
      issuer,
      lines: lines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitPriceExclTax: line.unit_price_excl_tax,
        amountExclTax: line.amount_excl_tax,
        taxRate: Number(line.tax_rate),
      })),
    });
  }
}

const detailQuery = `select i.id, i.invoice_no, i.kind, i.status, i.payment_method,
       i.issued_on::text as issued_on, i.due_on::text as due_on,
       i.total_incl_tax, i.total_excl_tax, i.tax_amount, i.billing_name,
       coalesce(i.billing_address_snapshot, cst.billing_address) as billing_address,
       i.issuer_snapshot,
       coalesce(l.lines,
         '[]'::jsonb) as lines
  from invoices i join contracts c on c.id = i.contract_id join customers cst on cst.id = c.customer_id
  left join lateral (
    select jsonb_agg(jsonb_build_object('description', line.description, 'quantity', line.quantity,
      'unit_price_excl_tax', line.unit_price_excl_tax, 'amount_excl_tax', line.amount_excl_tax,
      'tax_rate', line.tax_rate) order by line.id) as lines
      from invoice_lines line where line.invoice_id = i.id
  ) l on true`;

function deterministicUuid(value: string): string {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
