import { describe, expect, it } from "vitest";
import { calendarDaysBetween, retentionDueDate } from "./retention.js";

describe("retentionDueDate", () => {
  it("returns the calendar anniversary one year after a terminal transition", () => {
    expect(retentionDueDate("ended", "2025-11-01")).toBe("2026-11-01");
    expect(retentionDueDate("lapsed", "2024-02-29")).toBe("2025-02-28");
  });

  it.each([
    "active",
    "cancel_scheduled",
    "awaiting_payment",
  ] as const)("does not schedule %s contracts", (status) =>
    expect(retentionDueDate(status, "2025-11-01")).toBeNull());

  it("counts the due date as day zero and validates calendar strings", () => {
    expect(calendarDaysBetween("2026-10-31", "2026-11-01")).toBe(1);
    expect(calendarDaysBetween("2026-11-01", "2026-11-01")).toBe(0);
    expect(() => retentionDueDate("ended", "2025-02-29")).toThrow(RangeError);
  });
});
