interface EmulatorVerificationCode {
  phoneNumber: string;
  code: string;
  sessionInfo: string;
}

export function findLocalAdminMfaCode(
  entries: unknown[],
  configuredPhone: string,
): string | undefined {
  const lastFourDigits = configuredPhone.replace(/\D/g, "").slice(-4);
  if (!lastFourDigits) return undefined;

  const matchingCode = entries
    .filter(
      (entry): entry is EmulatorVerificationCode =>
        typeof entry === "object" &&
        entry !== null &&
        "phoneNumber" in entry &&
        typeof entry.phoneNumber === "string" &&
        entry.phoneNumber.replace(/\D/g, "").endsWith(lastFourDigits) &&
        "code" in entry &&
        typeof entry.code === "string" &&
        "sessionInfo" in entry &&
        typeof entry.sessionInfo === "string",
    )
    .at(-1);
  return matchingCode?.code;
}
