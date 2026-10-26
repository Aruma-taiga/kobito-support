import { createHash } from "node:crypto";
import {
  type AdminIssuerSettings,
  type AdminIssuerSettingsResponse,
  adminIssuerSettingsSchema,
  isAdminIssuerSettingsReady,
  type UpdateAdminIssuerSettingsRequest,
} from "@kobito/shared";
import type { Pool } from "pg";
import { withTransaction } from "../../platform/db/transaction.js";
import { ApiError, type Principal } from "../../platform/types.js";

const settingKeys = [
  "service_name",
  "company_name",
  "company_address",
  "invoice_registration_no",
  "invoice_prefix",
  "bank_account",
] as const;

function valueText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function bankObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function canonicalSettings(settings: AdminIssuerSettings): string {
  return JSON.stringify({
    serviceName: settings.serviceName,
    companyName: settings.companyName,
    companyAddress: settings.companyAddress,
    invoiceRegistrationNo: settings.invoiceRegistrationNo,
    invoicePrefix: settings.invoicePrefix,
    bankAccount: {
      bankName: settings.bankAccount.bankName,
      branchName: settings.bankAccount.branchName,
      accountType: settings.bankAccount.accountType,
      accountNumber: settings.bankAccount.accountNumber,
      accountHolder: settings.bankAccount.accountHolder,
    },
  });
}

function revisionFor(settings: AdminIssuerSettings): string {
  return createHash("sha256").update(canonicalSettings(settings)).digest("hex");
}

function response(settings: AdminIssuerSettings): AdminIssuerSettingsResponse {
  return {
    settings,
    revision: revisionFor(settings),
    issuanceReady: isAdminIssuerSettingsReady(settings),
  };
}

export class IssuerSettingsRepository {
  constructor(private readonly pool: Pool) {}

  async get(): Promise<AdminIssuerSettingsResponse> {
    const result = await this.pool.query<{ key: string; value: unknown }>(
      "select key, value from settings where key = any($1::text[])",
      [settingKeys],
    );
    return response(this.composeSettings(result.rows));
  }

  async update(
    principal: Principal,
    request: UpdateAdminIssuerSettingsRequest,
  ): Promise<AdminIssuerSettingsResponse> {
    return withTransaction(this.pool, async (client) => {
      // Serialize all writers so the revision comparison and replacement are atomic.
      await client.query("select pg_advisory_xact_lock(902771, 1)");
      const result = await client.query<{ key: string; value: unknown }>(
        `select key, value from settings
          where key = any($1::text[])
          order by key
          for update`,
        [settingKeys],
      );
      const current = response(this.composeSettings(result.rows));
      if (current.revision !== request.expectedRevision) {
        throw new ApiError(409, "settings_revision_conflict");
      }
      const next = adminIssuerSettingsSchema.parse(request.settings);
      if (canonicalSettings(next) === canonicalSettings(current.settings)) {
        return current;
      }

      const values: ReadonlyArray<readonly [string, unknown]> = [
        ["service_name", next.serviceName],
        ["company_name", next.companyName],
        ["company_address", next.companyAddress],
        ["invoice_registration_no", next.invoiceRegistrationNo ?? ""],
        ["invoice_prefix", next.invoicePrefix],
        [
          "bank_account",
          {
            bank_name: next.bankAccount.bankName,
            branch_name: next.bankAccount.branchName,
            account_type: next.bankAccount.accountType,
            account_number: next.bankAccount.accountNumber,
            account_holder: next.bankAccount.accountHolder,
          },
        ],
      ];
      for (const [key, value] of values) {
        await client.query(
          `insert into settings (key, value) values ($1, $2::jsonb)
           on conflict (key) do update set value = excluded.value, updated_at = now()`,
          [key, JSON.stringify(value)],
        );
      }
      await client.query(
        `insert into audit_logs (actor, action, target_type, target_id, detail)
         values ($1, 'issuer_settings.updated', 'settings', 'issuer_configuration', '{}'::jsonb)`,
        [principal.authUserId],
      );
      return response(next);
    });
  }

  private composeSettings(
    rows: ReadonlyArray<{ key: string; value: unknown }>,
  ): AdminIssuerSettings {
    const values = new Map(rows.map((row) => [row.key, row.value]));
    const bank = bankObject(values.get("bank_account"));
    const registrationNo = valueText(values.get("invoice_registration_no"));
    return adminIssuerSettingsSchema.parse({
      serviceName: valueText(values.get("service_name")),
      companyName: valueText(values.get("company_name")),
      companyAddress: valueText(values.get("company_address")),
      invoiceRegistrationNo: registrationNo || null,
      invoicePrefix: valueText(values.get("invoice_prefix")),
      bankAccount: {
        bankName: valueText(bank.bank_name),
        branchName: valueText(bank.branch_name),
        accountType: valueText(bank.account_type),
        accountNumber: valueText(bank.account_number),
        accountHolder: valueText(bank.account_holder),
      },
    });
  }
}
