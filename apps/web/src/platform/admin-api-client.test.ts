import { describe, expect, it, vi } from "vitest";
import { AdminApiError, createAdminApiClient } from "./admin-api-client.js";

const tokenUser = { getIdToken: vi.fn(async () => "admin-id-token") };

describe("admin API client", () => {
  it("requires the current admin Firebase token before requesting the session", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createAdminApiClient({
      baseUrl: "https://api.example.test",
      getCurrentUser: () => null,
      fetcher,
    });

    await expect(client.getSession()).rejects.toMatchObject({
      code: "unauthorized",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("validates the server role before allowing admin data routes", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ role: "admin" }),
    );
    const client = createAdminApiClient({
      baseUrl: "https://api.example.test",
      getCurrentUser: () => tokenUser,
      fetcher,
    });

    await expect(client.getSession()).resolves.toEqual({ role: "admin" });
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      "https://api.example.test/api/v1/admin/session",
    );
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer admin-id-token",
    });
  });

  it("uses bounded query parameters and shared response schemas for the review queue", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ items: [], page: 2, pageSize: 10, total: 0 }),
    );
    const client = createAdminApiClient({
      baseUrl: "https://api.example.test",
      getCurrentUser: () => tokenUser,
      fetcher,
    });

    await expect(
      client.getApplications({
        status: "under_review",
        q: "山田 花子",
        page: 2,
        pageSize: 10,
      }),
    ).resolves.toEqual({ items: [], page: 2, pageSize: 10, total: 0 });
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      "https://api.example.test/api/v1/admin/customers?status=under_review&q=%E5%B1%B1%E7%94%B0+%E8%8A%B1%E5%AD%90&page=2&pageSize=10",
    );
  });

  it("sends the decline request note and parses its response", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        applicationId: "11111111-1111-4111-8111-111111111111",
        contractId: "22222222-2222-4222-8222-222222222222",
        status: "declined",
        replayed: false,
      }),
    );
    const client = createAdminApiClient({
      baseUrl: "https://api.example.test",
      getCurrentUser: () => tokenUser,
      fetcher,
    });

    await expect(
      client.declineApplication("33333333-3333-4333-8333-333333333333", {
        rejectionNote: "内容を確認できませんでした",
      }),
    ).resolves.toMatchObject({ status: "declined" });
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      "https://api.example.test/api/v1/admin/applications/33333333-3333-4333-8333-333333333333/decline",
    );
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer admin-id-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ rejectionNote: "内容を確認できませんでした" }),
    });
  });

  it("maps role, MFA, and status conflicts to safe typed errors", async () => {
    const cases = [
      [404, "not_found"],
      [403, "forbidden"],
      [409, "conflict"],
    ] as const;
    for (const [status, code] of cases) {
      const client = createAdminApiClient({
        baseUrl: "https://api.example.test",
        getCurrentUser: () => tokenUser,
        fetcher: vi.fn<typeof fetch>(async () =>
          Response.json(
            { error: { code, private: "must not surface" } },
            { status },
          ),
        ),
      });
      await expect(client.getSession()).rejects.toBeInstanceOf(AdminApiError);
      await expect(client.getSession()).rejects.toMatchObject({ code });
    }
  });
});
