import { createHash } from "node:crypto";
import {
  applicationPaymentMethods,
  applicationPolicyConditions,
  type PublicApplicationConfig,
  type PublicPlan,
} from "@kobito/shared";
import { z } from "zod";
import type { RuntimeConfig } from "../../platform/config.js";
import type { PublicApplicationCatalog } from "./contracts.js";

const legalUrlSchema = z
  .string()
  .url()
  .max(2000)
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  });

const legalReferenceSchema = z.strictObject({
  url: legalUrlSchema,
  version: z.string().trim().min(1).max(100),
});

const legalDocumentsSchema = z.strictObject({
  status: z.enum(["draft", "published"]),
  terms: legalReferenceSchema,
  privacy: legalReferenceSchema,
  disclosure: legalReferenceSchema,
});

export type LegalDocuments = z.infer<typeof legalDocumentsSchema>;

export function parseLegalDocuments(value: unknown): LegalDocuments | null {
  const result = legalDocumentsSchema.safeParse(value);
  return result.success ? result.data : null;
}

function isLoopback(hostname: string): boolean {
  return ["127.0.0.1", "localhost", "[::1]"].includes(hostname);
}

function isLocalPreviewRuntime(config: RuntimeConfig): boolean {
  if (
    config.nodeEnv !== "development" ||
    !config.firebaseProjectId.startsWith("demo-") ||
    !config.authEmulatorHost
  ) {
    return false;
  }

  try {
    const emulator = new URL(`http://${config.authEmulatorHost}`);
    const database = new URL(config.databaseUrl);
    return (
      isLoopback(emulator.hostname) &&
      emulator.port === "9099" &&
      (database.protocol === "postgres:" ||
        database.protocol === "postgresql:") &&
      isLoopback(database.hostname) &&
      decodeURIComponent(database.pathname.slice(1)) === "kobito_support" &&
      database.search === "" &&
      database.hash === ""
    );
  } catch {
    return false;
  }
}

function isLiveRuntime(config: RuntimeConfig): boolean {
  return (
    config.nodeEnv === "production" &&
    !config.firebaseProjectId.startsWith("demo-") &&
    config.authEmulatorHost === undefined
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined)
    throw new Error("Invalid offer fingerprint value");
  return serialized;
}

export function buildPublicCatalog(
  plans: PublicPlan[],
  rawLegalDocuments: unknown,
  config: RuntimeConfig,
): PublicApplicationCatalog {
  const legalDocuments = parseLegalDocuments(rawLegalDocuments);
  const localPreview = isLocalPreviewRuntime(config);
  const live = isLiveRuntime(config);
  let application: PublicApplicationConfig | null = null;

  if (
    legalDocuments &&
    (localPreview || (live && legalDocuments.status === "published"))
  ) {
    application = {
      mode: live ? "live" : "preview",
      terms: legalDocuments.terms,
      privacy: legalDocuments.privacy,
      disclosure: legalDocuments.disclosure,
      availablePaymentMethods: config.cardPaymentEnabled
        ? [...applicationPaymentMethods]
        : applicationPaymentMethods.filter((method) => method !== "card"),
      konbiniFeeYen: null,
      displayVersion: "0".repeat(64),
      conditions: applicationPolicyConditions,
    };
  }

  const fingerprint = {
    plans,
    legalDocuments,
    application: application
      ? {
          mode: application.mode,
          terms: application.terms,
          privacy: application.privacy,
          disclosure: application.disclosure,
        }
      : null,
    availablePaymentMethods: config.cardPaymentEnabled
      ? applicationPaymentMethods
      : applicationPaymentMethods.filter((method) => method !== "card"),
    konbiniFeeYen: null,
    conditions: applicationPolicyConditions,
  };
  const displayVersion = createHash("sha256")
    .update(stableJson(fingerprint))
    .digest("hex");

  if (application) application.displayVersion = displayVersion;
  return { plans, displayVersion, application };
}
