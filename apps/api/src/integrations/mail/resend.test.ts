import { describe, expect, it, vi } from "vitest";
import { MailSendError, ResendMailSender } from "./resend.js";

describe("ResendMailSender", () => {
  it("sends the expected request and idempotency key", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    const sender = new ResendMailSender(
      "private-key",
      "コビト <mail@example.test>",
      fetcher,
    );
    await sender.send({
      to: "person@example.test",
      subject: "件名",
      text: "本文",
      idempotencyKey: "notice-1",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        signal: expect.any(AbortSignal),
        headers: {
          authorization: "Bearer private-key",
          "content-type": "application/json",
          "Idempotency-Key": "notice-1",
        },
        body: JSON.stringify({
          from: "コビト <mail@example.test>",
          to: ["person@example.test"],
          subject: "件名",
          text: "本文",
        }),
      }),
    );
  });

  it("classifies HTTP failures without exposing request details", async () => {
    for (const [status, retryable] of [
      [422, false],
      [503, true],
    ] as const) {
      const sender = new ResendMailSender(
        "private-key",
        "from@example.test",
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response("private body", { status })),
      );
      try {
        await sender.send({
          to: "private-to@example.test",
          subject: "private subject",
          text: "private content",
        });
        throw new Error("expected failure");
      } catch (error) {
        expect(error).toBeInstanceOf(MailSendError);
        expect((error as MailSendError).retryable).toBe(retryable);
        for (const secret of [
          "private-key",
          "private-to@example.test",
          "private content",
          "private body",
        ])
          expect(String(error)).not.toContain(secret);
      }
    }
  });

  it("classifies network and timeout failures as retryable", async () => {
    const sender = new ResendMailSender(
      "key",
      "from@example.test",
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new Error("secret network detail")),
    );
    await expect(
      sender.send({ to: "to@example.test", subject: "s", text: "t" }),
    ).rejects.toMatchObject({ retryable: true, message: "mail_network_error" });
  });

  it("aborts the request after eight seconds", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );
    const sender = new ResendMailSender("key", "from@example.test", fetcher);
    const sending = sender.send({
      to: "to@example.test",
      subject: "s",
      text: "t",
    });
    const rejected = expect(sending).rejects.toMatchObject({
      retryable: true,
      reason: "mail_network_error",
    });
    await vi.advanceTimersByTimeAsync(8_000);
    await rejected;
    vi.useRealTimers();
  });
});
