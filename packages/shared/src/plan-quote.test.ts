import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  adminPlanQuoteSchema,
  createPlanQuoteSchemaFor,
  customerPlanQuoteSchema,
  derivePlanQuoteStatus,
  planQuoteExpiryDays,
  planQuoteTaxFor,
} from "./index.js";

describe("plan quote rules", () => {
  it("defaults the expiry to 14 days after sending", () => {
    expect(planQuoteExpiryDays).toBe(14);
    expect(addCalendarDays("2026-11-14", planQuoteExpiryDays)).toBe(
      "2026-11-28",
    );
  });

  it("splits a tax-exclusive monthly price using the shared floor rule", () => {
    expect(planQuoteTaxFor(12_345)).toEqual({
      exclYen: 12_345,
      taxYen: 1_234,
      inclYen: 13_579,
    });
    expect(planQuoteTaxFor(25_000)).toEqual({
      exclYen: 25_000,
      taxYen: 2_500,
      inclYen: 27_500,
    });
  });

  it("validates create input with positive integers and a future expiry", () => {
    const schema = createPlanQuoteSchemaFor("2026-11-14");
    const base = {
      expectedVersion: 0,
      priceExclTax: 25_000,
      credits: 8,
      description: "  ホームページの更新  ",
      expiresOn: "2026-11-28",
    };
    const ok = schema.safeParse(base);
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.description).toBe("ホームページの更新");
    for (const patch of [
      { priceExclTax: 0 },
      { priceExclTax: -1 },
      { priceExclTax: 1000.5 },
      { credits: 0 },
      { credits: 1.5 },
      { description: "   " },
      { expiresOn: "2026-11-14" },
      { expiresOn: "2026-11-13" },
      { expiresOn: "2026-02-30" },
      { expectedVersion: -1 },
    ]) {
      expect(schema.safeParse({ ...base, ...patch }).success).toBe(false);
    }
    expect(schema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });

  it("derives a status: superseded > approved > expired > awaiting", () => {
    const base = {
      expiresOn: "2026-11-28",
      approvedAt: null,
      supersededAt: null,
      today: "2026-11-28",
    };
    expect(derivePlanQuoteStatus(base)).toBe("awaiting");
    expect(derivePlanQuoteStatus({ ...base, today: "2026-11-29" })).toBe(
      "expired",
    );
    expect(
      derivePlanQuoteStatus({
        ...base,
        today: "2026-11-29",
        approvedAt: "2026-11-20T00:00:00.000Z",
      }),
    ).toBe("approved");
    expect(
      derivePlanQuoteStatus({
        ...base,
        supersededAt: "2026-11-20T00:00:00.000Z",
      }),
    ).toBe("superseded");
  });

  it("parses customer and admin responses strictly", () => {
    const quote = {
      id: "7b0f7d3c-2a4b-4d3e-9c1a-0d6f3a1b2c3d",
      version: 1,
      priceExclTax: 25_000,
      taxAmount: 2_500,
      priceInclTax: 27_500,
      credits: 8,
      description: "内容",
      expiresOn: "2026-11-28",
      sentAt: "2026-11-14T00:00:00.000Z",
      approvedAt: null,
      status: "awaiting",
    };
    expect(
      customerPlanQuoteSchema.safeParse({ ...quote, canApprove: true }).success,
    ).toBe(true);
    expect(
      customerPlanQuoteSchema.safeParse({ ...quote, canApprove: true, x: 1 })
        .success,
    ).toBe(false);
    expect(
      adminPlanQuoteSchema.safeParse({
        customer: {
          id: quote.id,
          shopName: "店",
          contactName: "担当",
        },
        contract: { id: quote.id, status: "quoting" },
        application: {
          planName: "個別見積り",
          paymentMethod: "bank_transfer",
          submittedAt: "2026-11-12T00:00:00.000Z",
          freeText: null,
        },
        quotes: [],
        expectedVersion: 0,
        canCreate: true,
        today: "2026-11-14",
      }).success,
    ).toBe(true);
  });
});
