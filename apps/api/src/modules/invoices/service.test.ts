import { describe, expect, it, vi } from "vitest";
import { InvoiceService } from "./service.js";

const scope = { customerId: "00000000-0000-4000-8000-000000000001" } as never;
const base = {
  getReadiness: vi.fn(),
  approveApplication: vi.fn(),
  listCustomer: vi.fn(),
  getCustomer: vi.fn(),
  getCustomerPdf: vi.fn(),
  listAdmin: vi.fn(),
  getAdmin: vi.fn(),
  getAdminPdf: vi.fn(),
  listPendingBankTransfers: vi.fn(),
  confirmBankPayment: vi.fn(),
  voidInvoice: vi.fn(),
  getCustomerContract: vi.fn(),
  purchaseExtraCredits: vi.fn(async (_scope, _request, _key) => ({
    invoiceId: "00000000-0000-4000-8000-000000000002",
    invoiceNo: "KS-2026-2",
    totalExclTax: 4000,
    taxAmount: 400,
    totalInclTax: 4400,
    paymentMethod: "card" as const,
  })),
};

describe("InvoiceService extra-credit purchase validation", () => {
  it("rejects quantities outside one through ten before repository access", async () => {
    const service = new InvoiceService(base);
    for (const quantity of [0, 11, 1.5]) {
      await expect(
        Promise.resolve().then(() =>
          service.purchaseExtraCredits(scope, { quantity }, "key-1"),
        ),
      ).rejects.toMatchObject({ status: 422 });
    }
    expect(base.purchaseExtraCredits).not.toHaveBeenCalled();
  });
  it("requires a bounded idempotency key", async () => {
    const service = new InvoiceService(base);
    await expect(
      Promise.resolve().then(() =>
        service.purchaseExtraCredits(scope, { quantity: 1 }, " "),
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(base.purchaseExtraCredits).not.toHaveBeenCalled();
  });
});

describe("InvoiceService invoice voiding", () => {
  it("requires an MFA admin and a valid invoice id and reason", async () => {
    const service = new InvoiceService(base);
    const customer = { role: "customer", secondFactor: false } as never;
    const admin = { role: "admin", secondFactor: true } as never;
    await expect(
      Promise.resolve().then(() =>
        service.voidInvoice(customer, "00000000-0000-4000-8000-000000000001", {
          reason: "理由",
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      Promise.resolve().then(() =>
        service.voidInvoice(
          { role: "admin", secondFactor: false } as never,
          "00000000-0000-4000-8000-000000000001",
          { reason: "理由" },
        ),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      Promise.resolve().then(() =>
        service.voidInvoice(admin, "bad-id", { reason: "理由" }),
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      Promise.resolve().then(() =>
        service.voidInvoice(admin, "00000000-0000-4000-8000-000000000001", {
          reason: " ",
        }),
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(base.voidInvoice).not.toHaveBeenCalled();
  });
});
