import { describe, expect, it, vi } from "vitest";
import { LineIdTokenVerifier } from "./verify-id-token.js";

describe("LineIdTokenVerifier", () => {
  it("sends the token and expected channel to LINE and accepts a valid verified subject", async () => {
    const request = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        expect(_url).toBe("https://api.line.me/oauth2/v2.1/verify");
        expect(init?.method).toBe("POST");
        expect(init?.redirect).toBe("error");
        expect(init?.credentials).toBe("omit");
        const form = new URLSearchParams(String(init?.body));
        expect([...form.entries()]).toEqual([
          ["id_token", "sensitive-token"],
          ["client_id", "channel-id"],
        ]);
        return Response.json({
          sub: "line-user",
          aud: "channel-id",
          iss: "https://access.line.me",
          exp: Math.floor(Date.now() / 1000) + 60,
        });
      },
    );
    await expect(
      new LineIdTokenVerifier("channel-id", request).verify("sensitive-token"),
    ).resolves.toEqual({ sub: "line-user" });
  });

  it.each([
    {
      sub: "u",
      aud: "other",
      iss: "https://access.line.me",
      exp: 4_000_000_000,
    },
    {
      sub: "u",
      aud: "channel-id",
      iss: "https://evil.example",
      exp: 4_000_000_000,
    },
    { sub: "u", aud: "channel-id", iss: "https://access.line.me", exp: 1 },
    { aud: "channel-id", iss: "https://access.line.me", exp: 4_000_000_000 },
  ])("rejects invalid verified claims", async (claims) => {
    const request = vi.fn(async () => Response.json(claims));
    await expect(
      new LineIdTokenVerifier("channel-id", request).verify("token"),
    ).rejects.toThrow();
  });

  it("rejects provider error responses without exposing upstream details", async () => {
    const request = vi.fn(async () =>
      Response.json({ error_description: "private detail" }, { status: 401 }),
    );
    await expect(
      new LineIdTokenVerifier("channel-id", request).verify("token"),
    ).rejects.toThrow("invalid LINE token");
  });

  it("rejects oversized provider responses", async () => {
    const request = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            sub: "u".repeat(70_000),
            aud: "channel-id",
            iss: "https://access.line.me",
            exp: 4_000_000_000,
          }),
        ),
    );
    await expect(
      new LineIdTokenVerifier("channel-id", request).verify("token"),
    ).rejects.toThrow();
  });

  it("rejects non-finite expiration claims parsed from JSON exponent notation", async () => {
    const request = vi.fn(
      async () =>
        new Response(
          '{"sub":"u","aud":"channel-id","iss":"https://access.line.me","exp":1e400}',
        ),
    );
    await expect(
      new LineIdTokenVerifier("channel-id", request).verify("token"),
    ).rejects.toThrow();
  });
});
