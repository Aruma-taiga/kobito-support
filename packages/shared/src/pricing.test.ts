import { describe, expect, it } from "vitest";
import { applicationPolicyConditions } from "./application.js";
import {
  extraCreditExclYen,
  invoiceTotals,
  planCatalog,
  taxOnExcl,
} from "./pricing.js";

describe("tax-exclusive fixed-price catalog", () => {
  it.each([
    ["light", 5_000, 1],
    ["standard", 10_000, 3],
    ["premium", 15_000, 5],
  ] as const)("keeps %s at the approved exclusive price and credits", (code, excl, credits) => {
    expect(planCatalog[code].monthlyExclYen).toBe(excl);
    expect(planCatalog[code].monthlyCredits).toBe(credits);
  });

  it("derives tax and inclusive totals for each catalog price and the extra credit", () => {
    expect(
      [5_000, 10_000, 15_000, 4_000].map((excl) => invoiceTotals([excl])),
    ).toEqual([
      { exclYen: 5_000, taxYen: 500, inclYen: 5_500 },
      { exclYen: 10_000, taxYen: 1_000, inclYen: 11_000 },
      { exclYen: 15_000, taxYen: 1_500, inclYen: 16_500 },
      { exclYen: 4_000, taxYen: 400, inclYen: 4_400 },
    ]);
  });

  it("calculates a three-credit purchase as one invoice", () => {
    expect(invoiceTotals([extraCreditExclYen * 3])).toEqual({
      exclYen: 12_000,
      taxYen: 1_200,
      inclYen: 13_200,
    });
  });

  it("keeps the extra-credit policy at 4,000 yen excluding tax", () => {
    expect(extraCreditExclYen).toBe(4_000);
    expect(applicationPolicyConditions.extraCreditExclYen).toBe(4_000);
    expect(invoiceTotals([5_000, 4_000])).toEqual({
      exclYen: 9_000,
      taxYen: 900,
      inclYen: 9_900,
    });
  });

  it("rounds tax down once per invoice, not once per line", () => {
    // 15 + 15 = 30 -> floor(3.0) = 3, whereas per-line floor gives 1 + 1 = 2.
    expect(invoiceTotals([15, 15])).toEqual({
      exclYen: 30,
      taxYen: 3,
      inclYen: 33,
    });
    expect(taxOnExcl(15) * 2).toBe(2);
    expect(invoiceTotals([5_005, 4_005])).toEqual({
      exclYen: 9_010,
      taxYen: 901,
      inclYen: 9_911,
    });
    expect(invoiceTotals([5])).toEqual({ exclYen: 5, taxYen: 0, inclYen: 5 });
  });

  it("keeps inclusive total equal to exclusive plus tax", () => {
    for (const lines of [[1], [9], [5_001, 4_003], [12_345, 6_789, 1]]) {
      const t = invoiceTotals(lines);
      expect(t.inclYen).toBe(t.exclYen + t.taxYen);
      expect(t.taxYen).toBe(Math.floor(t.exclYen / 10));
    }
  });

  it("rejects invalid amounts and overflow", () => {
    expect(() => invoiceTotals([10, -1])).toThrow();
    expect(() => invoiceTotals([10.5])).toThrow();
    expect(() => invoiceTotals([Number.MAX_SAFE_INTEGER, 1])).toThrow();
    expect(() => taxOnExcl(Number.MAX_SAFE_INTEGER)).not.toThrow();
  });
});
