import { describe, expect, it } from "vitest";
import { confirmBankPaymentRequestSchema } from "./bank-transfer.js";

describe("bank payment request", () => {
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
