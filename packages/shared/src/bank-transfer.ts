import { z } from "zod";
import { invoiceListItemSchema } from "./invoice.js";
import { contractStatuses } from "./states.js";

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    if (!year || year > 9999 || !month || !day) return false;
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(0, 0, 0, 0);
    return date.toISOString().slice(0, 10) === value;
  });

export const pendingBankTransfersSchema = z
  .object({
    items: z.array(
      z
        .object({
          invoice: invoiceListItemSchema,
          customer: z
            .object({
              id: z.uuid(),
              shopName: z.string(),
              billingName: z.string(),
            })
            .strict(),
          contractId: z.uuid(),
        })
        .strict(),
    ),
  })
  .strict();
export type PendingBankTransfers = z.infer<typeof pendingBankTransfersSchema>;

export const confirmBankPaymentRequestSchema = z
  .object({
    amount: z.number().int().safe().positive(),
    paidOn: calendarDate,
    previewAcknowledged: z.boolean().default(false),
  })
  .strict();
export type ConfirmBankPaymentRequest = z.input<
  typeof confirmBankPaymentRequestSchema
>;

export const confirmBankPaymentResponseSchema = z
  .object({
    invoiceId: z.uuid(),
    paymentId: z.uuid(),
    amount: z.number().int().safe().positive(),
    paidOn: calendarDate,
    contractId: z.uuid(),
    anchorDate: calendarDate,
    period: z
      .object({
        id: z.uuid(),
        seq: z.literal(1),
        startsOn: calendarDate,
        endsOn: calendarDate,
        priceExclTax: z.number().int().safe().positive(),
        credits: z.number().int().safe().positive(),
      })
      .strict(),
    preview: z.boolean(),
    replayed: z.boolean(),
  })
  .strict();
export type ConfirmBankPaymentResponse = z.infer<
  typeof confirmBankPaymentResponseSchema
>;

const contractPlanSchema = z
  .object({
    name: z.string(),
    priceExclTax: z.number().int().safe().positive(),
    credits: z.number().int().safe().positive(),
  })
  .strict();
const currentPeriodSchema = z
  .object({
    id: z.uuid(),
    seq: z.number().int().positive(),
    startsOn: calendarDate,
    endsOn: calendarDate,
    priceExclTax: z.number().int().safe().positive(),
    credits: z.number().int().safe().positive(),
    balance: z.number().int().safe(),
  })
  .strict();
export const customerContractResponseSchema = z
  .object({
    contract: z
      .object({
        id: z.uuid(),
        status: z.enum(contractStatuses),
        anchorDate: calendarDate.nullable(),
        preview: z.boolean(),
        plan: contractPlanSchema.nullable(),
        currentPeriod: currentPeriodSchema.nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type CustomerContractResponse = z.infer<
  typeof customerContractResponseSchema
>;
