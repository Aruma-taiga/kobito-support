import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { InvoiceDetail } from "@kobito/shared";
import { invoiceTotals } from "@kobito/shared";
import { ChromiumInvoicePdfRenderer } from "../src/modules/invoices/renderer.js";

const totals = invoiceTotals([5000]);
const invoice: InvoiceDetail = {
  id: "00000000-0000-4000-8000-000000000001",
  invoiceNo: "DEV-2026-00001",
  kind: "initial",
  status: "issued",
  issuedOn: "2026-10-26",
  dueOn: "2026-11-02",
  totalInclTax: totals.inclYen,
  totalExclTax: totals.exclYen,
  taxAmount: totals.taxYen,
  paymentMethod: "bank_transfer",
  preview: true,
  acceptedPlan: {
    planId: "00000000-0000-4000-8000-000000000002",
    planCode: "light",
    planName: "ライト（開発用サンプル）",
    monthlyPriceExclTax: 5000,
    credits: 1,
  },
  billingName: "開発用サンプル商店",
  billingAddress: "開発用サンプル住所（実在情報ではありません）",
  issuer: {
    serviceName: "開発用サンプルサービス",
    companyName: "未設定",
    companyAddress: "未設定",
    invoiceRegistrationNo: null,
    bankAccountName: null,
    bankAccountBranch: null,
    bankAccountType: null,
    bankAccountNumber: null,
  },
  lines: [
    {
      description: "ライト 初月利用料",
      quantity: 1,
      unitPriceExclTax: 5000,
      amountExclTax: 5000,
      taxRate: 0.1,
    },
  ],
};

const output = resolve(
  fileURLToPath(
    new URL("../../../output/pdf/initial-invoice-preview.pdf", import.meta.url),
  ),
);
await mkdir(resolve(output, ".."), { recursive: true });
const bytes = await new ChromiumInvoicePdfRenderer().render(invoice);
await writeFile(output, bytes, { flag: "w", mode: 0o600 });
process.stdout.write(`Rendered local preview PDF: ${output}\n`);
