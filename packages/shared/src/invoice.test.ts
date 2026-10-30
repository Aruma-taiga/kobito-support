import { describe, expect, it } from "vitest";
import { addCalendarDays, invoiceDetailSchema } from "./invoice.js";
import { invoiceTotals } from "./pricing.js";

describe("addCalendarDays", () => {
  it.each([
    ["2024-01-31", 7, "2024-02-07"],
    ["2024-02-25", 7, "2024-03-03"],
    ["2023-12-28", 7, "2024-01-04"],
    ["2024-03-01", -1, "2024-02-29"],
  ])("adds calendar days to %s", (date, days, expected) => {
    expect(addCalendarDays(date, days)).toBe(expected);
  });

  it("rejects impossible dates", () => {
    expect(() => addCalendarDays("2025-02-29", 7)).toThrow(RangeError);
  });
});

describe("invoiceDetailSchema", () => {
  it("allows missing registration and bank details only as explicit nulls", () => {
    const totals = invoiceTotals([5000]);
    const detail = {
      id: "00000000-0000-4000-8000-000000000001",
      invoiceNo: "DEV-2026-00001",
      kind: "initial",
      status: "issued",
      issuedOn: "2026-01-31",
      dueOn: "2026-02-07",
      totalInclTax: totals.grossYen,
      totalExclTax: totals.netYen,
      taxAmount: totals.taxYen,
      paymentMethod: "bank_transfer",
      preview: true,
      billingName: "サンプル商店",
      billingAddress: "開発用サンプル住所",
      acceptedPlan: {
        planId: "00000000-0000-4000-8000-000000000002",
        planCode: "light",
        planName: "ライト",
        monthlyPriceInclTax: 5000,
        credits: 1,
      },
      issuer: {
        serviceName: "サンプルサービス",
        companyName: "開発用サンプル会社",
        companyAddress: "開発用サンプル住所",
        invoiceRegistrationNo: null,
        bankAccountName: null,
        bankAccountBranch: null,
        bankAccountType: null,
        bankAccountNumber: null,
      },
      lines: [
        {
          description: "初月利用料",
          quantity: 1,
          unitPriceInclTax: 5000,
          amountInclTax: 5000,
          taxRate: 0.1,
        },
      ],
    };
    expect(invoiceDetailSchema.safeParse(detail).success).toBe(true);
    expect(
      invoiceDetailSchema.safeParse({
        ...detail,
        taxAmount: detail.taxAmount + 1,
      }).success,
    ).toBe(false);
    expect(
      invoiceDetailSchema.safeParse({
        ...detail,
        issuer: { ...detail.issuer, invoiceRegistrationNo: "T123" },
      }).success,
    ).toBe(false);
  });
});
