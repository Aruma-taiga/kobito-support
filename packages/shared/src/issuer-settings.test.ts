import { describe, expect, it } from "vitest";
import {
  adminIssuerSettingsResponseSchema,
  adminIssuerSettingsSchema,
  updateAdminIssuerSettingsRequestSchema,
} from "./issuer-settings.js";

const settings = {
  serviceName: " コビトサポート ",
  companyName: "",
  companyAddress: "",
  invoiceRegistrationNo: null,
  invoicePrefix: "KS",
  bankAccount: {
    bankName: "",
    branchName: "",
    accountType: "",
    accountNumber: "",
    accountHolder: "",
  },
};

describe("admin issuer settings DTO", () => {
  it("accepts an incomplete issuer while keeping required service and prefix", () => {
    expect(adminIssuerSettingsSchema.parse(settings)).toEqual({
      ...settings,
      serviceName: "コビトサポート",
    });
    expect(
      adminIssuerSettingsSchema.safeParse({ ...settings, serviceName: " " })
        .success,
    ).toBe(false);
    expect(
      adminIssuerSettingsSchema.safeParse({ ...settings, invoicePrefix: "" })
        .success,
    ).toBe(false);
  });

  it("preserves a bank account number as text and requires a valid invoice registration number", () => {
    expect(
      adminIssuerSettingsSchema.parse({
        ...settings,
        invoiceRegistrationNo: "T1234567890123",
        bankAccount: { ...settings.bankAccount, accountNumber: "0012345" },
      }).bankAccount.accountNumber,
    ).toBe("0012345");
    expect(
      adminIssuerSettingsSchema.safeParse({
        ...settings,
        invoiceRegistrationNo: "T123",
      }).success,
    ).toBe(false);
  });

  it("rejects control characters and unrecognized DTO keys", () => {
    expect(
      adminIssuerSettingsSchema.safeParse({
        ...settings,
        companyName: "会社\n名",
      }).success,
    ).toBe(false);
    expect(
      adminIssuerSettingsSchema.safeParse({ ...settings, konbiniFeeYen: 100 })
        .success,
    ).toBe(false);
    for (const invoicePrefix of ["KS_", "KS-", "KS--A"]) {
      expect(
        adminIssuerSettingsSchema.safeParse({ ...settings, invoicePrefix })
          .success,
      ).toBe(false);
    }
  });

  it("validates revision requests and response bodies", () => {
    const revision = "a".repeat(64);
    expect(
      updateAdminIssuerSettingsRequestSchema.parse({
        expectedRevision: revision,
        settings,
      }).expectedRevision,
    ).toBe(revision);
    expect(
      updateAdminIssuerSettingsRequestSchema.safeParse({
        expectedRevision: "stale",
        settings,
      }).success,
    ).toBe(false);
    expect(
      adminIssuerSettingsResponseSchema.parse({
        settings,
        revision,
        issuanceReady: false,
      }).issuanceReady,
    ).toBe(false);
  });
});
