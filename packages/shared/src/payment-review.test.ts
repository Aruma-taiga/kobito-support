import { describe, expect, it } from "vitest";
import {
  adminPaymentReviewsQuerySchema,
  adminPaymentReviewsResponseSchema,
} from "./admin.js";

describe("admin payment reviews schemas", () => {
  it("bounds the query limit and validates safe review response rows", () => {
    expect(adminPaymentReviewsQuerySchema.parse({ limit: "5" })).toEqual({
      limit: 5,
    });
    expect(
      adminPaymentReviewsQuerySchema.safeParse({ limit: "101" }).success,
    ).toBe(false);
    expect(
      adminPaymentReviewsResponseSchema.safeParse({
        events: [
          {
            eventId: "evt_test",
            eventType: "payment.captured",
            invoiceNo: null,
            receivedAt: "2026-11-01T00:00:00.000Z",
            reason: "invoice_not_found",
            notificationAmount: 11000,
            invoiceTotal: null,
            shopName: null,
          },
        ],
        failedInvoices: [
          {
            invoiceId: "11111111-1111-4111-8111-111111111111",
            invoiceNo: "KS-2026-00001",
            shopName: "喫茶こびと",
            totalInclTax: 11000,
            reasonCode: "payment.failed",
            dueOn: "2026-11-08",
          },
        ],
        eventCount: 1,
        failedInvoiceCount: 1,
      }).success,
    ).toBe(true);
    expect(
      adminPaymentReviewsResponseSchema.safeParse({
        events: [],
        failedInvoices: [],
        eventCount: 0,
        failedInvoiceCount: 0,
        rawPayload: { email: "private@example.jp" },
      }).success,
    ).toBe(false);
  });
});
