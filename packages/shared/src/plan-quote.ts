import { z } from "zod";
import { addCalendarDays } from "./invoice.js";
import { validationMessages } from "./messages.js";
import { invoiceTotals, type TaxBreakdown } from "./pricing.js";
import { contractStatuses } from "./states.js";

/** 個別見積りの有効期限は、送ってから14日（既定値）。 */
export const planQuoteExpiryDays = 14;
export const planQuoteMaxPriceExclTax = 10_000_000;
export const planQuoteMaxCredits = 1000;

export const planQuoteStatuses = [
  "awaiting",
  "approved",
  "expired",
  "superseded",
] as const;
export type PlanQuoteStatus = (typeof planQuoteStatuses)[number];

const isoDate = z.iso.date({ error: validationMessages.date });
const isoDateTime = z.iso.datetime();

/** 月額（税抜）から消費税（切り捨て）と税込額を出す。税の計算は共通の関数だけを使う。 */
export function planQuoteTaxFor(priceExclTax: number): TaxBreakdown {
  return invoiceTotals([priceExclTax]);
}

/** 有効期限は「その日の終わりまで」有効。今日より後の日付だけを新しい見積りに指定できる。 */
export function isFutureQuoteExpiry(expiresOn: string, today: string) {
  return expiresOn > today;
}

export function defaultQuoteExpiry(today: string) {
  return addCalendarDays(today, planQuoteExpiryDays);
}

export function createPlanQuoteSchemaFor(today: string) {
  return z
    .object({
      /** 管理者が見ていた最新の版（なければ0）。ずれていたら作らない（二重送信・古い画面の防止）。 */
      expectedVersion: z.number().int().min(0).max(1_000_000),
      priceExclTax: z
        .number({ error: validationMessages.positiveInteger })
        .int({ error: validationMessages.positiveInteger })
        .min(1, { error: validationMessages.positiveInteger })
        .max(planQuoteMaxPriceExclTax, {
          error: validationMessages.maxLength,
        }),
      credits: z
        .number({ error: validationMessages.positiveInteger })
        .int({ error: validationMessages.positiveInteger })
        .min(1, { error: validationMessages.positiveInteger })
        .max(planQuoteMaxCredits, { error: validationMessages.maxLength }),
      description: z
        .string()
        .trim()
        .min(1, validationMessages.required)
        .max(2000, validationMessages.maxLength),
      expiresOn: isoDate.refine((value) => isFutureQuoteExpiry(value, today), {
        error: validationMessages.futureDate,
      }),
    })
    .strict();
}
export type CreatePlanQuote = z.infer<
  ReturnType<typeof createPlanQuoteSchemaFor>
>;

export function derivePlanQuoteStatus(input: {
  expiresOn: string;
  approvedAt: string | null;
  supersededAt: string | null;
  today: string;
}): PlanQuoteStatus {
  if (input.supersededAt) return "superseded";
  if (input.approvedAt) return "approved";
  if (input.expiresOn < input.today) return "expired";
  return "awaiting";
}

const quoteBase = {
  id: z.uuid(),
  version: z.number().int().min(1),
  priceExclTax: z.number().int().safe().positive(),
  taxAmount: z.number().int().safe().nonnegative(),
  priceInclTax: z.number().int().safe().positive(),
  credits: z.number().int().safe().positive(),
  description: z.string(),
  expiresOn: isoDate,
  sentAt: isoDateTime,
  approvedAt: isoDateTime.nullable(),
  status: z.enum(planQuoteStatuses),
};

export const customerPlanQuoteSchema = z
  .object({ ...quoteBase, canApprove: z.boolean() })
  .strict();
export type CustomerPlanQuote = z.infer<typeof customerPlanQuoteSchema>;

export const approvePlanQuoteRequestSchema = z.object({}).strict();
export const approvePlanQuoteResponseSchema = z
  .object({
    quoteId: z.uuid(),
    approvedAt: isoDateTime,
    contractStatus: z.literal("awaiting_payment"),
    replayed: z.boolean(),
  })
  .strict();
export type ApprovePlanQuoteResponse = z.infer<
  typeof approvePlanQuoteResponseSchema
>;

export const adminPlanQuoteVersionSchema = z
  .object({
    ...quoteBase,
    supersededAt: isoDateTime.nullable(),
  })
  .strict();
export type AdminPlanQuoteVersion = z.infer<typeof adminPlanQuoteVersionSchema>;

export const adminPlanQuoteSchema = z
  .object({
    customer: z
      .object({
        id: z.uuid(),
        shopName: z.string(),
        contactName: z.string(),
      })
      .strict(),
    contract: z
      .object({ id: z.uuid(), status: z.enum(contractStatuses) })
      .strict(),
    application: z
      .object({
        planName: z.string(),
        paymentMethod: z.enum(["card", "konbini", "bank_transfer"]),
        submittedAt: isoDateTime,
        freeText: z.string().nullable(),
      })
      .strict(),
    /** 新しい版が先頭。 */
    quotes: z.array(adminPlanQuoteVersionSchema),
    expectedVersion: z.number().int().min(0),
    canCreate: z.boolean(),
    today: isoDate,
  })
  .strict();
export type AdminPlanQuote = z.infer<typeof adminPlanQuoteSchema>;

export const createPlanQuoteResponseSchema = z
  .object({
    quote: adminPlanQuoteVersionSchema,
    contractStatus: z.literal("awaiting_quote_approval"),
  })
  .strict();
export type CreatePlanQuoteResponse = z.infer<
  typeof createPlanQuoteResponseSchema
>;
