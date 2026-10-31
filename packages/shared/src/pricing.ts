import { planLabels } from "./messages.js";

export const planCatalog = {
  light: {
    code: "light",
    label: planLabels.light,
    monthlyExclYen: 5_000,
    monthlyCredits: 1,
  },
  standard: {
    code: "standard",
    label: planLabels.standard,
    monthlyExclYen: 10_000,
    monthlyCredits: 3,
  },
  premium: {
    code: "premium",
    label: planLabels.premium,
    monthlyExclYen: 15_000,
    monthlyCredits: 5,
  },
  custom: {
    code: "custom",
    label: planLabels.custom,
    monthlyExclYen: null,
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
export const extraCreditExclYen = 4_000;

/** Consumption tax rate as a ratio of the exclusive subtotal (10%). */
const TAX_PERCENT = 10n;

export interface TaxBreakdown {
  /** Subtotal excluding tax (sum of line amounts). */
  exclYen: number;
  /** Consumption tax: floor(subtotal x 10%), computed once per invoice. */
  taxYen: number;
  /** Amount the customer pays: subtotal + tax. */
  inclYen: number;
}

function assertExclYen(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("Amount must be a non-negative safe integer");
  }
}

/** The single place consumption tax is computed: floor(excl x 10%). */
export function taxOnExcl(exclYen: number): number {
  assertExclYen(exclYen);
  return Number((BigInt(exclYen) * TAX_PERCENT) / 100n);
}

/** Tax-inclusive display amount for a single exclusive price (one-line invoice). */
export function inclYenFor(exclYen: number): number {
  return exclYen + taxOnExcl(exclYen);
}

/**
 * Sums tax-exclusive line amounts, then rounds tax down once for the whole
 * invoice. Never compute tax per line.
 */
export function invoiceTotals(
  lineExclAmountsYen: readonly number[],
): TaxBreakdown {
  let excl = 0n;
  for (const amount of lineExclAmountsYen) {
    assertExclYen(amount);
    excl += BigInt(amount);
    if (excl > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError("Invoice subtotal exceeds the safe integer range");
    }
  }
  const exclYen = Number(excl);
  const taxYen = taxOnExcl(exclYen);
  const inclYen = exclYen + taxYen;
  if (!Number.isSafeInteger(inclYen)) {
    throw new RangeError("Invoice total exceeds the safe integer range");
  }
  return { exclYen, taxYen, inclYen };
}
