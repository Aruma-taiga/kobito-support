import { z } from "zod";

const optionalText = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(1).optional(),
);

const optionalSecret = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().min(1).optional(),
);

const optionalEmail = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().email().optional(),
);

const mailFrom = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z
    .string()
    .trim()
    .refine(
      (value) =>
        /^(?:[^<>\r\n]+\s)?<[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+>$/.test(value) ||
        /^[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+$/.test(value),
    )
    .optional(),
);

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    DATABASE_URL: z
      .string()
      .trim()
      .min(1)
      .url()
      .refine(
        (value) =>
          value.startsWith("postgres://") || value.startsWith("postgresql://"),
        "must use PostgreSQL",
      ),
    FIREBASE_PROJECT_ID: z.string().trim().min(1),
    WEB_ORIGIN: z.string().trim().min(1).url(),
    OPERATIONS_EMAIL: optionalEmail,
    FIREBASE_AUTH_EMULATOR_HOST: optionalText,
    PORT: z.preprocess(
      (value) => (value === undefined || value === "" ? 3000 : Number(value)),
      z.number().int().safe().min(1).max(65_535),
    ),
    SERVICE_NAME: optionalText,
    COMPANY_NAME: optionalText,
    INVOICE_PREFIX: optionalText.default("KS"),
    INVOICE_REGISTRATION_NO: optionalText,
    BANK_ACCOUNT_NAME: optionalText,
    BANK_ACCOUNT_BRANCH: optionalText,
    BANK_ACCOUNT_TYPE: optionalText,
    BANK_ACCOUNT_NUMBER: optionalText,
    DEV_INVOICE_PREVIEW: z.enum(["0", "1"]).default("0"),
    PDF_STORAGE: z.enum(["postgres", "gcs"]).default("postgres"),
    PDF_BUCKET: optionalText,
    KOMOJU_WEBHOOK_SECRET: optionalSecret,
    KOMOJU_SECRET_KEY: optionalSecret,
    LINE_ENABLED: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? undefined : value,
      z.enum(["true", "false"]).default("false"),
    ),
    MAIL_PROVIDER: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? undefined : value,
      z.enum(["log", "resend"]).optional(),
    ),
    RESEND_API_KEY: optionalSecret,
    MAIL_FROM: mailFrom,
    LINE_LOGIN_CHANNEL_ID: optionalText,
  })
  .superRefine((environment, context) => {
    if (environment.PDF_STORAGE === "gcs" && !environment.PDF_BUCKET) {
      context.addIssue({
        code: "custom",
        path: ["PDF_BUCKET"],
        message: "required when GCS PDF storage is selected",
      });
    }
    if (environment.MAIL_PROVIDER === "resend") {
      if (!environment.RESEND_API_KEY)
        context.addIssue({
          code: "custom",
          path: ["RESEND_API_KEY"],
          message: "required when Resend is selected",
        });
      if (!environment.MAIL_FROM)
        context.addIssue({
          code: "custom",
          path: ["MAIL_FROM"],
          message: "required and must be a sender address",
        });
    }
    if (
      environment.NODE_ENV === "production" &&
      environment.FIREBASE_AUTH_EMULATOR_HOST
    ) {
      context.addIssue({
        code: "custom",
        path: ["FIREBASE_AUTH_EMULATOR_HOST"],
        message: "must not be configured in production",
      });
    }
    if (
      environment.NODE_ENV === "production" &&
      environment.DEV_INVOICE_PREVIEW === "1"
    ) {
      context.addIssue({
        code: "custom",
        path: ["DEV_INVOICE_PREVIEW"],
        message: "must not be enabled in production",
      });
    }
  });

