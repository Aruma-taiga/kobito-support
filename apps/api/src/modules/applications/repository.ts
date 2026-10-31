import { createHash } from "node:crypto";
import {
  type ApplicationReceipt,
  type ApplicationSubmission,
  applicationPolicyConditions,
  invoiceTotals,
  type PublicPartner,
  type PublicPlan,
} from "@kobito/shared";
import type { Pool, PoolClient } from "pg";
import type { RuntimeConfig } from "../../platform/config.js";
import { ApiError } from "../../platform/types.js";
import type {
  PublicApplicationCatalog,
  SubmitApplicationCommand,
} from "./contracts.js";
import { buildPublicCatalog } from "./policy.js";

interface PlanRow {
  id: string;
  code: PublicPlan["code"];
  name: string;
  price_excl_tax: number | null;
  credits: number | null;
  is_custom: boolean;
}

interface LegalSettingRow {
  value: unknown;
}

export interface ApplicationsRepositoryPort {
  getPublicCatalog(config: RuntimeConfig): Promise<PublicApplicationCatalog>;
  getPublicPartner(code: string): Promise<PublicPartner>;
  submit(
    command: SubmitApplicationCommand,
    config: RuntimeConfig,
    operationsEmail?: string,
  ): Promise<ApplicationReceipt>;
}

