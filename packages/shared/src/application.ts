import { z } from "zod";
import { validationMessages } from "./messages.js";
import { planCodes } from "./pricing.js";

export const paymentMethods = ["card", "konbini", "bank_transfer"] as const;
export type PaymentMethod = (typeof paymentMethods)[number];

const optionalText = (maxLength: number) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z
      .string({ error: validationMessages.required })
      .trim()
      .max(maxLength, { error: validationMessages.maxLength })
      .optional(),
  );

const requiredText = (maxLength: number) =>
  z
    .string({ error: validationMessages.required })
    .trim()
    .min(1, { error: validationMessages.required })
    .max(maxLength, { error: validationMessages.maxLength });

const passwordSchema = z
  .string({ error: validationMessages.required })
  .min(8, { error: validationMessages.passwordMin })
  .max(128, { error: validationMessages.passwordMax })
  .refine((password) => password.trim().length > 0, {
    error: validationMessages.passwordBlank,
  });

const invoiceRegistrationNoSchema = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z
    .string({ error: validationMessages.invoiceRegistrationNo })
    .regex(/^T\d{13}$/, { error: validationMessages.invoiceRegistrationNo })
    .optional(),
);

const shopFields = {
  shopName: requiredText(120),
  contactName: requiredText(120),
  email: z
    .string({ error: validationMessages.required })
    .trim()
    .email({ error: validationMessages.email })
    .max(254, { error: validationMessages.maxLength }),
  phone: optionalText(50),
  password: passwordSchema,
};

const planFields = {
  planCode: z.enum(planCodes, { error: validationMessages.plan }),
};

const paymentFields = {
  billingName: requiredText(160),
  billingAddress: requiredText(500),
  paymentMethod: z.enum(paymentMethods, {
    error: validationMessages.paymentMethod,
  }),
  invoiceRegistrationNo: invoiceRegistrationNoSchema,
};

const notesFields = {
  lineDisplayName: optionalText(100),
  referralCode: optionalText(100),
  freeText: optionalText(2000),
};

const consentFields = {
  consentBusinessUse: z.literal(true, {
    error: validationMessages.businessConsent,
  }),
  consentTerms: z.literal(true, { error: validationMessages.termsConsent }),
  consentMarketing: z
    .boolean({ error: validationMessages.boolean })
    .default(false),
  consentPartnerShare: z
    .boolean({ error: validationMessages.boolean })
    .optional(),
};

export const shopStepSchema = z.strictObject(shopFields, {
  error: validationMessages.unknownField,
});

export const planStepSchema = z.strictObject(planFields, {
  error: validationMessages.unknownField,
});

export const paymentStepSchema = z.strictObject(paymentFields, {
  error: validationMessages.unknownField,
});

export const notesStepSchema = z.strictObject(notesFields, {
  error: validationMessages.unknownField,
});

export const confirmStepSchema = z.strictObject(consentFields, {
  error: validationMessages.unknownField,
});

/** Client data only: versions, timestamps, auth IDs, LINE user IDs, and card data are server/provider owned. */
export const applicationFormSchema = z
  .strictObject(
    {
      ...shopFields,
      ...planFields,
      ...paymentFields,
      ...notesFields,
      ...consentFields,
    },
    { error: validationMessages.unknownField },
  )
  .superRefine((application, context) => {
    if (application.referralCode && application.consentPartnerShare !== true) {
      context.addIssue({
        code: "custom",
        path: ["consentPartnerShare"],
        message: validationMessages.partnerConsent,
      });
    }
  });

export type ShopStep = z.infer<typeof shopStepSchema>;
export type PlanStep = z.infer<typeof planStepSchema>;
export type PaymentStep = z.infer<typeof paymentStepSchema>;
export type NotesStep = z.infer<typeof notesStepSchema>;
export type ConfirmStep = z.infer<typeof confirmStepSchema>;
export type ApplicationFormInput = z.input<typeof applicationFormSchema>;
export type ApplicationForm = z.output<typeof applicationFormSchema>;
