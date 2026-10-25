import { describe, expect, it } from "vitest";
import {
  applicationFormSchema,
  balanceOf,
  canApprove,
  canTransition,
  canTransitionContract,
  canTransitionInvoice,
  canTransitionRequest,
  completionEntries,
  completionEntriesForPeriod,
  confirmStepSchema,
  formatInvoiceNo,
  invoiceKinds,
  invoiceTotals,
  isPeriodStart,
  notesStepSchema,
  paymentMethods,
  paymentStepSchema,
  periodFor,
  planCatalog,
  planStepSchema,
  shopStepSchema,
  splitTax,
  validationMessages,
} from "./index.js";

describe("gross-price calculations", () => {
  it.each([
    [5000, 454, 4546],
    [10000, 909, 9091],
    [15000, 1363, 13637],
    [4000, 363, 3637],
    [0, 0, 0],
  ])("splits %i yen into tax %i and net %i", (grossYen, taxYen, netYen) => {
    expect(splitTax(grossYen)).toEqual({ grossYen, taxYen, netYen });
  });

  it("uses integer arithmetic safely through the largest safe gross amount", () => {
    const grossYen = Number.MAX_SAFE_INTEGER;
    const result = splitTax(grossYen);
    expect(result.grossYen).toBe(grossYen);
    expect(result.taxYen + result.netYen).toBe(grossYen);
    expect(Number.isSafeInteger(result.taxYen)).toBe(true);
    expect(Number.isSafeInteger(result.netYen)).toBe(true);
  });

  it.each([
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects invalid gross amount %s", (grossYen) =>
    expect(() => splitTax(grossYen)).toThrow());

  it("sums invoice lines before rounding tax once", () => {
    expect(invoiceTotals([6, 6])).toEqual({
      grossYen: 12,
      taxYen: 1,
      netYen: 11,
    });
    expect(splitTax(6).taxYen + splitTax(6).taxYen).toBe(0);
  });

  it("rejects invalid line amounts and overflow in an invoice sum", () => {
    expect(() => invoiceTotals([10, -1])).toThrow();
    expect(() => invoiceTotals([10.5])).toThrow();
    expect(() => invoiceTotals([Number.MAX_SAFE_INTEGER, 1])).toThrow();
  });

  it("exposes the four approved plans and one-time credit price", () => {
    expect(planCatalog).toEqual({
      light: {
        code: "light",
        label: "ライト",
        monthlyGrossYen: 5000,
        monthlyCredits: 1,
      },
      standard: {
        code: "standard",
        label: "スタンダード",
        monthlyGrossYen: 10000,
        monthlyCredits: 3,
      },
      premium: {
        code: "premium",
        label: "プレミアム",
        monthlyGrossYen: 15000,
        monthlyCredits: 5,
      },
      custom: {
        code: "custom",
        label: "個別見積り",
        monthlyGrossYen: null,
        monthlyCredits: null,
      },
    });
    expect(planCatalog.custom.monthlyGrossYen).toBeNull();
    expect(planCatalog.custom.monthlyCredits).toBeNull();
    expect(planCatalog.light.label).toBe("ライト");
    expect(paymentMethods).toEqual(["card", "konbini", "bank_transfer"]);
    expect(invoiceKinds).toEqual(["initial", "monthly", "extra_credit"]);
  });
});

describe("anchor-month billing periods", () => {
  it("checks a valid final-year start without needing an out-of-range end date", () => {
    expect(isPeriodStart("9999-12-01", "9999-12-01")).toBe(true);
  });

  it.each([
    [0, "2026-01-31", "2026-02-27"],
    [1, "2026-02-28", "2026-03-30"],
    [2, "2026-03-31", "2026-04-29"],
    [3, "2026-04-30", "2026-05-30"],
    [4, "2026-05-31", "2026-06-29"],
  ])("computes Jan 31 2026 sequence %i", (sequence, startsOn, endsOn) => {
    expect(periodFor("2026-01-31", sequence)).toEqual({ startsOn, endsOn });
  });

  it.each([
    [0, "2028-01-31", "2028-02-28"],
    [1, "2028-02-29", "2028-03-30"],
    [2, "2028-03-31", "2028-04-29"],
    [3, "2028-04-30", "2028-05-30"],
    [4, "2028-05-31", "2028-06-29"],
  ])("restores a leap-year Jan 31 anchor at sequence %i", (sequence, startsOn, endsOn) => {
    expect(periodFor("2028-01-31", sequence)).toEqual({ startsOn, endsOn });
  });

  it.each([
    ["2000-01-31", 1, "2000-02-29", "2000-03-30"],
    ["2100-01-31", 1, "2100-02-28", "2100-03-30"],
    ["2026-12-31", 1, "2027-01-31", "2027-02-27"],
    ["2028-02-29", 12, "2029-02-28", "2029-03-28"],
  ])("uses Gregorian month lengths from %s at sequence %i", (anchor, sequence, startsOn, endsOn) => {
    expect(periodFor(anchor, sequence)).toEqual({ startsOn, endsOn });
  });

  it("recognizes only anchored starts and never a date before the anchor", () => {
    expect(isPeriodStart("2026-01-31", "2026-01-31")).toBe(true);
    expect(isPeriodStart("2026-01-31", "2026-02-28")).toBe(true);
    expect(isPeriodStart("2026-01-31", "2026-03-31")).toBe(true);
    expect(isPeriodStart("2026-01-31", "2026-03-28")).toBe(false);
    expect(isPeriodStart("2026-01-31", "2026-01-30")).toBe(false);
  });

  it.each([
    ["2026-02-29", 0],
    ["2026-01-01", -1],
    ["2026-01-01", 1.5],
    ["2026-01-01", Number.MAX_SAFE_INTEGER + 1],
    ["2026-13-01", 0],
    ["2026-1-01", 0],
  ])("rejects invalid anchor or sequence %s / %s", (anchor, sequence) => {
    expect(() => periodFor(anchor, sequence)).toThrow();
  });
});

describe("period-scoped credit ledger", () => {
  it("balances each period independently and keeps the estimate's source period", () => {
    const entries = [
      { periodId: "period-a", kind: "grant", amount: 5 },
      { periodId: "period-a", kind: "reserve", amount: -3 },
      ...completionEntriesForPeriod("period-a", 3, 2),
      { periodId: "period-b", kind: "grant", amount: 2 },
      { periodId: "period-b", kind: "extra", amount: 1 },
      { periodId: "period-c", kind: "grant", amount: 4 },
      { periodId: "period-c", kind: "expire", amount: -1 },
    ] as const;
    const balances = balanceOf(entries);
    expect(balances.get("period-a")).toBe(3);
    expect(balances.get("period-b")).toBe(3);
    expect(balances.get("period-c")).toBe(3);
    expect(balances.size).toBe(3);
    expect(completionEntriesForPeriod("period-a", 3, 2)).toEqual([
      { periodId: "period-a", kind: "release", amount: 3 },
      { periodId: "period-a", kind: "consume", amount: -2 },
    ]);
    expect(completionEntries(3, 2)).toEqual([
      { kind: "release", amount: 3 },
      { kind: "consume", amount: -2 },
    ]);
  });

  it.each([
    [1, 3, -2],
    [3, 3, 0],
    [5, 3, 2],
  ])("completion reserves %i, actual %i, releasing the reservation and consuming actual", (reserved, actual, expectedNet) => {
    const net = completionEntries(reserved, actual).reduce(
      (sum, entry) => sum + entry.amount,
      0,
    );
    expect(net).toBe(expectedNet);
  });

  it("allows an approval exactly at the balance and denies an insufficient balance", () => {
    expect(canApprove(3, 3)).toBe(true);
    expect(canApprove(4, 3)).toBe(false);
    expect(canApprove(1, 0)).toBe(false);
    expect(canApprove(1, -1)).toBe(false);
  });

  it("rejects flipped signs, invalid credits, empty period ids, and unsafe totals", () => {
    expect(() =>
      balanceOf([{ periodId: "p", kind: "grant", amount: -1 }]),
    ).toThrow();
    expect(() =>
      balanceOf([{ periodId: "p", kind: "reserve", amount: 1 }]),
    ).toThrow();
    expect(() =>
      balanceOf([{ periodId: "", kind: "grant", amount: 1 }]),
    ).toThrow();
    expect(() =>
      balanceOf([
        { periodId: "p", kind: "grant", amount: Number.MAX_SAFE_INTEGER },
        { periodId: "p", kind: "extra", amount: 1 },
      ]),
    ).toThrow();
    const cancellation = [
      { periodId: "p", kind: "grant", amount: Number.MAX_SAFE_INTEGER },
      { periodId: "p", kind: "extra", amount: 1 },
      { periodId: "p", kind: "expire", amount: -1 },
    ] as const;
    expect(balanceOf(cancellation).get("p")).toBe(Number.MAX_SAFE_INTEGER);
    expect(balanceOf([...cancellation].reverse()).get("p")).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(() => canApprove(-1, 1)).toThrow();
    expect(() => canApprove(1, Number.MAX_SAFE_INTEGER + 1)).toThrow();
    expect(() => completionEntries(0, 0)).toThrow();
    expect(() => completionEntries(1, -1)).toThrow();
    expect(() => completionEntriesForPeriod("", 1, 0)).toThrow();
  });
});

describe("invoice numbers", () => {
  it.each([
    ["KS", 2026, 1, "KS-2026-00001"],
    ["KS", 2026, 99999, "KS-2026-99999"],
    ["KS", 2026, 100000, "KS-2026-100000"],
    ["A-2", 9, 7, "A-2-0009-00007"],
  ])("formats %s / %i / %i", (prefix, year, sequence, expected) => {
    expect(formatInvoiceNo(prefix, year, sequence)).toBe(expected);
  });

  it.each([
    ["", 2026, 1],
    ["KS\nX", 2026, 1],
    ["K/ S", 2026, 1],
    ["KS", 0, 1],
    ["KS", 2026.5, 1],
    ["KS", 10000, 1],
    ["KS", 2026, 0],
    ["KS", 2026, Number.MAX_SAFE_INTEGER + 1],
  ])("rejects invalid invoice number components %s / %s / %s", (prefix, year, sequence) => {
    expect(() => formatInvoiceNo(prefix, year, sequence)).toThrow();
  });
});

describe("state transitions", () => {
  it("exports the canonical contract transition API", () => {
    expect(canTransition("under_review", "awaiting_payment")).toBe(true);
  });

  it("matches only the explicitly approved contract edges", () => {
    const states = [
      "under_review",
      "quoting",
      "awaiting_quote_approval",
      "awaiting_payment",
      "active",
      "cancel_scheduled",
      "ended",
      "declined",
      "lapsed",
    ] as const;
    const allowed = new Set([
      "under_review>awaiting_payment",
      "under_review>quoting",
      "under_review>declined",
      "quoting>awaiting_quote_approval",
      "awaiting_quote_approval>quoting",
      "awaiting_quote_approval>awaiting_payment",
      "awaiting_quote_approval>lapsed",
      "awaiting_payment>active",
      "awaiting_payment>lapsed",
      "active>cancel_scheduled",
      "cancel_scheduled>active",
      "cancel_scheduled>ended",
    ]);
    for (const from of states) {
      for (const to of states) {
        expect(canTransitionContract(from, to)).toBe(
          allowed.has(`${from}>${to}`),
        );
      }
    }
  });

  it("matches only the explicitly approved invoice edges", () => {
    const states = ["issued", "paid", "failed", "overdue", "void"] as const;
    const allowed = new Set([
      "issued>paid",
      "issued>failed",
      "issued>overdue",
      "issued>void",
      "failed>paid",
      "overdue>paid",
    ]);
    for (const from of states) {
      for (const to of states) {
        expect(canTransitionInvoice(from, to)).toBe(
          allowed.has(`${from}>${to}`),
        );
      }
    }
  });

  it("allows request withdrawal only before work starts", () => {
    const states = [
      "received",
      "awaiting_approval",
      "in_progress",
      "done",
      "withdrawn",
    ] as const;
    const allowed = new Set([
      "received>awaiting_approval",
      "received>withdrawn",
      "awaiting_approval>in_progress",
      "awaiting_approval>withdrawn",
      "in_progress>done",
    ]);
    for (const from of states) {
      for (const to of states) {
        expect(canTransitionRequest(from, to)).toBe(
          allowed.has(`${from}>${to}`),
        );
      }
    }
    expect(canTransitionRequest("in_progress", "withdrawn")).toBe(false);
    expect(canTransitionRequest("done", "withdrawn")).toBe(false);
  });
});

const shop = {
  shopName: "さくら店舗",
  contactName: "山田太郎",
  email: "owner@example.jp",
  password: "a secure password",
};

const payment = {
  billingName: "さくら店舗",
  billingAddress: "東京都千代田区1-2-3",
  paymentMethod: "bank_transfer",
};

const requiredConsent = {
  consentBusinessUse: true,
  consentTerms: true,
};

describe("application wizard validation", () => {
  it("validates shop, plan, payment, notes, and confirmation steps", () => {
    expect(shopStepSchema.parse(shop).shopName).toBe("さくら店舗");
    expect(planStepSchema.parse({ planCode: "custom" }).planCode).toBe(
      "custom",
    );
    expect(paymentStepSchema.parse(payment).paymentMethod).toBe(
      "bank_transfer",
    );
    expect(notesStepSchema.parse({})).toEqual({});
    expect(
      notesStepSchema.parse({
        lineDisplayName: "",
        referralCode: " ",
        freeText: " ",
      }).referralCode,
    ).toBeUndefined();
    expect(confirmStepSchema.parse(requiredConsent)).toEqual({
      consentBusinessUse: true,
      consentTerms: true,
      consentMarketing: false,
    });
  });

  it("uses Japanese messages and rejects incomplete identity/payment fields", () => {
    const shopResult = shopStepSchema.safeParse({
      ...shop,
      shopName: " ",
      email: "wrong",
    });
    expect(shopResult.success).toBe(false);
    if (!shopResult.success) {
      expect(
        shopResult.error.issues.some(
          (issue) => issue.message === validationMessages.required,
        ),
      ).toBe(true);
      expect(
        shopResult.error.issues.some(
          (issue) => issue.message === validationMessages.email,
        ),
      ).toBe(true);
    }
    expect(
      shopStepSchema.safeParse({ ...shop, password: "1234567" }).success,
    ).toBe(false);
    expect(planStepSchema.safeParse({ planCode: "one_time" }).success).toBe(
      false,
    );
    expect(
      paymentStepSchema.safeParse({ ...payment, invoiceRegistrationNo: "T123" })
        .success,
    ).toBe(false);
    expect(
      paymentStepSchema.safeParse({ ...payment, paymentMethod: "cash" })
        .success,
    ).toBe(false);
  });

  it("accepts optional invoice registration numbers only in T-plus-13-digit form", () => {
    expect(
      paymentStepSchema.parse({
        ...payment,
        invoiceRegistrationNo: "T1234567890123",
      }).invoiceRegistrationNo,
    ).toBe("T1234567890123");
    expect(
      paymentStepSchema.safeParse({
        ...payment,
        invoiceRegistrationNo: "t1234567890123",
      }).success,
    ).toBe(false);
    expect(
      paymentStepSchema.safeParse({
        ...payment,
        invoiceRegistrationNo: "T12345678901234",
      }).success,
    ).toBe(false);
  });

  it("requires C04 only when the form has a referral code", () => {
    const withoutReferral = applicationFormSchema.parse({
      ...shop,
      planCode: "light",
      ...payment,
      ...requiredConsent,
    });
    expect(withoutReferral.consentMarketing).toBe(false);

    const referred = {
      ...shop,
      planCode: "light",
      ...payment,
      referralCode: "PARTNER-1",
      ...requiredConsent,
    };
    expect(applicationFormSchema.safeParse(referred).success).toBe(false);
    expect(
      applicationFormSchema.safeParse({
        ...referred,
        consentPartnerShare: false,
      }).success,
    ).toBe(false);
    expect(
      applicationFormSchema.safeParse({
        ...referred,
        consentPartnerShare: true,
      }).success,
    ).toBe(true);
  });

  it.each([
    "cardNumber",
    "card_number",
    "cvc",
    "lineUserId",
    "authUserId",
    "termsVersion",
    "submittedAt",
  ])("rejects untrusted or prohibited field %s", (field) => {
    expect(
      applicationFormSchema.safeParse({
        ...shop,
        planCode: "light",
        ...payment,
        ...requiredConsent,
        [field]: "unexpected",
      }).success,
    ).toBe(false);
  });
});
