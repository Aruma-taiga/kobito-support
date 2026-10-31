import type {
  KomojuEventProcessorRepository,
  KomojuEventResult,
} from "./komoju-contracts.js";

export interface KomojuProcessingSummary {
  processed: number;
  review: number;
  failed: number;
}

export class KomojuEventProcessor {
  constructor(private readonly repository: KomojuEventProcessorRepository) {}

  async processPending(limit = 100): Promise<KomojuProcessingSummary> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
      throw new RangeError(
        "KOMOJU processing limit must be between 1 and 1000",
      );
    const eventIds = await this.repository.listUnprocessed(limit);
    const summary: KomojuProcessingSummary = {
      processed: 0,
      review: 0,
      failed: 0,
    };
    for (const eventId of eventIds) {
      try {
        const result: KomojuEventResult =
          await this.repository.processEvent(eventId);
        summary[result] += 1;
      } catch {
        try {
          await this.repository.recordProcessingFailure(
            eventId,
            "processing_failed",
          );
        } catch {
          // A later batch can retry while the event remains unprocessed.
        }
        summary.failed += 1;
      }
    }
    return summary;
  }
}
