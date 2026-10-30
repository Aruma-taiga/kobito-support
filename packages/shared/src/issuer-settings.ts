import { z } from "zod";
import { webMessages } from "./messages.js";

function boundedText(max: number) {
  return z
    .string()
    .refine(
      (value) =>
        Array.from(value).every((character) => {
          const code = character.codePointAt(0) ?? 0;
          return code > 31 && code !== 127;
        }),
      webMessages.issuerSettingsControlCharacterError,
    )
    .trim()
    .max(max);
}

const requiredText = (max: number) => boundedText(max).min(1);
const revisionSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const adminIssuerSettingsSchema = z
  .object({
    serviceName: requiredText(120),
    companyName: boundedText(160),
    companyAddress: boundedText(300),
    invoiceRegistrationNo: z
      .string()
      .regex(/^T\d{13}$/)
      .nullable(),
    invoicePrefix: requiredText(20).regex(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/),
    bankAccount: z
      .object({
        bankName: boundedText(100),
        branchName: boundedText(100),
        accountType: boundedText(20),
        accountNumber: boundedText(32),
        accountHolder: boundedText(120),
      })
      .strict(),
  })
  .strict();
export type AdminIssuerSettings = z.infer<typeof adminIssuerSettingsSchema>;

export const adminIssuerSettingsResponseSchema = z
  .object({
    settings: adminIssuerSettingsSchema,
    revision: revisionSchema,
    issuanceReady: z.boolean(),
  })
  .strict();
export type AdminIssuerSettingsResponse = z.infer<
  typeof adminIssuerSettingsResponseSchema
>;

export const updateAdminIssuerSettingsRequestSchema = z
  .object({
    expectedRevision: revisionSchema,
    settings: adminIssuerSettingsSchema,
  })
  .strict();
export type UpdateAdminIssuerSettingsRequest = z.infer<
  typeof updateAdminIssuerSettingsRequestSchema
>;

export function isAdminIssuerSettingsReady(
  settings: AdminIssuerSettings,
): boolean {
  const bank = settings.bankAccount;
  return Boolean(
    settings.serviceName &&
      settings.companyName &&
      settings.companyAddress &&
      settings.invoiceRegistrationNo &&
      settings.invoicePrefix &&
      bank.bankName &&
      bank.branchName &&
      bank.accountType &&
      bank.accountNumber &&
      bank.accountHolder,
  );
}
