import { describe, expect, it, vi } from "vitest";
import { HttpKomojuClient, KomojuClientError } from "./client.js";

describe("HttpKomojuClient", () => {
  it("creates a card-only JPY Hosted Page session with the invoice reference", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        `Basic ${Buffer.from("secret-key:").toString("base64")}`,
      );
      expect(JSON.parse(String(init?.body))).toEqual({
        mode: "payment",
        amount: 16_500,
        currency: "JPY",
        return_url: "https://app.example.test/me/invoices/abc",
        payment_types: ["credit_card"],
        payment_data: { external_order_num: "KS-2026-00001-abcdef" },
        default_locale: "ja",
      });
      return Response.json({
        id: "session-123",
        session_url: "https://komoju.com/sessions/session-123",
        card_number: "must-not-be-returned",
      });
    });
    const result = await new HttpKomojuClient(
      "secret-key",
      fetcher,
    ).createHostedSession({
      externalOrderNum: "KS-2026-00001-abcdef",
      amountYen: 16_500,
      returnUrl: "https://app.example.test/me/invoices/abc",
    });
    expect(result).toEqual({
      sessionId: "session-123",
      redirectUrl: "https://komoju.com/sessions/session-123",
    });
  });

  it("returns a safe error for HTTP, malformed response, and timeout failures", async () => {
    const sensitive = "secret-key card 4111111111111111";
    const client = new HttpKomojuClient(
      sensitive,
      async () => new Response(sensitive, { status: 500 }),
    );
    await expect(
      client.createHostedSession({
        externalOrderNum: "KS-2026-00001-abcdef",
        amountYen: 5500,
        returnUrl: "https://app.example.test/return",
      }),
    ).rejects.toSatisfy((error: Error) => {
      expect(error).toBeInstanceOf(KomojuClientError);
      expect(error.message).not.toContain(sensitive);
      return true;
    });
    const malformed = new HttpKomojuClient("key", async () =>
      Response.json({ id: "ok", session_url: "javascript:alert(1)" }),
    );
    await expect(
      malformed.createHostedSession({
        externalOrderNum: "KS-2026-00001-abcdef",
        amountYen: 5500,
        returnUrl: "https://app.example.test/return",
      }),
    ).rejects.toBeInstanceOf(KomojuClientError);

    const timedOut = new HttpKomojuClient(
      "timeout-secret",
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("timeout-secret card data")),
          );
        }),
      1,
    );
    await expect(
      timedOut.createHostedSession({
        externalOrderNum: "KS-2026-00001-abcdef",
        amountYen: 5500,
        returnUrl: "https://app.example.test/return",
      }),
    ).rejects.toMatchObject({ message: "KOMOJU request failed" });
  });
});
