import { describe, expect, it } from "vitest";
import {
  adminApplicationQueueQuerySchema,
  adminApplicationQueueResponseSchema,
  adminCustomerDetailSchema,
  adminSessionSchema,
  approveApplicationResponseSchema,
  declineApplicationRequestSchema,
  declineApplicationResponseSchema,
} from "./admin.js";

const customerSummary = {
  customerId: "11111111-1111-4111-8111-111111111111",
  shopName: "店舗",
  contactName: "担当者",
  email: "owner@example.test",
  submittedAt: "2026-10-26T00:00:00.000Z",
  planName: "ライト",
  priceExclTax: 5000,
  credits: 1,
  paymentMethod: "bank_transfer",
  status: "under_review",
};

const customerDetail = {
  customer: {
    id: "11111111-1111-4111-8111-111111111111",
    shopName: "店舗",
    contactName: "担当者",
    email: "owner@example.test",
    phone: null,
    billingName: "店舗",
    billingAddress: "住所",
    invoiceRegistrationNo: null,
  },
  application: {
    id: "22222222-2222-4222-8222-222222222222",
    submittedAt: "2026-10-26T00:00:00.000Z",
    paymentMethod: "bank_transfer",
    termsVersion: "terms-v1",
    privacyVersion: "privacy-v1",
    disclosureVersion: "disclosure-v1",
    consentBusinessUse: true,
    consentTerms: true,
    consentMarketing: false,
    consentPartnerShare: null,
    shownTerms: { priceExclTax: 5000, credits: 1 },
    referralCode: null,
    freeText: null,
    reviewResult: null,
    rejectionNote: null,
  },
  contract: {
    id: "33333333-3333-4333-8333-333333333333",
    status: "under_review",
  },
};

describe("admin DTO validation", () => {
  it("keeps approval status and invoice presence consistent", () => {
    const base = {
      applicationId: "22222222-2222-4222-8222-222222222222",
      contractId: "33333333-3333-4333-8333-333333333333",
      replayed: false,
    };
    const invoice = {
      id: "44444444-4444-4444-8444-444444444444",
      invoiceNo: "KS-2026-00001",
      kind: "initial",
      status: "issued",
      issuedOn: "2026-10-26",
      dueOn: "2026-11-02",
      totalInclTax: 5000,
      totalExclTax: 4546,
      taxAmount: 454,
      paymentMethod: "bank_transfer",
      preview: false,
    };

    expect(
      approveApplicationResponseSchema.safeParse({
        ...base,
        status: "awaiting_payment",
        invoice,
      }).success,
    ).toBe(true);
    expect(
      approveApplicationResponseSchema.safeParse({
        ...base,
        status: "quoting",
        invoice: null,
      }).success,
    ).toBe(true);
    expect(
      approveApplicationResponseSchema.safeParse({
        ...base,
        status: "awaiting_payment",
        invoice: null,
      }).success,
    ).toBe(false);
    expect(
      approveApplicationResponseSchema.safeParse({
        ...base,
        status: "quoting",
        invoice,
      }).success,
    ).toBe(false);
  });

  it("bounds queue filters and pagination", () => {
    expect(
      adminApplicationQueueQuerySchema.parse({
        status: "under_review",
        q: " 店舗 ",
        page: "2",
        pageSize: "50",
      }),
    ).toEqual({ status: "under_review", q: "店舗", page: 2, pageSize: 50 });
    expect(
      adminApplicationQueueQuerySchema.safeParse({ page: "0" }).success,
    ).toBe(false);
    expect(
      adminApplicationQueueQuerySchema.safeParse({ pageSize: "101" }).success,
    ).toBe(false);
    expect(
      adminApplicationQueueQuerySchema.safeParse({ q: "x".repeat(101) })
        .success,
    ).toBe(false);
    expect(
      adminApplicationQueueQuerySchema.safeParse({ debug: "true" }).success,
    ).toBe(false);
  });

  it("validates the queue/detail/decline response contracts", () => {
    expect(
      adminApplicationQueueResponseSchema.parse({
        items: [customerSummary],
        page: 1,
        pageSize: 25,
        total: 1,
      }).items,
    ).toHaveLength(1);
    expect(adminCustomerDetailSchema.parse(customerDetail)).toEqual(
      customerDetail,
    );
    expect(adminSessionSchema.parse({ role: "admin" })).toEqual({
      role: "admin",
    });
    expect(
      declineApplicationRequestSchema.parse({ rejectionNote: "審査結果" }),
    ).toEqual({ rejectionNote: "審査結果" });
    expect(
      declineApplicationRequestSchema.safeParse({
        rejectionNote: "x".repeat(501),
      }).success,
    ).toBe(false);
    expect(
      declineApplicationResponseSchema.parse({
        applicationId: "22222222-2222-4222-8222-222222222222",
        contractId: "33333333-3333-4333-8333-333333333333",
        status: "declined",
        replayed: false,
      }).status,
    ).toBe("declined");
  });
});

describe("due-soon rule", () => {
  it("counts days to the due date and flags 7 days or fewer, including overdue", async () => {
    const { adminDueSoonDays, daysUntil, isDueSoon } = await import(
      "./admin.js"
    );
    expect(adminDueSoonDays).toBe(7);
    expect(daysUntil("2026-11-17", "2026-11-14")).toBe(3);
    expect(daysUntil("2026-12-01", "2026-11-30")).toBe(1);
    expect(daysUntil("2026-11-14", "2026-11-14")).toBe(0);
    expect(daysUntil("2026-11-10", "2026-11-14")).toBe(-4);
    expect(isDueSoon("2026-11-21", "2026-11-14")).toBe(true);
    expect(isDueSoon("2026-11-22", "2026-11-14")).toBe(false);
    expect(isDueSoon("2026-11-01", "2026-11-14")).toBe(true);
  });
});