export class ApplicationsRepository implements ApplicationsRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async getPublicCatalog(
    config: RuntimeConfig,
  ): Promise<PublicApplicationCatalog> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "set transaction isolation level repeatable read read only",
      );
      const catalog = await this.loadPublicCatalog(client, config);
      await client.query("commit");
      return catalog;
    } catch {
      try {
        await client.query("rollback");
      } catch {
        // Keep database details out of the HTTP error path.
      }
      throw new Error("Public application catalog is unavailable");
    } finally {
      client.release();
    }
  }

  async getPublicPartner(code: string): Promise<PublicPartner> {
    const result = await this.pool.query<{ code: string; name: string }>(
      `select referral_code as code, name
         from partners
        where referral_code = $1 and active = true`,
      [code],
    );
    const partner = result.rows[0];
    if (!partner) throw new ApiError(404, "not_found");
    return partner;
  }

  async submit(
    command: SubmitApplicationCommand,
    config: RuntimeConfig,
    operationsEmail?: string,
  ): Promise<ApplicationReceipt> {
    const requestHash = createSubmissionHash(command.submission);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await this.submitInTransaction(
        client,
        command,
        requestHash,
        config,
        operationsEmail,
      );
      await client.query("commit");
      return result;
    } catch (error) {
      try {
        await client.query("rollback");
      } catch {
        // Preserve the safe domain error and suppress driver details.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async submitInTransaction(
    client: PoolClient,
    command: SubmitApplicationCommand,
    requestHash: string,
    config: RuntimeConfig,
    operationsEmail?: string,
  ): Promise<ApplicationReceipt> {
    const identityUid = command.identity.uid;
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`application-key:${command.idempotencyKey}`],
    );

    const previous = await client.query<{
      auth_user_id: string;
      request_hash: string;
      application_id: string;
      contract_id: string | null;
    }>(
      `select submission.auth_user_id, submission.request_hash,
              submission.application_id, contract.id as contract_id
         from application_submission_keys as submission
         left join contracts as contract
           on contract.application_id = submission.application_id
        where submission.request_key = $1`,
      [command.idempotencyKey],
    );
    const previousRequest = previous.rows[0];
    if (previousRequest) {
      if (
        previousRequest.auth_user_id !== identityUid ||
        previousRequest.request_hash !== requestHash ||
        !previousRequest.contract_id
      ) {
        throw new ApiError(409, "application_conflict");
      }
      return {
        applicationId: previousRequest.application_id,
        contractId: previousRequest.contract_id,
        status: "under_review",
        replayed: true,
      };
    }

    await client.query(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`application-user:${identityUid}`],
    );

    // Freeze the offer/policy inputs until the DB-only submission transaction commits.
    await client.query("lock table plans, settings in share mode");
    const catalog = await this.loadPublicCatalog(client, config);
    const applicationConfig = catalog.application;
    if (!applicationConfig) {
      throw new ApiError(503, "application_unavailable");
    }
    if (command.submission.displayVersion !== catalog.displayVersion) {
      throw new ApiError(409, "offer_changed");
    }
    if (
      !applicationConfig.availablePaymentMethods.includes(
        command.submission.paymentMethod as "card" | "bank_transfer",
      )
    ) {
      throw new ApiError(422, "validation_error");
    }
    const plan = catalog.plans.find(
      ({ code }) => code === command.submission.planCode,
    );
    if (!plan) throw new ApiError(422, "validation_error");

    let partner: PublicPartner | undefined;
    let partnerId: string | null = null;
    let partnerReward: {
      type: "appointment" | "closing";
      rate: string;
    } | null = null;
    const referralCode = command.submission.referralCode;
    if (referralCode) {
      const partnerResult = await client.query<{
        id: string;
        code: string;
        name: string;
        reward_type: "appointment" | "closing";
        reward_rate: string;
      }>(
        `select id, referral_code as code, name, reward_type,
                reward_rate::text as reward_rate
           from partners
          where referral_code = $1 and active = true for share`,
        [referralCode],
      );
      const partnerRow = partnerResult.rows[0];
      if (!partnerRow || command.submission.consentPartnerShare !== true) {
        throw new ApiError(422, "validation_error");
      }
      partnerId = partnerRow.id;
      partner = { code: partnerRow.code, name: partnerRow.name };
      partnerReward = {
        type: partnerRow.reward_type,
        rate: partnerRow.reward_rate,
      };
    }

    const accountResult = await client.query<{
      role: "customer" | "admin";
      customer_id: string | null;
    }>(
      `select role, customer_id from user_accounts
        where auth_user_id = $1 for update`,
      [identityUid],
    );
    const existingAccount = accountResult.rows[0];
    if (existingAccount?.role === "admin") {
      throw new ApiError(409, "application_conflict");
    }

    let customerId: string;
    if (existingAccount) {
      if (!existingAccount.customer_id) {
        throw new ApiError(409, "application_conflict");
      }
      const customerResult = await client.query<{
        id: string;
        email: string;
      }>(
        `select id, email from customers
          where id = $1 and anonymized_at is null for update`,
        [existingAccount.customer_id],
      );
      const existingCustomer = customerResult.rows[0];
      if (
        !existingCustomer ||
        existingCustomer.email.trim().toLowerCase() !==
          command.submission.email.trim().toLowerCase()
      ) {
        throw new ApiError(409, "application_conflict");
      }
      const priorApplication = await client.query(
        "select 1 from applications where customer_id = $1 limit 1",
        [existingCustomer.id],
      );
      if (priorApplication.rowCount) {
        throw new ApiError(409, "application_conflict");
      }
      customerId = existingCustomer.id;
      await this.updateCustomer(client, customerId, command.submission);
    } else {
      customerId = await this.insertCustomer(client, command.submission);
      await client.query(
        `insert into user_accounts (auth_user_id, customer_id, role)
         values ($1, $2, 'customer')`,
        [identityUid, customerId],
      );
    }

    const shownTerms = createShownTerms(
      catalog,
      plan,
      command.submission,
      partner,
    );
    const applicationResult = await client.query<{ id: string }>(
      `insert into applications (
         customer_id, plan_id, payment_method, referral_code, partner_id,
         free_text, terms_version, privacy_version, disclosure_version,
         consent_business_use, consent_terms, consent_marketing,
         consent_partner_share, shown_terms, ip_address, user_agent
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, null, $15
       ) returning id`,
      [
        customerId,
        plan.id,
        command.submission.paymentMethod,
        referralCode ?? null,
        partnerId,
        command.submission.freeText ?? null,
        applicationConfig.terms.version,
        applicationConfig.privacy.version,
        applicationConfig.disclosure.version,
        command.submission.consentBusinessUse,
        command.submission.consentTerms,
        command.submission.consentMarketing,
        partner ? true : null,
        JSON.stringify(shownTerms),
        command.requestContext.userAgent?.slice(0, 512) ?? null,
      ],
    );
    const applicationId = applicationResult.rows[0]?.id;
    if (!applicationId) throw new Error("Application insert returned no ID");

    const contractResult = await client.query<{ id: string }>(
      `insert into contracts (customer_id, application_id, plan_id, payment_method, status)
       values ($1, $2, $3, $4, 'under_review') returning id`,
      [customerId, applicationId, plan.id, command.submission.paymentMethod],
    );
    const contractId = contractResult.rows[0]?.id;
    if (!contractId) throw new Error("Contract insert returned no ID");

    if (partnerId && partnerReward) {
      await client.query(
        `insert into referrals (partner_id, contract_id, reward_type, reward_rate)
         values ($1, $2, $3, $4)`,
        [partnerId, contractId, partnerReward.type, partnerReward.rate],
      );
    }

    await client.query(
      `insert into application_submission_keys
         (request_key, auth_user_id, application_id, request_hash)
       values ($1, $2, $3, $4)`,
      [command.idempotencyKey, identityUid, applicationId, requestHash],
    );

    await this.queueReceiptNotification(client, customerId, applicationId);
    if (operationsEmail) {
      await this.queueOperationsNotification(
        client,
        applicationId,
        operationsEmail,
      );
    }

    return {
      applicationId,
      contractId,
      status: "under_review",
      replayed: false,
    };
  }

  private async loadPublicCatalog(
    client: PoolClient,
    config: RuntimeConfig,
  ): Promise<PublicApplicationCatalog> {
    const planRows = await client.query<PlanRow>(
      `select distinct on (code)
              id, code, name, price_excl_tax, credits, is_custom
         from plans
        where valid_from <= (now() at time zone 'Asia/Tokyo')::date
          and (valid_to is null or valid_to >= (now() at time zone 'Asia/Tokyo')::date)
        order by code, valid_from desc, id desc`,
    );
    const settings = await client.query<LegalSettingRow>(
      "select value from settings where key = 'application_legal_documents'",
    );
    const plans: PublicPlan[] = planRows.rows.map((plan) => ({
      id: plan.id,
      code: plan.code,
      name: plan.name,
      priceExclTax: plan.price_excl_tax,
      credits: plan.credits,
      isCustom: plan.is_custom,
    }));
    return buildPublicCatalog(plans, settings.rows[0]?.value, config);
  }

  private async insertCustomer(
    client: PoolClient,
    submission: ApplicationSubmission,
  ): Promise<string> {
    const result = await client.query<{ id: string }>(
      `insert into customers (
         shop_name, contact_name, billing_name, billing_address,
         email, phone, line_display_name, invoice_reg_no, marketing_opt_in
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [
        submission.shopName,
        submission.contactName,
        submission.billingName,
        submission.billingAddress,
        submission.email,
        submission.phone ?? null,
        submission.lineDisplayName ?? null,
        submission.invoiceRegistrationNo ?? null,
        submission.consentMarketing,
      ],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error("Customer insert returned no ID");
    return id;
  }

  private async updateCustomer(
    client: PoolClient,
    customerId: string,
    submission: ApplicationSubmission,
  ): Promise<void> {
    await client.query(
      `update customers
          set shop_name = $2, contact_name = $3, billing_name = $4,
              billing_address = $5, phone = $6, line_display_name = $7,
              invoice_reg_no = $8, marketing_opt_in = $9
        where id = $1`,
      [
        customerId,
        submission.shopName,
        submission.contactName,
        submission.billingName,
        submission.billingAddress,
        submission.phone ?? null,
        submission.lineDisplayName ?? null,
        submission.invoiceRegistrationNo ?? null,
        submission.consentMarketing,
      ],
    );
  }

  private async queueReceiptNotification(
    client: PoolClient,
    customerId: string,
    applicationId: string,
  ): Promise<void> {
    await client.query(
      `insert into notifications (customer_id, kind, channel, dedupe_key, scheduled_at, payload)
       values ($1, 'NT-01', 'email', $2, now(), $3::jsonb)`,
      [
        customerId,
        `NT-01:application:${applicationId}:customer`,
        JSON.stringify({ applicationId, recipient: "customer" }),
      ],
    );
  }

  private async queueOperationsNotification(
    client: PoolClient,
    applicationId: string,
    recipient: string,
  ): Promise<void> {
    await client.query(
      `insert into notifications (customer_id, kind, channel, dedupe_key, scheduled_at, payload)
       values (null, 'S-03', 'email', $1, now(), $2::jsonb)`,
      [
        `S-03:application:${applicationId}:operations`,
        JSON.stringify({ applicationId, recipient }),
      ],
    );
  }
}

export function createSubmissionHash(
  submission: ApplicationSubmission,
): string {
  const canonical = Object.fromEntries(
    Object.entries(submission).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function createShownTerms(
  catalog: PublicApplicationCatalog,
  plan: PublicPlan,
  submission: ApplicationSubmission,
  partner?: PublicPartner,
): Record<string, unknown> {
  const price =
    plan.priceExclTax === null ? null : invoiceTotals([plan.priceExclTax]);
  return {
    displayVersion: catalog.displayVersion,
    planId: plan.id,
    planCode: plan.code,
    planName: plan.name,
    priceExclTax: plan.priceExclTax,
    credits: plan.credits,
    taxYen: price?.taxYen ?? null,
    priceInclTax: price?.inclYen ?? null,
    paymentMethod: submission.paymentMethod,
    terms: catalog.application?.terms ?? null,
    privacy: catalog.application?.privacy ?? null,
    disclosure: catalog.application?.disclosure ?? null,
    initialDueDays: applicationPolicyConditions.initialDueDays,
    extraCreditExclYen: applicationPolicyConditions.extraCreditExclYen,
    monthlyPrepaid: applicationPolicyConditions.monthlyPrepaid,
    periodBasis: applicationPolicyConditions.periodBasis,
    rollover: applicationPolicyConditions.rollover,
    cancellation: applicationPolicyConditions.cancellation,
    ...(partner
      ? {
          partner: {
            code: partner.code,
            name: partner.name,
            consentPartnerShare: true,
          },
        }
      : {}),
  };
}
