import { describe, expect, it } from "vitest";
import {
  lineLinkResponseSchema,
  lineLinkStatusResponseSchema,
  lineSignInResponseSchema,
  lineTokenRequestSchema,
} from "./line.js";

describe("LINE API schemas", () => {
  it("accepts only the bounded ID token request and strict responses", () => {
    expect(lineTokenRequestSchema.safeParse({ idToken: "x" }).success).toBe(
      true,
    );
    expect(
      lineTokenRequestSchema.safeParse({ idToken: "x", profile: {} }).success,
    ).toBe(false);
    expect(
      lineTokenRequestSchema.safeParse({ idToken: "x".repeat(16385) }).success,
    ).toBe(false);
    expect(
      lineSignInResponseSchema.parse({ customToken: "c", authUserId: "u" }),
    ).toEqual({ customToken: "c", authUserId: "u" });
    expect(
      lineSignInResponseSchema.safeParse({
        customToken: "c",
        authUserId: "u",
        email: "a",
      }).success,
    ).toBe(false);
    expect(lineLinkResponseSchema.parse({ linked: true })).toEqual({
      linked: true,
    });
    expect(lineLinkStatusResponseSchema.parse({ linked: false })).toEqual({
      linked: false,
    });
  });
});
