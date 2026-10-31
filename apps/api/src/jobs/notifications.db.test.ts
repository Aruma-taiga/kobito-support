import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { FakeMailSender } from "../integrations/mail/sender.js";
import { schedule } from "../modules/notifications/service.js";
import { runNotificationDispatch } from "./notifications.js";

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const suffix = randomUUID();
const dedupeKey = `notification-test:${suffix}`;
const concurrentDedupeKey = `notification-test:${suffix}:concurrent`;
let customerId: string | undefined;

afterAll(async () => {
  try {
    await pool.query("delete from notifications where dedupe_key like $1", [
      `notification-test:${suffix}%`,
    ]);
    if (customerId)
      await pool.query("delete from customers where id=$1", [customerId]);
  } finally {
    await pool.end();
  }
});

describe("notification outbox database behavior", () => {
  it("schedules idempotently with the same dedupe key", async () => {
    const customer = await pool.query<{ id: string }>(
      `insert into customers(shop_name,contact_name,billing_name,billing_address,email)
       values($1,'Notification test','Notification test','Test address',$2) returning id`,
      [`Notification test ${suffix}`, `${suffix}@example.test`],
    );
    customerId = customer.rows[0]?.id;
    if (!customerId) throw new Error("Test customer was not created");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await schedule(client, {
        customerId,
        kind: "NT-01",
        dedupeKey,
        scheduledAt: new Date("2026-11-01T00:00:00Z"),
        payload: { applicationId: randomUUID() },
      });
      await schedule(client, {
        customerId,
        kind: "NT-01",
        dedupeKey,
        scheduledAt: new Date("2026-11-01T00:00:00Z"),
        payload: { applicationId: randomUUID() },
      });
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    const result = await pool.query<{ count: number }>(
      "select count(*)::int as count from notifications where dedupe_key=$1",
      [dedupeKey],
    );
    expect(result.rows[0]?.count).toBe(1);
  });

  it("leaves a due notice scheduled when mail is disabled", async () => {
    const before = await pool.query<{ attempts: number; sent_at: Date | null }>(
      "select attempts,sent_at from notifications where dedupe_key=$1",
      [dedupeKey],
    );
    const notificationId = await getNotificationId();
    const result = await runNotificationDispatch(
      new Date("2026-11-02T00:00:00Z"),
      {
        pool,
        notificationIds: [notificationId],
      },
    );
    const after = await pool.query<{ attempts: number; sent_at: Date | null }>(
      "select attempts,sent_at from notifications where dedupe_key=$1",
      [dedupeKey],
    );
    expect(result).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it("dispatches estimate and request status emails through the existing sender", async () => {
    if (!customerId) throw new Error("Test customer was not created");
    const keys: [string, string] = [
      `${dedupeKey}:estimate`,
      `${dedupeKey}:status`,
    ];
    const client = await pool.connect();
    try {
      await client.query("begin");
      await schedule(client, {
        customerId,
        kind: "NT-06",
        dedupeKey: keys[0],
        scheduledAt: new Date("2026-11-01T00:00:00Z"),
        payload: { requestId: randomUUID(), estimateVersion: 1 },
      });
      await schedule(client, {
        customerId,
        kind: "NT-07",
        dedupeKey: keys[1],
        scheduledAt: new Date("2026-11-01T00:00:00Z"),
        payload: { requestId: randomUUID(), status: "done" },
      });
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    const queued = await pool.query<{ id: string }>(
      "select id from notifications where dedupe_key=any($1::text[]) order by dedupe_key",
      [keys],
    );
    const sender = new FakeMailSender();
    const result = await runNotificationDispatch(
      new Date("2026-11-02T00:00:00Z"),
      { pool, sender, notificationIds: queued.rows.map((row) => row.id) },
    );
    expect(result).toEqual({ sent: 2, failed: 0, skipped: 0 });
    // 同じ予定時刻の2件は送信の順番が決まらないので、順不同で比べる。
    expect(sender.messages.map((mail) => mail.subject).sort()).toEqual(
      ["お見積りをお送りしました", "ご依頼が完了しました"].sort(),
    );
    expect(
      sender.messages.every((mail) => mail.to === `${suffix}@example.test`),
    ).toBe(true);
  });

  it("does not send one locked notification concurrently twice", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await schedule(client, {
        kind: "S-03",
        dedupeKey: concurrentDedupeKey,
        scheduledAt: new Date("2026-11-01T00:00:00Z"),
        payload: { applicationId: randomUUID() },
      });
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    const queued = await pool.query<{ id: string }>(
      "select id from notifications where dedupe_key=$1",
      [concurrentDedupeKey],
    );
    const notificationId = queued.rows[0]?.id;
    if (!notificationId)
      throw new Error("Concurrent test notice was not created");

    let signalStarted: () => void = () => {};
    let releaseSend: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    let calls = 0;
    const sender = {
      messages: [] as Array<{ to: string; subject: string; text: string }>,
      async send(message: { to: string; subject: string; text: string }) {
        calls += 1;
        signalStarted();
        await gate;
        this.messages.push(message);
      },
    };
    const now = new Date("2026-11-02T00:00:00Z");
    const first = runNotificationDispatch(now, {
      pool,
      sender,
      notificationIds: [notificationId],
    });
    await started;
    const second = await runNotificationDispatch(now, {
      pool,
      sender,
      notificationIds: [notificationId],
    });
    releaseSend();
    const firstResult = await first;
    expect(firstResult.sent).toBe(1);
    expect(second).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(calls).toBe(1);
    expect(sender.messages).toHaveLength(1);
  });

  it("stops retrying a notice after three dispatch failures", async () => {
    const notificationId = await getNotificationId();
    const sender = new FakeMailSender();
    sender.failure = new Error("private provider failure detail");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await runNotificationDispatch(
        new Date("2026-11-02T00:00:00Z"),
        {
          pool,
          sender,
          notificationIds: [notificationId],
        },
      );
      expect(result.failed).toBe(1);
    }
    const fourth = await runNotificationDispatch(
      new Date("2026-11-02T00:00:00Z"),
      {
        pool,
        sender,
        notificationIds: [notificationId],
      },
    );
    const stored = await pool.query<{
      attempts: number;
      last_error: string | null;
    }>("select attempts,last_error from notifications where id=$1", [
      notificationId,
    ]);
    expect(fourth).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(stored.rows[0]?.attempts).toBe(3);
    expect(stored.rows[0]?.last_error).toMatch(
      /^(settings_unavailable|send_failed|mail_http_4xx|mail_http_5xx|mail_network_error)$/,
    );
    expect(stored.rows[0]?.last_error).not.toContain(
      "private provider failure detail",
    );
  });
});

async function getNotificationId(): Promise<string> {
  const result = await pool.query<{ id: string }>(
    "select id from notifications where dedupe_key=$1",
    [dedupeKey],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Test notification was not created");
  return id;
}
