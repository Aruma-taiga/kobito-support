import { z } from "zod";

const optionalUrl = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().url().optional(),
);

const webEnvironmentSchema = z.object({
  VITE_FIREBASE_API_KEY: z.string().trim().min(1),
  VITE_FIREBASE_AUTH_DOMAIN: z
    .string()
    .trim()
    .min(1)
    .regex(/^[A-Za-z0-9.-]+$/),
  VITE_FIREBASE_PROJECT_ID: z.string().trim().min(1),
  VITE_FIREBASE_APP_ID: z.string().trim().min(1),
  VITE_API_BASE_URL: z.string().trim().url(),
  VITE_FIREBASE_AUTH_EMULATOR_URL: optionalUrl,
  VITE_LINE_ENABLED: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z.enum(["true", "false"]).default("false"),
  ),
  VITE_LINE_LIFF_ID: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z
      .string()
      .regex(/^\d{10,}-[A-Za-z0-9]+$/)
      .optional(),
  ),
});

export interface WebConfig {
  firebaseApiKey: string;
  firebaseAuthDomain: string;
  firebaseProjectId: string;
  firebaseAppId: string;
  apiBaseUrl: string;
  authEmulatorUrl?: string;
  lineEnabled: boolean;
  lineLiffId?: string;
}

function isLoopback(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname);
}

export function loadWebConfig(
  environment: Record<string, string | undefined>,
  mode: string,
): WebConfig {
  const parsed = webEnvironmentSchema.safeParse(environment);
  if (!parsed.success) {
    const names = [
      ...new Set(
        parsed.error.issues
          .map((issue) => issue.path[0])
          .filter((value): value is string => typeof value === "string"),
      ),
    ];
    throw new Error(
      `Invalid web configuration: ${names.join(", ") || "VITE_ variables"}`,
    );
  }

  const value = parsed.data;
  let apiUrl: URL;
  try {
    apiUrl = new URL(value.VITE_API_BASE_URL);
  } catch {
    throw new Error("Invalid web configuration: VITE_API_BASE_URL");
  }
  if (
    apiUrl.username ||
    apiUrl.password ||
    apiUrl.pathname !== "/" ||
    apiUrl.search ||
    apiUrl.hash ||
    (apiUrl.protocol !== "https:" &&
      !(
        mode === "development" &&
        apiUrl.protocol === "http:" &&
        isLoopback(apiUrl.hostname)
      ))
  ) {
    throw new Error("Invalid web configuration: VITE_API_BASE_URL");
  }

  let authEmulatorUrl: URL | undefined;
  if (value.VITE_FIREBASE_AUTH_EMULATOR_URL) {
    authEmulatorUrl = new URL(value.VITE_FIREBASE_AUTH_EMULATOR_URL);
    if (
      mode !== "development" ||
      authEmulatorUrl.protocol !== "http:" ||
      !isLoopback(authEmulatorUrl.hostname) ||
      authEmulatorUrl.username ||
      authEmulatorUrl.password ||
      authEmulatorUrl.pathname !== "/" ||
      authEmulatorUrl.search ||
      authEmulatorUrl.hash ||
      !value.VITE_FIREBASE_PROJECT_ID.startsWith("demo-") ||
      value.VITE_FIREBASE_API_KEY !== "fake-api-key"
    ) {
      throw new Error(
        "Invalid web configuration: VITE_FIREBASE_AUTH_EMULATOR_URL",
      );
    }
  }

  if (
    mode === "production" &&
    (value.VITE_FIREBASE_PROJECT_ID.startsWith("demo-") ||
      value.VITE_FIREBASE_API_KEY === "fake-api-key")
  ) {
    throw new Error("Invalid web configuration: production Firebase values");
  }

  return {
    firebaseApiKey: value.VITE_FIREBASE_API_KEY,
    firebaseAuthDomain: value.VITE_FIREBASE_AUTH_DOMAIN,
    firebaseProjectId: value.VITE_FIREBASE_PROJECT_ID,
    firebaseAppId: value.VITE_FIREBASE_APP_ID,
    apiBaseUrl: apiUrl.origin,
    lineEnabled: value.VITE_LINE_ENABLED === "true",
    ...(authEmulatorUrl ? { authEmulatorUrl: authEmulatorUrl.origin } : {}),
    ...(value.VITE_LINE_LIFF_ID ? { lineLiffId: value.VITE_LINE_LIFF_ID } : {}),
  };
}
