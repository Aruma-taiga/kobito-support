import { z } from "zod";

const optionalText = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(1).optional(),
);

const optionalEmail = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().email().optional(),
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
  })
  .superRefine((environment, context) => {
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
  invoiceRegistrationNo?: string;
  bankAccountName?: string;
  bankAccountBranch?: string;
  bankAccountType?: string;
  bankAccountNumber?: string;
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
  };
}
