import { describe, expect, it } from "vitest";
import { localAdminMfaSettings } from "./local-admin-mfa.js";

describe("local admin MFA settings", () => {
  it("provides a stable enrollment ID required by Firebase Auth", () => {
    expect(localAdminMfaSettings("+15555550123")).toEqual({
      enrolledFactors: [
        {
          uid: "local-dev-admin-phone",
          factorId: "phone",
          phoneNumber: "+15555550123",
          displayName: "Local development MFA",
        },
      ],
    });
  });
});
