import { z } from "zod";
import {
  applicationPaymentMethods,
  applicationPolicyConditions,
} from "./application.js";
import { validationMessages } from "./messages.js";
import { planCodes } from "./pricing.js";

const displayVersionSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const applicationPolicyConditionsSchema = z.strictObject({
  initialDueDays: z.literal(applicationPolicyConditions.initialDueDays),
  extraCreditGrossYen: z.literal(
    applicationPolicyConditions.extraCreditGrossYen,
  ),
  monthlyPrepaid: z.literal(applicationPolicyConditions.monthlyPrepaid),
  periodBasis: z.literal(applicationPolicyConditions.periodBasis),
  rollover: z.literal(applicationPolicyConditions.rollover),
  cancellation: z.literal(applicationPolicyConditions.cancellation),
});

const httpsUrlSchema = z
  .string()
  .url()
  .max(2000)
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }, validationMessages.applicationConditions);

const legalDocumentReferenceSchema = z.strictObject({
  url: httpsUrlSchema,
  version: z.string().trim().min(1).max(100),
});

export const publicApplicationConfigSchema = z.strictObject({
  mode: z.enum(["preview", "live"]),
  terms: legalDocumentReferenceSchema,
  privacy: legalDocumentReferenceSchema,
  disclosure: legalDocumentReferenceSchema,
  availablePaymentMethods: z.array(z.enum(applicationPaymentMethods)).length(1),
  konbiniFeeYen: z.null(),
  displayVersion: displayVersionSchema,
  conditions: applicationPolicyConditionsSchema,
});
export type PublicApplicationConfig = z.infer<
  typeof publicApplicationConfigSchema
>;

export const publicConfigSchema = z.strictObject({
  serviceName: z.string().trim().min(1).max(120),
  application: publicApplicationConfigSchema.nullable().optional(),
});
export type PublicConfig = z.infer<typeof publicConfigSchema>;

export const publicPlanSchema = z
  .strictObject({
    id: z.string().uuid(),
    code: z.enum(planCodes),
    name: z.string().trim().min(1).max(120),
    priceInclTax: z.number().int().positive().nullable(),
    credits: z.number().int().positive().nullable(),
    isCustom: z.boolean(),
  })
  .superRefine((plan, context) => {
    const customFieldsMatchNull =
      plan.priceInclTax === null && plan.credits === null;
    if (plan.isCustom !== customFieldsMatchNull) {
      context.addIssue({
        code: "custom",
        path: ["isCustom"],
        message: validationMessages.applicationConditions,
      });
    }
  });

export const publicPlansSchema = z.strictObject({
  plans: z.array(publicPlanSchema),
  displayVersion: displayVersionSchema,
});
export type PublicPlan = z.infer<typeof publicPlanSchema>;
export type PublicPlans = z.infer<typeof publicPlansSchema>;

export const publicPartnerSchema = z.strictObject({
  code: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(160),
});
export type PublicPartner = z.infer<typeof publicPartnerSchema>;

export const applicationReceiptSchema = z.strictObject({
  applicationId: z.string().uuid(),
  contractId: z.string().uuid(),
  status: z.literal("under_review"),
  replayed: z.boolean(),
});
export type ApplicationReceipt = z.infer<typeof applicationReceiptSchema>;

export const meResponseSchema = z.strictObject({
  customer: z.strictObject({
    id: z.string().uuid(),
    shopName: z.string().min(1),
    contactName: z.string().min(1),
  }),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
