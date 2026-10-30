import { describe, expect, it } from "vitest";
import { applicationPolicyConditions } from "./application.js";
import { invoiceTotals, planCatalog, splitTax } from "./pricing.js";

describe("authorized fixed-price catalog", () => {
  it.each([
    ["light", 5_500, 1],
    ["standard", 11_000, 3],
    ["premium", 16_500, 5],
  ] as const)("keeps %s at the approved inclusive price and credits", (code, gross, credits) => {
    expect(planCatalog[code].monthlyGrossYen).toBe(gross);
    expect(planCatalog[code].monthlyCredits).toBe(credits);
  });

  it("splits approved catalog prices to their advertised exclusive prices", () => {
    expect([5_500, 11_000, 16_500].map((gross) => splitTax(gross))).toEqual([
      { grossYen: 5_500, taxYen: 500, netYen: 5_000 },
      { grossYen: 11_000, taxYen: 1_000, netYen: 10_000 },
      { grossYen: 16_500, taxYen: 1_500, netYen: 15_000 },
    ]);
  });

  it("keeps the extra-credit policy and invoice total on the approved gross price", () => {
    expect(applicationPolicyConditions.extraCreditGrossYen).toBe(4_400);
    expect(splitTax(applicationPolicyConditions.extraCreditGrossYen)).toEqual({
      grossYen: 4_400,
      taxYen: 400,
      netYen: 4_000,
    });
    expect(invoiceTotals([5_500, 4_400])).toEqual({
      grossYen: 9_900,
      taxYen: 900,
      netYen: 9_000,
    });
  });
});
