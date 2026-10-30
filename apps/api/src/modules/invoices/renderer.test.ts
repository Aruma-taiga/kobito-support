import { type InvoiceDetail, invoiceTotals } from "@kobito/shared";
import { describe, expect, it } from "vitest";
import { invoiceHtml } from "./renderer.js";

const totals = invoiceTotals([5000]);
const sample: InvoiceDetail = {
  id: "00000000-0000-4000-8000-000000000001",
  invoiceNo: "DEV-2026-00001",
  kind: "initial" as const,
  status: "issued" as const,
  issuedOn: "2026-01-31",
  dueOn: "2026-02-07",
  totalInclTax: totals.grossYen,
  totalExclTax: totals.netYen,
  taxAmount: totals.taxYen,
  paymentMethod: "bank_transfer" as const,
  preview: true,
  billingName: "<img src=x onerror=alert(1)>",
  billingAddress: "開発住所",
  acceptedPlan: {
    planId: "00000000-0000-4000-8000-000000000002",
    planCode: "light",
    planName: "ライト",
    monthlyPriceInclTax: 5000,
    credits: 1,
  },
  issuer: {
    serviceName: "サンプル",
    companyName: "サンプル会社",
    companyAddress: "未設定",
    invoiceRegistrationNo: null,
    bankAccountName: null,
    bankAccountBranch: null,
    bankAccountType: null,
    bankAccountNumber: null,
  },
  lines: [
    {
      description: "<script>bad()</script>",
      quantity: 1,
      unitPriceInclTax: 5000,
      amountInclTax: 5000,
      taxRate: 0.1,
    },
  ],
};

describe("invoice HTML renderer", () => {
  it("escapes all user-provided invoice text and marks samples as non-payable", () => {
    const html = invoiceHtml(sample);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;script&gt;bad()&lt;/script&gt;");
    expect(html).toContain(
      "開発用サンプル・お支払い不要 / 正式な請求書ではありません",
    );
    expect(html).toContain("登録番号：未設定");
    expect(html).toContain("口座番号：未設定");
    expect(html).toContain("script-src 'none'");
    expect(() =>
      invoiceHtml({ ...sample, taxAmount: sample.taxAmount + 1 }),
    ).toThrow();
  });
});
