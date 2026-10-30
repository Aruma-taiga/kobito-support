import type { MultiFactorUpdateSettings } from "firebase-admin/auth";

export function localAdminMfaSettings(
  phoneNumber: string,
): MultiFactorUpdateSettings {
  return {
    enrolledFactors: [
      {
        uid: "local-dev-admin-phone",
        factorId: "phone",
        phoneNumber,
        displayName: "Local development MFA",
      },
    ],
  };
}
