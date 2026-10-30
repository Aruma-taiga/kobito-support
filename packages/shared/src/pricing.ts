import { planLabels } from "./messages.js";

export const planCatalog = {
  light: {
    code: "light",
    label: planLabels.light,
    monthlyGrossYen: 5_500,
    monthlyCredits: 1,
  },
  standard: {
    code: "standard",
    label: planLabels.standard,
    monthlyGrossYen: 11_000,
    monthlyCredits: 3,
  },
  premium: {
    code: "premium",
    label: planLabels.premium,
    monthlyGrossYen: 16_500,
    monthlyCredits: 5,
  },
  custom: {
    code: "custom",
    label: planLabels.custom,
    monthlyGrossYen: null,
    monthlyCredits: null,
  },
} as const;

export type PlanCode = keyof typeof planCatalog;

export const planCodes = [
  "light",
  "standard",
  "premium",
  "custom",
] as const satisfies readonly PlanCode[];
export const extraCreditGrossYen = 4_400;

export interface TaxBreakdown {
  grossYen: number;
  taxYen: number;
  netYen: number;
}

function assertGrossYen(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("Gross yen must be a non-negative safe integer");
  }
}

/** Splits a 10% tax-inclusive amount once, rounding tax down to whole yen. */
export function splitTax(grossYen: number): TaxBreakdown {
  assertGrossYen(grossYen);
  const gross = BigInt(grossYen);
  const taxYen = Number((gross * 10n) / 110n);
  return {
    grossYen,
    taxYen,
    netYen: grossYen - taxYen,
  };
}

/** Sums line gross amounts safely, then rounds tax once for the invoice. */
export function invoiceTotals(
  lineGrossAmountsYen: readonly number[],
): TaxBreakdown {
  let gross = 0n;
  for (const amount of lineGrossAmountsYen) {
    assertGrossYen(amount);
    gross += BigInt(amount);
    if (gross > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError(
        "Invoice gross total exceeds the safe integer range",
      );
    }
  }
  return splitTax(Number(gross));
}
