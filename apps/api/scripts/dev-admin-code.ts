import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { loadConfig } from "../src/platform/config.js";
import { findLocalAdminMfaCode } from "../src/platform/local-admin-code.js";
import { validateLocalAdminSeedTarget } from "../src/platform/local-admin-guards.js";

dotenv.config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
});

async function printLocalAdminCode(): Promise<void> {
  const config = loadConfig(process.env);
  const credentials = {
    email: process.env.DEV_ADMIN_EMAIL?.trim() ?? "",
    password: process.env.DEV_ADMIN_PASSWORD ?? "",
    phone: process.env.DEV_ADMIN_PHONE?.trim() ?? "",
  };
  const { authEmulatorOrigin } = validateLocalAdminSeedTarget(
    config,
    credentials,
  );
  const endpoint = new URL(
    `/emulator/v1/projects/${encodeURIComponent(config.firebaseProjectId)}/verificationCodes`,
    authEmulatorOrigin,
  );
  let response: Response;
  try {
    response = await fetch(endpoint);
  } catch {
    throw new Error("Local Auth Emulator did not return MFA codes");
  }
  if (!response.ok)
    throw new Error("Local Auth Emulator did not return MFA codes");

  const payload: unknown = await response.json();
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("verificationCodes" in payload)
  ) {
    throw new Error("Local Auth Emulator returned an invalid MFA response");
  }
  const codes = payload.verificationCodes;
  if (!Array.isArray(codes)) {
    throw new Error("Local Auth Emulator returned an invalid MFA response");
  }
  const code = findLocalAdminMfaCode(codes, credentials.phone);
  if (!code) {
    throw new Error("No pending local admin MFA code is available");
  }
  console.info(`Local admin MFA code: ${code}`);
}

try {
  await printLocalAdminCode();
} catch {
  console.error("Could not retrieve a local admin MFA code.");
  process.exitCode = 1;
}
