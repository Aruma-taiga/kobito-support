import { describe, expect, it } from "vitest";
import {
  approveEstimateSchema,
  createEstimateSchema,
  createRequestSchema,
} from "./requests.js";

describe("request and estimate contracts", () => {
  it("requires all bounded estimate fields and a nonempty work list", () => {
    expect(
      createEstimateSchema.safeParse({
        credits: 1,
        dueOn: "2026-10-25",
        workItems: [],
        doneCriteria: "done",
      }).success,
    ).toBe(false);
    expect(
      createEstimateSchema.safeParse({
        credits: 1,
        dueOn: "2026-10-25",
        workItems: ["画像調整"],
        doneCriteria: "掲載ページで確認できる",
      }).success,
    ).toBe(true);
  });

  it("rejects unknown fields, oversized strings, and empty request summaries", () => {
    expect(
      createRequestSchema.safeParse({
        receivedOn: "2026-10-26",
        summary: "",
        urgent: false,
      }).success,
    ).toBe(false);
    expect(
      createRequestSchema.safeParse({
        receivedOn: "2026-10-26",
        summary: "相談",
        urgent: false,
        other: true,
      }).success,
    ).toBe(false);
    expect(approveEstimateSchema.safeParse({}).success).toBe(true);
  });
});
