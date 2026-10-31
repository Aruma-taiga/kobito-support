import { z } from "zod";
import { invoiceListItemSchema } from "./invoice.js";
import { contractStatuses } from "./states.js";

const contractStatusSchema = z.enum(contractStatuses);
const paymentMethodSchema = z.enum(["card", "konbini", "bank_transfer"]);
const reviewResultSchema = z.enum(["approved", "declined"]).nullable();

export const adminSessionSchema = z
  .object({ role: z.literal("admin") })
  .strict();
export type AdminSession = z.infer<typeof adminSessionSchema>;

export const adminApplicationQueueQuerySchema = z
  .object({
    status: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? undefined : value,
      contractStatusSchema.optional(),
    ),
    q: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? undefined : value,
      z.string().trim().max(100).optional(),
    ),
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type AdminApplicationQueueQuery = z.infer<
  typeof adminApplicationQueueQuerySchema
>;

export const adminApplicationQueueItemSchema = z
  .object({
    customerId: z.string().uuid(),
    shopName: z.string(),
    contactName: z.string(),
    email: z.string().email(),
    submittedAt: z.iso.datetime(),
    planName: z.string(),
    priceExclTax: z.number().int().nonnegative().nullable(),
    credits: z.number().int().nonnegative().nullable(),
    paymentMethod: paymentMethodSchema,
    status: contractStatusSchema,
  })
  .strict();
export type AdminApplicationQueueItem = z.infer<
  typeof adminApplicationQueueItemSchema
>;

export const adminApplicationQueueResponseSchema = z
  .object({
    items: z.array(adminApplicationQueueItemSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().nonnegative(),
  })
  .strict();
export type AdminApplicationQueueResponse = z.infer<
  typeof adminApplicationQueueResponseSchema
>;

export const adminCustomerDetailSchema = z
  .object({
    customer: z
      .object({
        id: z.string().uuid(),
        shopName: z.string(),
        contactName: z.string(),
        email: z.string().email(),
        phone: z.string().nullable(),
        billingName: z.string(),
        billingAddress: z.string(),
        invoiceRegistrationNo: z.string().nullable(),
      })
      .strict(),
    application: z
      .object({
        id: z.string().uuid(),
        submittedAt: z.iso.datetime(),
        paymentMethod: paymentMethodSchema,
        termsVersion: z.string(),
        privacyVersion: z.string(),
        disclosureVersion: z.string(),
        consentBusinessUse: z.boolean(),
        consentTerms: z.boolean(),
        consentMarketing: z.boolean(),
        consentPartnerShare: z.boolean().nullable(),
        shownTerms: z.record(z.string(), z.unknown()),
        referralCode: z.string().nullable(),
        freeText: z.string().nullable(),
        reviewResult: reviewResultSchema,
        rejectionNote: z.string().nullable(),
      })
      .strict(),
    contract: z
      .object({ id: z.string().uuid(), status: contractStatusSchema })
      .strict(),
  })
  .strict();
export type AdminCustomerDetail = z.infer<typeof adminCustomerDetailSchema>;

export const declineApplicationRequestSchema = z
  .object({
    rejectionNote: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? undefined : value,
      z.string().trim().max(500).optional(),
    ),
  })
  .strict();
export type DeclineApplicationRequest = z.infer<
  typeof declineApplicationRequestSchema
>;

export const declineApplicationResponseSchema = z
  .object({
    applicationId: z.string().uuid(),
    contractId: z.string().uuid(),
    status: z.literal("declined"),
    replayed: z.boolean(),
  })
  .strict();
export type DeclineApplicationResponse = z.infer<
  typeof declineApplicationResponseSchema
>;

export const approveApplicationResponseSchema = z
  .object({
    applicationId: z.string().uuid(),
    contractId: z.string().uuid(),
    status: z.enum(["awaiting_payment", "quoting"]),
    invoice: invoiceListItemSchema.nullable(),
    replayed: z.boolean(),
  })
  .strict()
  .superRefine((response, context) => {
    if (
      (response.status === "awaiting_payment" && response.invoice === null) ||
      (response.status === "quoting" && response.invoice !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["invoice"],
        message: "Invoice presence must match the application status",
      });
    }
  });
export type ApproveApplicationResponse = z.infer<
  typeof approveApplicationResponseSchema
>;

export const approveApplicationRequestSchema = z.object({}).strict();

/** 「期限が近い請求」にする基準：支払期限まで、この日数以内（期限切れも含む）。 */
export const adminDueSoonDays = 7;

function dayNumber(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) throw new RangeError("Invalid calendar date");
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** 期限までの日数（今日が期限なら0、過ぎていれば負）。 */
export function daysUntil(dueOn: string, today: string): number {
  return dayNumber(dueOn) - dayNumber(today);
}

export function isDueSoon(dueOn: string, today: string): boolean {
  return daysUntil(dueOn, today) <= adminDueSoonDays;
}
