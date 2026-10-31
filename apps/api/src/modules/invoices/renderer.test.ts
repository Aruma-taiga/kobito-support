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
  totalInclTax: totals.inclYen,
  totalExclTax: totals.exclYen,
  taxAmount: totals.taxYen,
  paymentMethod: "bank_transfer" as const,
  preview: true,
  billingName: "<img src=x onerror=alert(1)>",
  billingAddress: "開発住所",
  acceptedPlan: {
    planId: "00000000-0000-4000-8000-000000000002",
    planCode: "light",
    planName: "ライト",
    monthlyPriceExclTax: 5000,
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
      unitPriceExclTax: 5000,
      amountExclTax: 5000,
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
    expect(html).toContain("小計（税抜）：5,000円");
    expect(html).toContain("消費税（10%）：500円");
    expect(html).toContain("ご請求金額（税込）：5,500円");
    expect(() =>
      invoiceHtml({ ...sample, taxAmount: sample.taxAmount + 1 }),
    ).toThrow();
  });

  it("never mentions convenience-store payment in the document wording", () => {
    const html = invoiceHtml(sample);
    expect(html).not.toContain("コンビニ");
    expect(html).not.toContain("払込番号");
    expect(html).not.toContain("支払番号");
  });

  it("asks card customers to pay from their account without promising automatic charge", () => {
    const html = invoiceHtml({ ...sample, paymentMethod: "card" });
    expect(html).toContain(
      "マイページのお支払いページからカードでお支払いください。",
    );
    expect(html).not.toContain("自動で課金");
    expect(html).not.toContain("銀行振込</h2>");
  });

  it("marks a void invoice with its cancellation date without disclosing its reason", () => {
    const html = invoiceHtml({ ...sample, voidedOn: "2026-10-31" });
    expect(html).toContain("取消");
    expect(html).toContain(
      "この請求書は2026年10月31日に取り消されました。お支払いいただく必要はありません。",
    );
    expect(html).not.toContain("voidReason");
  });

  it("does not show a cancellation mark when no cancellation date is supplied", () => {
    const html = invoiceHtml(sample);
    expect(html).not.toContain("この請求書は");
  });
});
