import { z } from "zod";
import { invoiceTotals } from "./pricing.js";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const extraCreditPurchaseRequestSchema = z
  .object({ quantity: z.number().int().min(1).max(10) })
  .strict();
export type ExtraCreditPurchaseRequest = z.infer<
  typeof extraCreditPurchaseRequestSchema
>;

export const extraCreditPurchaseResponseSchema = z
  .object({
    invoiceId: z.uuid(),
    invoiceNo: z.string().min(1).max(64),
    totalExclTax: z.number().int().safe().positive(),
    taxAmount: z.number().int().safe().nonnegative(),
    totalInclTax: z.number().int().safe().positive(),
    paymentMethod: z.enum(["bank_transfer", "card"]),
  })
  .strict()
  .refine(
    (value) => value.totalExclTax + value.taxAmount === value.totalInclTax,
  );
export type ExtraCreditPurchaseResponse = z.infer<
  typeof extraCreditPurchaseResponseSchema
>;

export const paymentLinkResponseSchema = z
  .object({ redirectUrl: z.url({ protocol: /^https$/ }) })
  .strict();
export type PaymentLinkResponse = z.infer<typeof paymentLinkResponseSchema>;

export function addCalendarDays(date: string, days: number): string {
  if (!isoDateSchema.safeParse(date).success || !Number.isSafeInteger(days)) {
    throw new RangeError("Invalid calendar date or day count");
  }
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const value = new Date(Date.UTC(year, month - 1, day));
  if (value.toISOString().slice(0, 10) !== date) {
    throw new RangeError("Invalid calendar date");
  }
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export const invoiceListItemSchema = z
  .object({
    id: z.uuid(),
    invoiceNo: z.string().min(1).max(64),
    kind: z.enum(["initial", "monthly", "extra_credit"]),
    status: z.enum(["issued", "paid", "failed", "overdue", "void"]),
    issuedOn: isoDateSchema,
    dueOn: isoDateSchema,
    totalInclTax: z.number().int().safe().positive(),
    totalExclTax: z.number().int().safe().positive(),
    taxAmount: z.number().int().safe().nonnegative(),
    paymentMethod: z.enum(["bank_transfer", "card", "konbini"]),
    preview: z.boolean(),
  })
  .strict();

export const invoiceListSchema = z
  .object({
    invoices: z.array(invoiceListItemSchema),
  })
  .strict();

export type InvoiceListItem = z.infer<typeof invoiceListItemSchema>;
export type InvoiceList = z.infer<typeof invoiceListSchema>;

export const voidInvoiceRequestSchema = z
  .object({ reason: z.string().trim().min(1).max(200) })
  .strict();
export type VoidInvoiceRequest = z.infer<typeof voidInvoiceRequestSchema>;

export const invoiceDetailSchema = invoiceListItemSchema
  .extend({
    acceptedPlan: z
      .object({
        planId: z.uuid(),
        planCode: z.string().min(1).max(50),
        planName: z.string().min(1).max(200),
        monthlyPriceExclTax: z.number().int().safe().positive(),
        credits: z.number().int().safe().positive(),
      })
      .strict(),
    billingName: z.string().min(1).max(200),
    billingAddress: z.string().min(1).max(1000),
    issuer: z
      .object({
        serviceName: z.string().min(1).max(120),
        companyName: z.string().min(1).max(200),
        companyAddress: z.string().min(1).max(1000),
        invoiceRegistrationNo: z
          .string()
          .regex(/^T\d{13}$/)
          .nullable(),
        bankAccountName: z.string().min(1).max(200).nullable(),
        bankAccountBranch: z.string().min(1).max(200).nullable(),
        bankAccountType: z.string().min(1).max(40).nullable(),
        bankAccountNumber: z.string().min(1).max(100).nullable(),
      })
      .strict(),
    lines: z
      .array(
        z
          .object({
            description: z.string().min(1).max(500),
            quantity: z.number().int().safe().positive(),
            unitPriceExclTax: z.number().int().safe().positive(),
            amountExclTax: z.number().int().safe().positive(),
            taxRate: z.literal(0.1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((invoice, context) => {
    const totals = invoiceTotals(
      invoice.lines.map((line) => line.amountExclTax),
    );
    if (totals.inclYen !== invoice.totalInclTax) {
      context.addIssue({
        code: "custom",
        path: ["totalInclTax"],
        message: "Invoice tax-inclusive total must equal subtotal plus tax",
      });
    }
    if (
      totals.exclYen !== invoice.totalExclTax ||
      totals.taxYen !== invoice.taxAmount
    ) {
      context.addIssue({
        code: "custom",
        path: ["taxAmount"],
        message: "Invoice tax split must match the shared 10% calculation",
      });
    }
    if (
      invoice.kind !== "extra_credit" &&
      invoice.acceptedPlan.monthlyPriceExclTax !== invoice.totalExclTax
    ) {
      context.addIssue({
        code: "custom",
        path: ["acceptedPlan", "monthlyPriceExclTax"],
        message: "Initial invoice must match the accepted plan price",
      });
    }
  });

export type InvoiceDetail = z.infer<typeof invoiceDetailSchema>;

export const adminInvoiceDetailSchema = invoiceDetailSchema
  .safeExtend({
    voidedAt: z.string().datetime().nullable(),
    voidReason: z.string().max(200).nullable(),
  })
  .strict();
export type AdminInvoiceDetail = z.infer<typeof adminInvoiceDetailSchema>;

export const invoiceReadinessSchema = z
  .object({
    canIssue: z.boolean(),
    mode: z.enum(["live", "preview", "unavailable"]),
    reason: z.enum([
      "ready",
      "preview_only",
      "issuer_not_configured",
      "document_store_unavailable",
    ]),
  })
  .strict();
export type InvoiceReadiness = z.infer<typeof invoiceReadinessSchema>;
