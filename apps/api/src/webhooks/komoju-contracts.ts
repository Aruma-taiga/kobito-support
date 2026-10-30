export interface KomojuInboxEvent {
  id: string;
  type: string;
  data: {
    id?: string;
    status?: string;
    amount?: number;
    currency?: string;
    external_order_num?: string;
  };
}

export type KomojuInboxResult = "accepted" | "duplicate" | "collision";

export interface KomojuInbox {
  receive(event: KomojuInboxEvent): Promise<KomojuInboxResult>;
}
