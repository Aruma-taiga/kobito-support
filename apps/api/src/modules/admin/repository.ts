import type {
  AdminApplicationQueueQuery,
  AdminApplicationQueueResponse,
  AdminCancellation,
  AdminCustomerDetail,
  AdminPaymentReviewsQuery,
  AdminPaymentReviewsResponse,
  DeclineApplicationRequest,
  DeclineApplicationResponse,
  UpdateCancellationChecklist,
} from "@kobito/shared";
import {
  adminPaymentReviewsResponseSchema,
  canTransition,
  retentionDueDate,
} from "@kobito/shared";
import type { Pool, PoolClient } from "pg";
import { withAdminAudit } from "../../platform/audit.js";
import { ApiError, type Principal } from "../../platform/types.js";
import type { AdminModule } from "./contracts.js";

interface QueueRow {
  customer_id: string;
  shop_name: string;
  contact_name: string;
  email: string;
  submitted_at: Date;
  plan_name: string;
  price_excl_tax: number | null;
  credits: number | null;
  payment_method: "card" | "konbini" | "bank_transfer";
  status: AdminApplicationQueueResponse["items"][number]["status"];
  shown_terms: unknown;
}

const latestApplicationsCte = `
  with latest_applications as (
    select distinct on (a.customer_id)
           a.customer_id, c.id as contract_id, a.id as application_id,
           a.submitted_at, p.name as plan_name, p.price_excl_tax, p.credits,
           a.shown_terms,
           c.status, c.payment_method, customer.shop_name, customer.contact_name,
           customer.email
      from applications a
      join contracts c on c.application_id = a.id
      join customers customer on customer.id = a.customer_id
      join plans p on p.id = a.plan_id
     order by a.customer_id, a.submitted_at desc, a.id desc
  ), filtered_applications as (
    select * from latest_applications
     where ($1::text is null or status = $1)
       and ($2::text is null
         or strpos(lower(shop_name), lower($2)) > 0
         or strpos(lower(contact_name), lower($2)) > 0
         or strpos(lower(email), lower($2)) > 0)
  )`;

