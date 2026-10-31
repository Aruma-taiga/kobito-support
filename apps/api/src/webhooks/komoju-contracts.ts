export interface KomojuInboxEvent {
  id: string;
  type: string;
  data: {
    id?: string;
    status?: string;
    amount?: number;
    tax?: number;
    total?: number;
    currency?: string;
    external_order_num?: string;
    captured_at?: string | null;
  };
}

export type KomojuInboxResult = "accepted" | "duplicate" | "collision";

export interface KomojuInbox {
  receive(event: KomojuInboxEvent): Promise<KomojuInboxResult>;
}

export type KomojuEventResult = "processed" | "review";

export interface KomojuEventProcessorRepository {
  listUnprocessed(limit: number): Promise<string[]>;
  processEvent(eventId: string): Promise<KomojuEventResult>;
  recordProcessingFailure(eventId: string, code: string): Promise<void>;
}