export interface RuntimeConfig {
  nodeEnv: "development" | "test" | "production";
  databaseUrl: string;
  firebaseProjectId: string;
  webOrigin: string;
  operationsEmail?: string;
  authEmulatorHost?: string;
  port: number;
  serviceName?: string;
  companyName?: string;
  invoicePrefix: string;
  pdfStorage?: "postgres" | "gcs";
  pdfBucket?: string;
  invoiceRegistrationNo?: string;
  bankAccountName?: string;
  bankAccountBranch?: string;
  bankAccountType?: string;
  bankAccountNumber?: string;
  devInvoicePreview?: boolean;
  komojuWebhookSecret?: string;
  komojuSecretKey?: string;
  cardPaymentEnabled?: boolean;
  lineEnabled?: boolean;
  lineLoginChannelId?: string;
  mailProvider?: "log" | "resend";
  resendApiKey?: string;
  mailFrom?: string;
}

export function loadConfig(
  environment: NodeJS.ProcessEnv | Record<string, string | undefined>,
): RuntimeConfig {
  const result = environmentSchema.safeParse(environment);
  if (!result.success) {
    // Report variable names only. Zod issues contain the submitted input and may expose secrets.
    const names = [
      ...new Set(
        result.error.issues
          .map((issue) => issue.path[0])
          .filter((name) => typeof name === "string"),
      ),
    ];
    throw new Error(
      `Invalid environment configuration: ${names.join(", ") || "cross-field settings"}`,
    );
  }

  const value = result.data;
  return {
    nodeEnv: value.NODE_ENV,
    databaseUrl: value.DATABASE_URL,
    firebaseProjectId: value.FIREBASE_PROJECT_ID,
    webOrigin: value.WEB_ORIGIN,
    ...(value.OPERATIONS_EMAIL === undefined
      ? {}
      : { operationsEmail: value.OPERATIONS_EMAIL }),
    ...(value.FIREBASE_AUTH_EMULATOR_HOST === undefined
      ? {}
      : { authEmulatorHost: value.FIREBASE_AUTH_EMULATOR_HOST }),
    port: value.PORT,
    ...(value.SERVICE_NAME === undefined
      ? {}
      : { serviceName: value.SERVICE_NAME }),
    ...(value.COMPANY_NAME === undefined
      ? {}
      : { companyName: value.COMPANY_NAME }),
    invoicePrefix: value.INVOICE_PREFIX,
    pdfStorage: value.PDF_STORAGE,
    ...(value.PDF_BUCKET === undefined ? {} : { pdfBucket: value.PDF_BUCKET }),
    ...(value.INVOICE_REGISTRATION_NO === undefined
      ? {}
      : { invoiceRegistrationNo: value.INVOICE_REGISTRATION_NO }),
    ...(value.BANK_ACCOUNT_NAME === undefined
      ? {}
      : { bankAccountName: value.BANK_ACCOUNT_NAME }),
    ...(value.BANK_ACCOUNT_BRANCH === undefined
      ? {}
      : { bankAccountBranch: value.BANK_ACCOUNT_BRANCH }),
    ...(value.BANK_ACCOUNT_TYPE === undefined
      ? {}
      : { bankAccountType: value.BANK_ACCOUNT_TYPE }),
    ...(value.BANK_ACCOUNT_NUMBER === undefined
      ? {}
      : { bankAccountNumber: value.BANK_ACCOUNT_NUMBER }),
    devInvoicePreview: value.DEV_INVOICE_PREVIEW === "1",
    ...(value.KOMOJU_WEBHOOK_SECRET === undefined
      ? {}
      : { komojuWebhookSecret: value.KOMOJU_WEBHOOK_SECRET }),
    ...(value.KOMOJU_SECRET_KEY === undefined
      ? {}
      : { komojuSecretKey: value.KOMOJU_SECRET_KEY }),
    cardPaymentEnabled: value.KOMOJU_SECRET_KEY !== undefined,
    lineEnabled: value.LINE_ENABLED === "true",
    ...(value.LINE_LOGIN_CHANNEL_ID === undefined
      ? {}
      : { lineLoginChannelId: value.LINE_LOGIN_CHANNEL_ID }),
    ...(value.MAIL_PROVIDER === undefined
      ? {}
      : { mailProvider: value.MAIL_PROVIDER }),
    ...(value.RESEND_API_KEY === undefined
      ? {}
      : { resendApiKey: value.RESEND_API_KEY }),
    ...(value.MAIL_FROM === undefined ? {} : { mailFrom: value.MAIL_FROM }),
  };
}
