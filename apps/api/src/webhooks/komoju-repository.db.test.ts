import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { KomojuInboxRepository } from "./komoju-repository.js";

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const repository = new KomojuInboxRepository(pool);

afterAll(async () => pool.end());

describe("KOMOJU durable inbox", () => {
  it("accepts exact and concurrent redelivery once, and durably marks event ID collisions", async () => {
    const id = `evt_${randomUUID().replaceAll("-", "")}`;
    const event = {
      id,
      type: "payment.captured",
      data: {
        id: "pay_123",
        amount: 2500,
        currency: "JPY",
        status: "captured",
        metadata: { value: "METADATA_SENTINEL" },
        payment_details: {
          number: "PAN_SENTINEL",
          security_code: "CVV_SENTINEL",
        },
      },
    };
    const changedIgnoredFields = {
      type: event.type,
      data: {
        payment_details: { number: "CHANGED_PAN_SENTINEL" },
        status: "captured",
        currency: "JPY",
        amount: 2500,
        id: "pay_123",
        metadata: { value: "CHANGED_METADATA_SENTINEL" },
      },
      id,
    };
    try {
      const concurrent = await Promise.all([
        repository.receive(event),
        repository.receive(event),
        repository.receive(event),
      ]);
      expect(concurrent.filter((result) => result === "accepted")).toHaveLength(
        1,
      );
      expect(
        concurrent.filter((result) => result === "duplicate"),
      ).toHaveLength(2);
      await expect(repository.receive(event)).resolves.toBe("duplicate");
      await expect(repository.receive(changedIgnoredFields)).resolves.toBe(
        "duplicate",
      );

      await expect(
        repository.receive({ ...event, data: { ...event.data, amount: 2501 } }),
      ).resolves.toBe("collision");
      await expect(repository.receive(event)).resolves.toBe("collision");

      const stored = await pool.query<{
        type: string;
        payload: unknown;
        processed_at: Date | null;
        error: string | null;
        fingerprint: string;
        collision_count: number;
        collision_detected_at: Date | null;
      }>(
        `select type, payload, processed_at, error, fingerprint, collision_count, collision_detected_at
         from komoju_events where id = $1`,
        [id],
      );
      expect(stored.rows[0]).toMatchObject({
        type: "payment.captured",
        payload: {
          id,
          type: "payment.captured",
          data: {
            id: "pay_123",
            status: "captured",
            amount: 2500,
            currency: "JPY",
          },
        },
        processed_at: null,
        error: null,
        fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        collision_count: 1,
        collision_detected_at: expect.any(Date),
      });
      const serialized = JSON.stringify(stored.rows[0]?.payload);
      for (const sentinel of [
        "METADATA_SENTINEL",
        "CHANGED_METADATA_SENTINEL",
        "PAN_SENTINEL",
        "CHANGED_PAN_SENTINEL",
        "CVV_SENTINEL",
      ]) {
        expect(serialized).not.toContain(sentinel);
      }
    } finally {
      await pool.query("delete from komoju_events where id = $1", [id]);
    }
  });

  it("stores only sanitized provider data and leaves the event unprocessed", async () => {
    const id = `evt_${randomUUID().replaceAll("-", "")}`;
    const event = {
      id,
      type: "payment.captured",
      data: {
        id: "pay_234",
        amount: 2500,
        currency: "JPY",
        status: "captured",
        external_order_num: "KS-2026-00001",
      },
    };
    try {
      await repository.receive(event);
      const result = await pool.query<{
        payload: unknown;
        processed_at: Date | null;
      }>("select payload, processed_at from komoju_events where id = $1", [id]);
      expect(result.rows[0]?.payload).toEqual(event);
      expect(result.rows[0]?.processed_at).toBeNull();
      expect(JSON.stringify(result.rows[0]?.payload)).not.toMatch(
        /PAN|CVV|EXPIRY|metadata/,
      );
    } finally {
      await pool.query("delete from komoju_events where id = $1", [id]);
    }
  });
});
