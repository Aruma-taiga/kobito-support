import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./api-client.js";

describe("authenticated web API client", () => {
  it("loads customer access policy and explicitly records welcome acknowledgement", async () => {
    const access = {
      contractStatus: "active",
      landingPath: "/me/welcome",
      access: "active",
      welcomeRequired: true,
      invoiceAccess: true,
      invoiceAccessUntil: null,
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(access))
      .mockResolvedValueOnce(
        Response.json({ seenAt: "2026-10-27T00:00:00.000Z" }),
      );
    const client = createApiClient({
      baseUrl: "https://api.example.test",
      getCurrentUser: () => ({
        getIdToken: vi.fn(async () => "customer-id-token"),
      }),
      signOut: vi.fn(async () => undefined),
      fetcher,
    });

    await expect(client.getCustomerAccess()).resolves.toEqual(access);
    await expect(client.markWelcomeSeen()).resolves.toEqual({
      seenAt: "2026-10-27T00:00:00.000Z",
    });
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      "https://api.example.test/api/v1/me/access",
    );
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer customer-id-token",
    });
    expect(String(fetcher.mock.calls[1]?.[0])).toBe(
      "https://api.example.test/api/v1/me/welcome-seen",
    );
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      headers: { Authorization: "Bearer customer-id-token" },
      body: "{}",
      credentials: "omit",
    });
  });

  it("maps customer access role mismatch to a safe not-found error", async () => {
    const client = createApiClient({
      baseUrl: "https://api.example.test",
      getCurrentUser: () => ({
        getIdToken: vi.fn(async () => "customer-id-token"),
      }),
      signOut: vi.fn(async () => undefined),
      fetcher: vi.fn<typeof fetch>(async () =>
        Response.json({ error: { code: "not_found" } }, { status: 404 }),
      ),
    });

    await expect(client.getCustomerAccess()).rejects.toEqual(
      expect.objectContaining({ code: "not_found" }),
    );
  });
  it("loads only the signed-in customer request routes and maps approval balance conflicts", async () => {
    const requestId = "11111111-1111-4111-8111-111111111111";
    const estimateId = "22222222-2222-4222-8222-222222222222";
    const estimate = {
      id: estimateId,
      requestId,
      version: 2,
      credits: 1,
      dueOn: "2026-10-30",
      workItems: ["フォームを修正"],
      doneCriteria: "スマートフォンから送信できる",
      exclusions: null,
      customerPrep: null,
      sentAt: "2026-10-26T00:00:00.000Z",
      approvedAt: null,
      supersededAt: null,
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          items: [
            {
              id: requestId,
              contractId: "33333333-3333-4333-8333-333333333333",
              receivedOn: "2026-10-26",
              summary: "予約フォームの修正",
              urgent: false,
              status: "awaiting_approval",
              createdAt: "2026-10-26T00:00:00.000Z",
              latestEstimate: estimate,
              completion: null,
              approvedEstimateId: null,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              code: "insufficient_credits",
              private: "internal balance detail",
            },
          },
          { status: 409 },
        ),
      );
    const client = createApiClient({
      baseUrl: "https://api.example.test",
      getCurrentUser: () => ({
        getIdToken: vi.fn(async () => "customer-id-token"),
      }),
      signOut: vi.fn(async () => undefined),
      fetcher,
    });

    await expect(client.getCustomerRequests()).resolves.toMatchObject({
      items: [{ id: requestId }],
    });
    await expect(client.approveEstimate(estimateId)).rejects.toMatchObject({
      code: "insufficient_credits",
    });
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      "https://api.example.test/api/v1/me/requests",
    );
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer customer-id-token",
    });
    expect(String(fetcher.mock.calls[1]?.[0])).toBe(
      `https://api.example.test/api/v1/me/estimates/${estimateId}/approve`,
    );
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      body: "{}",
      credentials: "omit",
    });
    expect(String(fetcher.mock.calls[1]?.[0])).not.toContain(
      "customer-id-token",
    );
  });

  it("loads the contract summary through the authenticated customer API", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ contract: null }),
    );
    const client = createApiClient({
      baseUrl: "https://api.example.test",
      getCurrentUser: () => ({
        getIdToken: vi.fn(async () => "customer-id-token"),
      }),
      signOut: vi.fn(async () => undefined),
      fetcher,
    });
    await expect(client.getContract()).resolves.toEqual({ contract: null });
    expect(fetcher).toHaveBeenCalledWith(
      new URL("https://api.example.test/api/v1/me/contract"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer customer-id-token",
        }),
      }),
    );
  });
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

  it("loads only the authenticated customer's invoice list without a customer ID parameter", async () => {
    const user = { getIdToken: vi.fn(async () => "signed-id-token") };
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ invoices: [] }),
    );
    const client = createApiClient({
      baseUrl: "https://api.example.test",
      getCurrentUser: () => user,
      signOut: vi.fn(async () => undefined),
      fetcher,
    });

    await expect(client.getInvoices()).resolves.toEqual({ invoices: [] });
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      "https://api.example.test/api/v1/me/invoices",
    );
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer signed-id-token",
    });
    expect(String(fetcher.mock.calls[0]?.[0])).not.toMatch(
      /customerId|tenant/i,
    );
  });

  it("downloads a customer invoice PDF with the ID token in the authorization header", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(new Blob(["pdf"], { type: "application/pdf" })),
    );
    const client = createApiClient({
      baseUrl: "https://api.example.test",
      getCurrentUser: () => ({
        getIdToken: vi.fn(async () => "private-token"),
      }),
      signOut: vi.fn(async () => undefined),
      fetcher,
    });

    await expect(
      client.getInvoicePdf("44444444-4444-4444-8444-444444444444"),
    ).resolves.toBeInstanceOf(Blob);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      "https://api.example.test/api/v1/me/invoices/44444444-4444-4444-8444-444444444444/pdf",
    );
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer private-token",
      Accept: "application/pdf",
    });
    expect(String(fetcher.mock.calls[0]?.[0])).not.toContain("private-token");
  });
});
