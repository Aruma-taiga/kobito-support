import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./api-client.js";

describe("authenticated web API client", () => {
  it("submits a password-free application with the same idempotency key", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json(
        {
          applicationId: "11111111-1111-4111-8111-111111111111",
          contractId: "22222222-2222-4222-8222-222222222222",
          status: "under_review",
          replayed: false,
        },
        { status: 201 },
      ),
    );
    const client = createApiClient({
      baseUrl: "http://127.0.0.1:3000",
      getCurrentUser: () => ({
        getIdToken: vi.fn(async () => "application-token"),
      }),
      signOut: vi.fn(async () => undefined),
      fetcher,
    });
    const body = {
      shopName: "Shop",
      email: "shop@example.jp",
      displayVersion: "a".repeat(64),
    };
    await expect(
      client.postApplication(body, "33333333-3333-4333-8333-333333333333"),
    ).resolves.toMatchObject({ status: "under_review" });
    const call = fetcher.mock.calls[0];
    if (!call) throw new Error("Expected an application request");
    const [url, init] = call;
    expect(String(url)).toBe("http://127.0.0.1:3000/api/v1/applications");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer application-token",
      "Idempotency-Key": "33333333-3333-4333-8333-333333333333",
    });
    expect(JSON.parse(String(init?.body))).toEqual(body);
    expect(JSON.parse(String(init?.body))).not.toHaveProperty("password");
    expect(init?.credentials).toBe("omit");
  });

  it("automatically attaches the current Firebase ID token to /me", async () => {
    const user = { getIdToken: vi.fn(async () => "signed-id-token") };
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        customer: {
          id: "11111111-1111-4111-8111-111111111111",
          shopName: "Test shop",
          contactName: "A",
        },
      }),
    );
    const client = createApiClient({
      baseUrl: "http://127.0.0.1:3000",
      getCurrentUser: () => user,
      signOut: vi.fn(async () => undefined),
      fetcher,
    });

    await expect(client.getMe()).resolves.toEqual({
      customer: {
        id: "11111111-1111-4111-8111-111111111111",
        shopName: "Test shop",
        contactName: "A",
      },
    });
    expect(user.getIdToken).toHaveBeenCalledOnce();
    const call = fetcher.mock.calls[0];
    expect(String(call?.[0])).toBe("http://127.0.0.1:3000/api/v1/me");
    expect(call?.[1]?.headers).toMatchObject({
      Authorization: "Bearer signed-id-token",
    });
  });

  it("fetches public configuration without reading or sending a user token", async () => {
    const getCurrentUser = vi.fn(() => ({ getIdToken: vi.fn() }));
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ serviceName: "Configured service" }),
    );
    const client = createApiClient({
      baseUrl: "https://api.example.invalid",
      getCurrentUser,
      signOut: vi.fn(async () => undefined),
      fetcher,
    });

    await expect(client.getPublicConfig()).resolves.toEqual({
      serviceName: "Configured service",
    });
    expect(getCurrentUser).not.toHaveBeenCalled();
    expect(fetcher.mock.calls[0]?.[1]?.headers).not.toHaveProperty(
      "Authorization",
    );
  });

  it("signs out once on 401 without exposing a server message", async () => {
    const signOut = vi.fn(async () => undefined);
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json(
        { error: { code: "unauthorized", private: "server-secret" } },
        { status: 401 },
      ),
    );
    const client = createApiClient({
      baseUrl: "http://127.0.0.1:3000",
      getCurrentUser: () => ({ getIdToken: vi.fn(async () => "token") }),
      signOut,
      fetcher,
    });

    await expect(client.getMe()).rejects.toMatchObject({
      code: "unauthorized",
    });
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("does not call the API when a protected request has no current user", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createApiClient({
      baseUrl: "http://127.0.0.1:3000",
      getCurrentUser: () => null,
      signOut: vi.fn(async () => undefined),
      fetcher,
    });

    await expect(client.getMe()).rejects.toMatchObject({
      code: "unauthorized",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
