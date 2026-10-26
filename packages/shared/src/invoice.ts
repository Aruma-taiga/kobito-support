import { z } from "zod";
import { invoiceTotals } from "./pricing.js";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

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
    kind: z.literal("initial"),
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

export const invoiceDetailSchema = invoiceListItemSchema
  .extend({
    acceptedPlan: z
      .object({
        planId: z.uuid(),
        planCode: z.string().min(1).max(50),
        planName: z.string().min(1).max(200),
        monthlyPriceInclTax: z.number().int().safe().positive(),
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
            unitPriceInclTax: z.number().int().safe().positive(),
            amountInclTax: z.number().int().safe().positive(),
            taxRate: z.literal(0.1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((invoice, context) => {
    const totals = invoiceTotals(
      invoice.lines.map((line) => line.amountInclTax),
    );
    if (totals.grossYen !== invoice.totalInclTax) {
      context.addIssue({
        code: "custom",
        path: ["totalInclTax"],
        message: "Invoice gross total must equal its lines",
      });
    }
    if (
      totals.netYen !== invoice.totalExclTax ||
      totals.taxYen !== invoice.taxAmount
    ) {
      context.addIssue({
        code: "custom",
        path: ["taxAmount"],
        message: "Invoice tax split must match the shared 10% calculation",
      });
    }
    if (invoice.acceptedPlan.monthlyPriceInclTax !== invoice.totalInclTax) {
      context.addIssue({
        code: "custom",
        path: ["acceptedPlan", "monthlyPriceInclTax"],
        message: "Initial invoice must match the accepted plan price",
      });
    }
  });

export type InvoiceDetail = z.infer<typeof invoiceDetailSchema>;

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
