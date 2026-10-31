import { describe, expect, it } from "vitest";
import {
  confirmBankPaymentRequestSchema,
  confirmBankPaymentResponseSchema,
} from "./bank-transfer.js";

describe("bank payment request", () => {
  it("accepts confirmation of a later billing period", () => {
    expect(
      confirmBankPaymentResponseSchema.safeParse({
        invoiceId: "00000000-0000-4000-8000-000000000001",
        paymentId: "00000000-0000-4000-8000-000000000002",
        amount: 5500,
        paidOn: "2026-02-28",
        contractId: "00000000-0000-4000-8000-000000000003",
        anchorDate: "2026-01-31",
        period: {
          id: "00000000-0000-4000-8000-000000000004",
          seq: 2,
          startsOn: "2026-02-28",
          endsOn: "2026-03-30",
          priceExclTax: 5000,
          credits: 1,
        },
        preview: false,
        replayed: false,
      }).success,
    ).toBe(true);
  });
  it("defaults preview acknowledgement to false and rejects extra fields", () => {
    expect(
      confirmBankPaymentRequestSchema.parse({
        amount: 5000,
        paidOn: "2024-02-29",
      }),
    ).toEqual({
      amount: 5000,
      paidOn: "2024-02-29",
      previewAcknowledged: false,
    });
    expect(
      confirmBankPaymentRequestSchema.safeParse({
        amount: 5000,
        paidOn: "2024-02-29",
        bankAccount: "secret",
      }).success,
    ).toBe(false);
  });

  it.each([
    "2023-02-29",
    "2026-04-31",
    "2026-00-01",
    "2026-10-26T00:00:00Z",
  ])("rejects invalid calendar date %s", (paidOn) =>
    expect(
      confirmBankPaymentRequestSchema.safeParse({ amount: 1, paidOn }).success,
    ).toBe(false));
});
