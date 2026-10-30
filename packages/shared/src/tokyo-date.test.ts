import { describe, expect, it } from "vitest";
import { toTokyoDate } from "./tokyo-date.js";

describe("Tokyo calendar date conversion", () => {
  it("uses the Tokyo date across midnight while the instant is still UTC January", () => {
    expect(toTokyoDate(new Date("2026-01-31T15:30:00.000Z"))).toBe(
      "2026-02-01",
    );
    expect(toTokyoDate(new Date("2026-01-31T14:59:00.000Z"))).toBe(
      "2026-01-31",
    );
  });

  it("rejects invalid instants", () => {
    expect(() => toTokyoDate(new Date(Number.NaN))).toThrow(RangeError);
  });
});
