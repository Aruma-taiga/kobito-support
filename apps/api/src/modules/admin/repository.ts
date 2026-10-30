import type {
  AdminApplicationQueueQuery,
  AdminApplicationQueueResponse,
  AdminCustomerDetail,
  DeclineApplicationRequest,
  DeclineApplicationResponse,
} from "@kobito/shared";
import { canTransition } from "@kobito/shared";
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
  price_incl_tax: number | null;
  credits: number | null;
  payment_method: "card" | "konbini" | "bank_transfer";
  status: AdminApplicationQueueResponse["items"][number]["status"];
  shown_terms: unknown;
}

const latestApplicationsCte = `
  with latest_applications as (
    select distinct on (a.customer_id)
           a.customer_id, c.id as contract_id, a.id as application_id,
           a.submitted_at, p.name as plan_name, p.price_incl_tax, p.credits,
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
              plan_name, price_incl_tax, credits, payment_method, status,
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
        priceInclTax: applicationSnapshotValue(
          objectSnapshot(row.shown_terms),
          "priceInclTax",
          row.price_incl_tax,
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
              a.shown_terms, a.referral_code, a.free_text, a.review_result,
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
      review_result: "approved" | "declined" | null;
      rejection_note: string | null;
    }>(
      `select a.id as application_id, c.id as contract_id, c.customer_id,
              c.status as contract_status, a.review_result, a.rejection_note
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
