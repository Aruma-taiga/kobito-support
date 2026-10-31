import { describe, expect, it, vi } from "vitest";
import { KomojuEventProcessor } from "./komoju-processor.js";

describe("KOMOJU event processor", () => {
  it("processes stored events in order, records failures safely, and continues", async () => {
    const repository = {
      listUnprocessed: vi.fn(async () => ["evt_a", "evt_b", "evt_c"]),
      processEvent: vi.fn(async (id: string) => {
        if (id === "evt_b") throw new Error("PAN_SENTINEL database detail");
        return id === "evt_a" ? ("processed" as const) : ("review" as const);
      }),
      recordProcessingFailure: vi.fn(async () => undefined),
    };
    const processor = new KomojuEventProcessor(repository);

    await expect(processor.processPending()).resolves.toEqual({
      processed: 1,
      review: 1,
      failed: 1,
    });
    expect(repository.processEvent.mock.calls).toEqual([
      ["evt_a"],
      ["evt_b"],
      ["evt_c"],
    ]);
    expect(repository.recordProcessingFailure).toHaveBeenCalledWith(
      "evt_b",
      "processing_failed",
    );
    expect(
      JSON.stringify(repository.recordProcessingFailure.mock.calls),
    ).not.toContain("PAN_SENTINEL");
  });

  it("validates batch limits and returns an empty summary when there is no work", async () => {
    const repository = {
      listUnprocessed: vi.fn(async () => []),
      processEvent: vi.fn(),
      recordProcessingFailure: vi.fn(),
    };
    const processor = new KomojuEventProcessor(repository);

    await expect(processor.processPending()).resolves.toEqual({
      processed: 0,
      review: 0,
      failed: 0,
    });
    await expect(processor.processPending(0)).rejects.toThrow();
  });
});