function isoDate(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function objectSnapshot(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function applicationSnapshotValue<T>(
  snapshot: Record<string, unknown>,
  key: string,
  legacyValue: T,
  isValid: (value: unknown) => value is T,
): T {
  if (!Object.hasOwn(snapshot, key)) return legacyValue;
  const value = snapshot[key];
  if (!isValid(value)) throw new Error("Invalid application plan snapshot");
  return value;
}

function nullableNonnegativeInteger(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" && Number.isInteger(value) && value >= 0)
  );
}

export class AdminRepository implements AdminModule {
  constructor(private readonly pool: Pool) {}

  async getCancellation(contractId: string): Promise<AdminCancellation> {
    const row = await this.readCancellation(this.pool, contractId);
    return row;
  }

  scheduleCancellation(
    principal: Principal,
    contractId: string,
  ): Promise<AdminCancellation> {
    return withAdminAudit(
      this.pool,
      principal,
      {
        action: "contract.cancellation_scheduled",
        targetType: "contract",
        targetId: contractId,
        detail: { fromStatus: "active", toStatus: "cancel_scheduled" },
      },
      async (client) => {
        const locked = await client.query<{
          id: string;
          customer_id: string;
          status: string;
          ends_on: string | null;
        }>(
          "select id,customer_id,status,ends_on::text ends_on from contracts where id=$1 for update",
          [contractId],
        );
        const contract = locked.rows[0];
        if (!contract) throw new ApiError(404, "not_found");
        if (contract.status === "cancel_scheduled")
          return this.readCancellation(client, contractId);
        if (contract.status !== "active") throw new ApiError(409, "conflict");
        const today = await client.query<{ day: string }>(
          "select to_char(clock_timestamp() at time zone 'Asia/Tokyo','YYYY-MM-DD') as day",
        );
        const period = await client.query<{ ends_on: string }>(
          "select ends_on::text ends_on from billing_periods where contract_id=$1 and starts_on <= $2::date and ends_on >= $2::date order by seq desc limit 1",
          [contractId, today.rows[0]?.day],
        );
        if (!period.rows[0]) throw new ApiError(409, "conflict");
        const endsOn = period.rows[0].ends_on;
        await client.query(
          "update contracts set status='cancel_scheduled',cancel_requested_at=clock_timestamp(),ends_on=$2::date where id=$1",
          [contractId, endsOn],
        );
        await client.query(
          `insert into notifications(customer_id,kind,channel,dedupe_key,scheduled_at,payload)
         values($1,'NT-08','email',$2,transaction_timestamp(),$3::jsonb)
         on conflict (dedupe_key) do nothing`,
          [
            contract.customer_id,
            `NT-08:${contractId}`,
            JSON.stringify({ endsOn }),
          ],
        );
        const endNoticeAt = await client.query<{ at: Date }>(
          "select ((($1::date + 1)::timestamp + interval '8 hours') at time zone 'Asia/Tokyo') at",
          [endsOn],
        );
        await client.query(
          `insert into notifications(customer_id,kind,channel,dedupe_key,scheduled_at,payload)
         values($1,'NT-09','email',$2,$3,$4::jsonb) on conflict (dedupe_key) do nothing`,
          [
            contract.customer_id,
            `NT-09:${contractId}`,
            endNoticeAt.rows[0]?.at,
            JSON.stringify({ endsOn, contractId }),
          ],
        );
        return this.readCancellation(client, contractId);
      },
    );
  }

  revokeCancellation(
    principal: Principal,
    contractId: string,
  ): Promise<AdminCancellation> {
    return withAdminAudit(
      this.pool,
      principal,
      {
        action: "contract.cancellation_revoked",
        targetType: "contract",
        targetId: contractId,
        detail: { fromStatus: "cancel_scheduled", toStatus: "active" },
      },
      async (client) => {
        const locked = await client.query<{
          status: string;
          ends_on: string | null;
        }>(
          "select status,ends_on::text ends_on from contracts where id=$1 for update",
          [contractId],
        );
        const contract = locked.rows[0];
        if (!contract) throw new ApiError(404, "not_found");
        if (contract.status !== "cancel_scheduled")
          throw new ApiError(409, "conflict");
        const today = await client.query<{ day: string }>(
          "select to_char(clock_timestamp() at time zone 'Asia/Tokyo','YYYY-MM-DD') as day",
        );
        if (
          contract.ends_on &&
          today.rows[0] &&
          today.rows[0].day > contract.ends_on
        )
          throw new ApiError(409, "conflict");
        await client.query(
          "update contracts set status='active',cancel_requested_at=null,ends_on=null where id=$1",
          [contractId],
        );
        await client.query(
          "update notifications set attempts=3,last_error='cancelled' where dedupe_key=$1 and kind='NT-09' and sent_at is null",
          [`NT-09:${contractId}`],
        );
        return this.readCancellation(client, contractId);
      },
    );
  }

  updateCancellationChecklist(
    principal: Principal,
    contractId: string,
    checklist: UpdateCancellationChecklist,
  ): Promise<AdminCancellation> {
    return withAdminAudit(
      this.pool,
      principal,
      {
        action: "contract.cancellation_checklist_updated",
        targetType: "contract",
        targetId: contractId,
        detail: {
          removalRequested: String(checklist.removalRequested),
          removablePermissionsRemoved: String(
            checklist.removablePermissionsRemoved,
          ),
          checklistComplete: String(checklist.complete),
        },
      },
      async (client) => {
        const exists = await client.query(
          "select id from contracts where id=$1",
          [contractId],
        );
        if (!exists.rowCount) throw new ApiError(404, "not_found");
        return {
          ...(await this.readCancellation(client, contractId)),
          checklist,
        };
      },
    );
  }

  private async readCancellation(
    client: Pool | PoolClient,
    contractId: string,
  ): Promise<AdminCancellation> {
    const result = await client.query<{
      id: string;
      status: AdminCancellation["status"];
      ends_on: string | null;
      current_period_ends_on: string | null;
    }>(
      `select c.id,c.status,c.ends_on::text ends_on,
       (select bp.ends_on::text from billing_periods bp where bp.contract_id=c.id and bp.starts_on <= to_char(transaction_timestamp() at time zone 'Asia/Tokyo','YYYY-MM-DD')::date and bp.ends_on >= to_char(transaction_timestamp() at time zone 'Asia/Tokyo','YYYY-MM-DD')::date order by bp.seq desc limit 1) current_period_ends_on
       from contracts c where c.id=$1`,
      [contractId],
    );
    const row = result.rows[0];
    if (!row) throw new ApiError(404, "not_found");
    const audit = await client.query<{
      detail: Record<string, unknown> | null;
    }>(
      "select detail from audit_logs where target_type='contract' and target_id=$1 and action='contract.cancellation_checklist_updated' order by at desc,id desc limit 1",
      [contractId],
    );
    const detail = audit.rows[0]?.detail ?? {};
    return {
      contractId: row.id,
      status: row.status,
      endsOn: row.ends_on,
      currentPeriodEndsOn: row.current_period_ends_on,
      checklist: {
        removalRequested: detail.removalRequested === "true",
        removablePermissionsRemoved:
          detail.removablePermissionsRemoved === "true",
        complete: detail.checklistComplete === "true",
      },
    };
  }

  async listPaymentReviews(
    query: AdminPaymentReviewsQuery,
  ): Promise<AdminPaymentReviewsResponse> {
    const events = await this.pool.query<{
      event_id: string;
      event_type: string;
      invoice_no: string | null;
      received_at: Date;
      reason: string;
      notification_amount: string | null;
      invoice_total: number | null;
      shop_name: string | null;
    }>(
      `select e.id as event_id, e.type as event_type,
              e.payload->'data'->>'external_order_num' as invoice_no,
              e.received_at, split_part(e.error, ':', 2) as reason,
              case when jsonb_typeof(e.payload->'data'->'total') = 'number'
                   then e.payload->'data'->>'total' end as notification_amount,
              i.total_incl_tax as invoice_total, c.shop_name
         from komoju_events e
         left join invoices i on i.invoice_no=e.payload->'data'->>'external_order_num'
         left join contracts co on co.id=i.contract_id
         left join customers c on c.id=co.customer_id
        where e.error like 'review:%'
        order by e.received_at desc, e.id desc limit $1`,
      [query.limit],
    );
    const failedInvoices = await this.pool.query<{
      invoice_id: string;
      invoice_no: string;
      shop_name: string;
      total_incl_tax: number;
      reason_code: string | null;
      due_on: string | null;
    }>(
      `select i.id as invoice_id, i.invoice_no, c.shop_name,
              i.total_incl_tax, failure.reason_code, i.due_on::text as due_on
         from invoices i
         join contracts co on co.id=i.contract_id
         join customers c on c.id=co.customer_id
         left join lateral (
           select split_part(e.error, ':', 2) as reason_code
             from komoju_events e
            where e.error like 'failure:%'
              and e.payload->'data'->>'external_order_num'=i.invoice_no
            order by e.received_at desc, e.id desc limit 1
         ) failure on true
        where i.status='failed'
        order by i.created_at desc, i.id desc limit $1`,
      [query.limit],
    );
    const counts = await this.pool.query<{
      event_count: number;
      failed_invoice_count: number;
    }>(
      `select (select count(*)::int from komoju_events where error like 'review:%') as event_count,
              (select count(*)::int from invoices where status='failed') as failed_invoice_count`,
    );
    return adminPaymentReviewsResponseSchema.parse({
      events: events.rows.map((row) => ({
        eventId: row.event_id,
        eventType: row.event_type,
        invoiceNo: row.invoice_no,
        receivedAt: isoDate(row.received_at),
        reason: ["amount_mismatch", "invoice_not_found"].includes(row.reason)
          ? (row.reason as "amount_mismatch" | "invoice_not_found")
          : "other",
        notificationAmount:
          row.notification_amount === null
            ? null
            : Number(row.notification_amount),
        invoiceTotal: row.invoice_total,
        shopName: row.shop_name,
      })),
      failedInvoices: failedInvoices.rows.map((row) => ({
        invoiceId: row.invoice_id,
        invoiceNo: row.invoice_no,
        shopName: row.shop_name,
        totalInclTax: row.total_incl_tax,
        reasonCode: [
          "payment.failed",
          "payment.expired",
          "payment.cancelled",
          "subscription.failed",
        ].includes(row.reason_code ?? "")
          ? (row.reason_code as AdminPaymentReviewsResponse["failedInvoices"][number]["reasonCode"])
          : "unknown",
        dueOn: row.due_on,
      })),
      eventCount: counts.rows[0]?.event_count ?? 0,
      failedInvoiceCount: counts.rows[0]?.failed_invoice_count ?? 0,
    });
  }

  async listApplications(
    query: AdminApplicationQueueQuery,
  ): Promise<AdminApplicationQueueResponse> {
    const status = query.status ?? null;
    const search = query.q?.trim() || null;
    const countResult = await this.pool.query<{ total: number }>(
      `${latestApplicationsCte}
       select count(*)::int as total from filtered_applications`,
      [status, search],
    );
    const result = await this.pool.query<QueueRow>(
      `${latestApplicationsCte}
       select customer_id, shop_name, contact_name, email, submitted_at,
              plan_name, price_excl_tax, credits, payment_method, status,
              shown_terms
         from filtered_applications
        order by submitted_at desc, customer_id
        limit $3 offset $4`,
      [status, search, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return {
      items: result.rows.map((row) => ({
        customerId: row.customer_id,
        shopName: row.shop_name,
        contactName: row.contact_name,
        email: row.email,
        submittedAt: isoDate(row.submitted_at),
        planName: applicationSnapshotValue(
          objectSnapshot(row.shown_terms),
          "planName",
          row.plan_name,
          (value): value is string => typeof value === "string",
        ),
        priceExclTax: applicationSnapshotValue(
          objectSnapshot(row.shown_terms),
          "priceExclTax",
          row.price_excl_tax,
          nullableNonnegativeInteger,
        ),
        credits: applicationSnapshotValue(
          objectSnapshot(row.shown_terms),
          "credits",
          row.credits,
          nullableNonnegativeInteger,
        ),
        paymentMethod: row.payment_method,
        status: row.status,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total: countResult.rows[0]?.total ?? 0,
    };
  }

  async getCustomerDetail(customerId: string): Promise<AdminCustomerDetail> {
    const result = await this.pool.query<{
      customer_id: string;
      shop_name: string;
      contact_name: string;
      email: string;
      phone: string | null;
      billing_name: string;
      billing_address: string;
      invoice_reg_no: string | null;
      application_id: string;
      submitted_at: Date;
      terms_version: string;
      privacy_version: string;
      disclosure_version: string;
      consent_business_use: boolean;
      consent_terms: boolean;
      consent_marketing: boolean;
      consent_partner_share: boolean | null;
      shown_terms: unknown;
      payment_method: AdminCustomerDetail["application"]["paymentMethod"];
      referral_code: string | null;
      free_text: string | null;
      review_result: "approved" | "declined" | null;
      rejection_note: string | null;
      contract_id: string;
      status: AdminCustomerDetail["contract"]["status"];
    }>(
      `select customer.id as customer_id, customer.shop_name, customer.contact_name,
              customer.email, customer.phone, customer.billing_name,
              customer.billing_address, customer.invoice_reg_no,
              a.id as application_id, a.submitted_at, a.terms_version,
              a.privacy_version, a.disclosure_version, a.consent_business_use,
              a.consent_terms, a.consent_marketing, a.consent_partner_share,
              a.shown_terms, a.payment_method, a.referral_code, a.free_text, a.review_result,
              a.rejection_note, c.id as contract_id, c.status
         from customers customer
         join lateral (
           select application.* from applications application
            where application.customer_id = customer.id
            order by application.submitted_at desc, application.id desc
            limit 1
         ) a on true
         join contracts c on c.application_id = a.id
        where customer.id = $1`,
      [customerId],
    );
    const row = result.rows[0];
    if (!row) throw new ApiError(404, "not_found");
    return {
      customer: {
        id: row.customer_id,
        shopName: row.shop_name,
        contactName: row.contact_name,
        email: row.email,
        phone: row.phone,
        billingName: row.billing_name,
        billingAddress: row.billing_address,
        invoiceRegistrationNo: row.invoice_reg_no,
      },
      application: {
        id: row.application_id,
        submittedAt: isoDate(row.submitted_at),
        paymentMethod: row.payment_method,
        termsVersion: row.terms_version,
        privacyVersion: row.privacy_version,
        disclosureVersion: row.disclosure_version,
        consentBusinessUse: row.consent_business_use,
        consentTerms: row.consent_terms,
        consentMarketing: row.consent_marketing,
        consentPartnerShare: row.consent_partner_share,
        shownTerms: objectSnapshot(row.shown_terms),
        referralCode: row.referral_code,
        freeText: row.free_text,
        reviewResult: row.review_result,
        rejectionNote: row.rejection_note,
      },
      contract: { id: row.contract_id, status: row.status },
    };
  }

  declineApplication(
    principal: Principal,
    applicationId: string,
    request: DeclineApplicationRequest,
  ): Promise<DeclineApplicationResponse> {
    return withAdminAudit(
      this.pool,
      principal,
      {
        action: "application.declined",
        targetType: "application",
        targetId: applicationId,
        detail: { fromStatus: "under_review", toStatus: "declined" },
      },
      (client) => this.declineInTransaction(client, applicationId, request),
    );
  }

  private async declineInTransaction(
    client: PoolClient,
    applicationId: string,
    request: DeclineApplicationRequest,
  ): Promise<DeclineApplicationResponse> {
    const result = await client.query<{
      application_id: string;
      contract_id: string;
      customer_id: string;
      contract_status: AdminCustomerDetail["contract"]["status"];
      transition_date: string;
      review_result: "approved" | "declined" | null;
      rejection_note: string | null;
    }>(
      `select a.id as application_id, c.id as contract_id, c.customer_id,
              c.status as contract_status, a.review_result, a.rejection_note,
              to_char(transaction_timestamp() at time zone 'Asia/Tokyo','YYYY-MM-DD') transition_date
         from applications a
         join contracts c on c.application_id = a.id
        where a.id = $1
        for update of a, c`,
      [applicationId],
    );
    const row = result.rows[0];
    if (!row) throw new ApiError(404, "not_found");

    if (
      row.contract_status === "declined" &&
      row.review_result === "declined"
    ) {
      if (row.rejection_note !== (request.rejectionNote ?? null)) {
        throw new ApiError(409, "application_conflict");
      }
      return {
        applicationId: row.application_id,
        contractId: row.contract_id,
        status: "declined",
        replayed: true,
      };
    }
    if (
      row.review_result !== null ||
      !canTransition(row.contract_status, "declined")
    ) {
      throw new ApiError(409, "application_conflict");
    }

    await client.query(
      `update applications
          set reviewed_at = now(), review_result = 'declined', rejection_note = $2
        where id = $1`,
      [applicationId, request.rejectionNote ?? null],
    );
    await client.query(
      "update contracts set status = 'declined' where id = $1",
      [row.contract_id],
    );
    await client.query(
      "update customers set deletion_due_on=coalesce(deletion_due_on,$2::date) where id=$1",
      [row.customer_id, retentionDueDate("declined", row.transition_date)],
    );
    await client.query(
      `insert into notifications (customer_id, kind, channel, dedupe_key, scheduled_at, payload)
       values ($1, 'application_declined', 'email', $2, now(), $3::jsonb)`,
      [
        row.customer_id,
        `application_declined:${applicationId}`,
        JSON.stringify({ applicationId }),
      ],
    );

    return {
      applicationId: row.application_id,
      contractId: row.contract_id,
      status: "declined",
      replayed: false,
    };
  }
}
