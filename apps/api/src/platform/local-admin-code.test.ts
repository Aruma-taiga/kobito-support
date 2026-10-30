import { describe, expect, it } from "vitest";
import { findLocalAdminMfaCode } from "./local-admin-code.js";

describe("local admin MFA code lookup", () => {
  it("matches the emulator's masked phone and returns its code", () => {
    expect(
      findLocalAdminMfaCode(
        [
          {
            phoneNumber: "+1******0123",
            code: "654321",
            sessionInfo: "session",
          },
          { phoneNumber: "+1******9999", code: "123456", sessionInfo: "other" },
        ],
        "+15555550123",
      ),
    ).toBe("654321");
  });

  it("returns nothing when no pending code matches the configured phone", () => {
    expect(
      findLocalAdminMfaCode(
        [{ phoneNumber: "+1******9999", code: "123456", sessionInfo: "other" }],
        "+15555550123",
      ),
    ).toBeUndefined();
  });
});
