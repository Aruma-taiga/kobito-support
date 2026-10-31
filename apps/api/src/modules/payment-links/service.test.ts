import { describe, expect, it, vi } from "vitest";
import { FakeKomojuClient } from "../../integrations/komoju/fake-client.js";
import { ApiError } from "../../platform/types.js";
import type { PaymentLinkInvoice, PaymentLinkRepository } from "./contracts.js";
import { PaymentLinkService } from "./service.js";

const invoiceId = "44444444-4444-4444-8444-444444444444";
const principal = {
  authUserId: "verified-user",
  role: "customer" as const,
  customerId: "customer-1",
  secondFactor: null,
};
const paidInvoice: PaymentLinkInvoice = {
  invoiceNo: "KS-2026-00001",
  amountYen: 16_500,
  paymentMethod: "card",
  status: "issued",
};

function setup(
  options: {
    invoice?: PaymentLinkInvoice | null;
    komoju?: FakeKomojuClient;
  } = {},
) {
  const repository: PaymentLinkRepository = {
    getCustomerInvoice: vi.fn(async (scope) => {
      expect(scope.customerId).toBe(principal.customerId);
      if (!options.invoice) throw new ApiError(404, "not_found");
      return options.invoice;
    }),
    recordCustomerLinkCreated: vi.fn(async () => undefined),
  };
  return {
    repository,
    komoju: options.komoju ?? new FakeKomojuClient(),
    service: new PaymentLinkService(
      repository,
      options.komoju ?? new FakeKomojuClient(),
      "https://app.example.test",
    ),
  };
}

describe("PaymentLinkService", () => {
  it("uses the invoice number and inclusive total and returns only the hosted URL", async () => {
    const komoju = new FakeKomojuClient();
    const { service, repository } = setup({ invoice: paidInvoice, komoju });
    await expect(service.create(principal, invoiceId)).resolves.toEqual({
      redirectUrl: "https://komoju.com/sessions/fake-session-id",
    });
    expect(komoju.requests).toEqual([
      {
        invoiceNo: "KS-2026-00001",
        amountYen: 16_500,
        returnUrl: `https://app.example.test/me/invoices/${invoiceId}`,
      },
    ]);
    expect(repository.recordCustomerLinkCreated).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: principal.customerId }),
      principal.authUserId,
      invoiceId,
    );
  });

  it.each([
    [{ ...paidInvoice, paymentMethod: "bank_transfer" }, "bank transfer"],
    [{ ...paidInvoice, status: "paid" }, "paid invoice"],
    [{ ...paidInvoice, status: "failed" }, "failed invoice"],
  ])("rejects a %s before contacting KOMOJU", async (invoice) => {
    const komoju = new FakeKomojuClient();
    const { service } = setup({
      invoice: invoice as PaymentLinkInvoice,
      komoju,
    });
    await expect(service.create(principal, invoiceId)).rejects.toMatchObject({
      status: 409,
      code: "conflict",
    });
    expect(komoju.requests).toHaveLength(0);
  });

  it("returns 404 for another customer's invoice", async () => {
    const { service, komoju } = setup({ invoice: null });
    await expect(service.create(principal, invoiceId)).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
    expect(komoju.requests).toHaveLength(0);
  });

  it("returns the dedicated unavailable response when no key configured", async () => {
    const { repository } = setup({ invoice: paidInvoice });
    const service = new PaymentLinkService(
      repository,
      undefined,
      "https://app.example.test",
    );
    await expect(service.create(principal, invoiceId)).rejects.toMatchObject({
      status: 503,
      code: "payment_link_unavailable",
    });
  });

  it("does not expose provider errors that may contain secrets or card data", async () => {
    const sensitive = "api-key-secret card 4111111111111111";
    const komoju = new FakeKomojuClient(undefined, new Error(sensitive));
    const { service } = setup({ invoice: paidInvoice, komoju });
    try {
      await service.create(principal, invoiceId);
      throw new Error("expected payment link error");
    } catch (error) {
      expect(error).toMatchObject({ status: 502, code: "payment_link_failed" });
      expect(String(error)).not.toContain(sensitive);
    }
  });
});
