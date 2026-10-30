import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type {
  KomojuInbox,
  KomojuInboxEvent,
  KomojuInboxResult,
} from "./komoju-contracts.js";
import { parseKomojuInboxEvent } from "./komoju-validation.js";

export class KomojuInboxRepository implements KomojuInbox {
  constructor(private readonly pool: Pool) {}

  async receive(event: KomojuInboxEvent): Promise<KomojuInboxResult> {
    const payload = parseKomojuInboxEvent(event);
    if (!payload) throw new Error("Invalid KOMOJU inbox event");
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const inserted = await client.query(
        `insert into komoju_events (id, type, payload, fingerprint)
         values ($1, $2, $3::jsonb, $4) on conflict (id) do nothing returning id`,
        [event.id, event.type, JSON.stringify(payload), fingerprint],
      );
      const existing = await client.query<{
        fingerprint: string;
        collision_count: number;
      }>(
        "select fingerprint, collision_count from komoju_events where id = $1 for update",
        [event.id],
      );
      const row = existing.rows[0];
      if (!row) throw new Error("KOMOJU inbox insert was not available");
      if (row.fingerprint !== fingerprint) {
        await client.query(
          `update komoju_events set collision_detected_at = coalesce(collision_detected_at, now()),
             collision_count = collision_count + 1 where id = $1`,
          [event.id],
        );
        await client.query("commit");
        return "collision";
      }
      await client.query("commit");
      if (row.collision_count > 0) return "collision";
      return inserted.rowCount ? "accepted" : "duplicate";
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
