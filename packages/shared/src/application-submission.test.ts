import { describe, expect, it } from "vitest";
import {
  applicationPolicyConditions,
  applicationReceiptSchema,
  applicationSubmissionSchema,
  authenticatedApplicationFormSchema,
  authenticatedShopStepSchema,
  publicConfigSchema,
  publicPartnerSchema,
  publicPlansSchema,
  webMessages,
} from "./index.js";

const submission = {
  shopName: "青空商店",
  contactName: "山田花子",
  email: "hanako@example.test",
  planCode: "light",
  billingName: "青空商店",
  billingAddress: "東京都千代田区1-2-3",
  paymentMethod: "bank_transfer",
  consentBusinessUse: true,
  consentTerms: true,
  displayVersion: "a".repeat(64),
};

const applicationConfig = {
  mode: "preview",
  terms: { url: "https://example.test/terms", version: "案v2" },
  privacy: { url: "https://example.test/privacy", version: "案v1" },
  disclosure: { url: "https://example.test/disclosure", version: "案v1" },
  availablePaymentMethods: ["bank_transfer"],
  konbiniFeeYen: null,
  displayVersion: "a".repeat(64),
  conditions: {
    initialDueDays: 7,
    extraCreditExclYen: 4000,
    monthlyPrepaid: true,
    periodBasis: "contract_anchor",
    rollover: false,
    cancellation: "period_end_no_proration",
  },
};

describe("password-free application boundary contracts", () => {
  it("accepts a strict submission with server-bound display version and defaults marketing consent", () => {
    expect(applicationSubmissionSchema.parse(submission)).toEqual({
      ...submission,
      consentMarketing: false,
    });
  });

  it("rejects password, client identity, version, price, and card fields at the API boundary", () => {
    for (const field of [
      "password",
      "authUserId",
      "termsVersion",
      "priceExclTax",
      "cardNumber",
      "cvc",
    ]) {
      expect(
        applicationSubmissionSchema.safeParse({
          ...submission,
          [field]: "must-not-be-accepted",
        }).success,
      ).toBe(false);
    }
  });

  it("keeps password required only for a new Firebase account and offers passwordless authenticated forms", () => {
    expect(
      authenticatedShopStepSchema.safeParse({
        shopName: submission.shopName,
        contactName: submission.contactName,
        email: submission.email,
      }).success,
    ).toBe(true);
    expect(
      authenticatedShopStepSchema.safeParse({
        shopName: submission.shopName,
        contactName: submission.contactName,
        email: submission.email,
        password: "unused-password",
      }).success,
    ).toBe(false);

    const {
      password: _password,
      displayVersion: _displayVersion,
      ...passwordless
    } = {
      ...submission,
      password: "client-provider-only",
    };
    expect(
      authenticatedApplicationFormSchema.safeParse(passwordless).success,
    ).toBe(true);
  });

  it("preserves the C-04 conditional rule in the password-free submission schema", () => {
    const referred = { ...submission, referralCode: "PARTNER-1" };
    expect(applicationSubmissionSchema.safeParse(referred).success).toBe(false);
    expect(
      applicationSubmissionSchema.safeParse({
        ...referred,
        consentPartnerShare: true,
      }).success,
    ).toBe(true);
  });

  it("keeps old public config readers compatible while validating the optional application offer", () => {
    expect(publicConfigSchema.parse({ serviceName: "サービス" })).toEqual({
      serviceName: "サービス",
    });
    expect(
      publicConfigSchema.parse({ serviceName: "サービス", application: null }),
    ).toEqual({ serviceName: "サービス", application: null });
    expect(
      publicConfigSchema.parse({
        serviceName: "サービス",
        application: applicationConfig,
      }).application,
    ).toEqual(applicationConfig);
    expect(
      publicConfigSchema.safeParse({
        serviceName: "サービス",
        application: { ...applicationConfig, terms: { version: "案v2" } },
      }).success,
    ).toBe(false);
    expect(
      publicConfigSchema.safeParse({
        serviceName: "サービス",
        application: {
          ...applicationConfig,
          terms: { url: "http://example.test/terms", version: "案v2" },
        },
      }).success,
    ).toBe(false);
    expect(
      publicConfigSchema.safeParse({
        serviceName: "サービス",
        application: {
          ...applicationConfig,
          terms: {
            url: "https://user:secret@example.test/terms",
            version: "案v2",
          },
        },
      }).success,
    ).toBe(false);
  });

  it("validates database-backed plan DTOs without assuming prices in the UI", () => {
    expect(
      publicPlansSchema.parse({
        plans: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            code: "light",
            name: "ライト",
            priceExclTax: 5000,
            credits: 1,
            isCustom: false,
          },
          {
            id: "00000000-0000-4000-8000-000000000002",
            code: "custom",
            name: "個別見積り",
            priceExclTax: null,
            credits: null,
            isCustom: true,
          },
        ],
        displayVersion: "a".repeat(64),
      }).plans,
    ).toHaveLength(2);
    expect(
      publicPlansSchema.safeParse({
        plans: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            code: "light",
            name: "ライト",
            priceExclTax: 1,
            credits: 1,
            isCustom: false,
          },
        ],
        displayVersion: "bad",
      }).success,
    ).toBe(false);
  });

  it("exposes only a verified referral partner code and display name", () => {
    expect(
      publicPartnerSchema.parse({ code: "PARTNER-1", name: "紹介パートナー" }),
    ).toEqual({ code: "PARTNER-1", name: "紹介パートナー" });
    expect(
      publicPartnerSchema.safeParse({
        code: "PARTNER-1",
        name: "紹介パートナー",
        email: "private@example.test",
        rewardRate: 0.2,
      }).success,
    ).toBe(false);
  });

  it("validates the stable pending-review receipt returned for both initial and replay responses", () => {
    expect(
      applicationReceiptSchema.parse({
        applicationId: "00000000-0000-4000-8000-000000000001",
        contractId: "00000000-0000-4000-8000-000000000002",
        status: "under_review",
        replayed: true,
      }),
    ).toBeTruthy();
    expect(
      applicationReceiptSchema.safeParse({
        applicationId: "not-a-uuid",
        contractId: "00000000-0000-4000-8000-000000000002",
        status: "active",
        replayed: false,
      }).success,
    ).toBe(false);
  });

  it("exports server-owned application conditions and Japanese copy needed for the confirmation screen", () => {
    expect(applicationPolicyConditions).toEqual({
      initialDueDays: 7,
      extraCreditExclYen: 4000,
      monthlyPrepaid: true,
      periodBasis: "contract_anchor",
      rollover: false,
      cancellation: "period_end_no_proration",
    });
    for (const key of [
      "applicationTitle",
      "applicationDescription",
      "applicationReceiptPendingReview",
      "applicationConditionsChanged",
      "applicationPreviewWarning",
      "applicationPersonalInfoWarning",
      "consentBusinessUse",
      "consentTerms",
      "consentMarketing",
      "consentPartnerShare",
    ] as const) {
      expect(webMessages[key].length).toBeGreaterThan(0);
    }
  });
});
