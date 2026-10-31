import type { PoolClient } from "pg";

export interface ScheduleNotificationInput {
  customerId?: string;
  kind: string;
  dedupeKey: string;
  scheduledAt: Date;
  payload: Record<string, unknown>;
}

export async function schedule(
  client: PoolClient,
  input: ScheduleNotificationInput,
): Promise<void> {
  await client.query(
    `insert into notifications (customer_id,kind,channel,dedupe_key,scheduled_at,payload)
     values ($1,$2,'email',$3,$4,$5::jsonb) on conflict (dedupe_key) do nothing`,
    [
      input.customerId ?? null,
      input.kind,
      input.dedupeKey,
      input.scheduledAt,
      JSON.stringify(input.payload),
    ],
  );
}
