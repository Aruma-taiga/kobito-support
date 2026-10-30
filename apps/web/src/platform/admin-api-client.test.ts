import { describe, expect, it, vi } from "vitest";
import { AdminApiError, createAdminApiClient } from "./admin-api-client.js";

const tokenUser = { getIdToken: vi.fn(async () => "admin-id-token") };

describe("admin API client", () => {
  it("uses the eligible-contract endpoint and keeps request/estimate idempotency keys in headers", async () => {
    const requestId = "11111111-1111-4111-8111-111111111111";
    const contractId = "22222222-2222-4222-8222-222222222222";
    const estimateId = "33333333-3333-4333-8333-333333333333";
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          items: [
            {
              contractId,
              customerId: "44444444-4444-4444-8444-444444444444",
              shopName: "喫茶ひだまり",
              contactName: "山田 花子",
              status: "active",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            id: requestId,
            contractId,
            receivedOn: "2026-10-26",
            summary: "予約フォームの修正",
            urgent: false,
            status: "received",
            createdAt: "2026-10-26T00:00:00.000Z",
            replayed: false,
          },
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            id: estimateId,
            requestId,
            version: 1,
            credits: 1,
            dueOn: "2026-10-30",
            workItems: ["フォームを修正"],
            doneCriteria: "送信できる",
            exclusions: null,
            customerPrep: null,
            sentAt: "2026-10-26T00:00:00.000Z",
            approvedAt: null,
            supersededAt: null,
            replayed: false,
          },
          { status: 201 },
        ),
      );
    const client = createAdminApiClient({
      baseUrl: "https://api.example.test",
      getCurrentUser: () => tokenUser,
      fetcher,
    });

    await expect(client.getRequestContracts()).resolves.toMatchObject({
      items: [{ contractId, status: "active" }],
    });
    await expect(
      client.createRequest(
        {
          contractId,
          receivedOn: "2026-10-26",
          summary: "予約フォームの修正",
          urgent: false,
        },
        "55555555-5555-4555-8555-555555555555",
      ),
    ).resolves.toMatchObject({ id: requestId });
    await expect(
      client.sendEstimate(
        requestId,
        {
          credits: 1,
          dueOn: "2026-10-30",
          workItems: ["フォームを修正"],
          doneCriteria: "送信できる",
        },
        "66666666-6666-4666-8666-666666666666",
      ),
    ).resolves.toMatchObject({ id: estimateId });

    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      "https://api.example.test/api/v1/admin/request-contracts",
    );
    const createCall = fetcher.mock.calls[1];
    expect(String(createCall?.[0])).toBe(
      "https://api.example.test/api/v1/admin/requests",
    );
    expect(createCall?.[1]).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer admin-id-token",
        "Idempotency-Key": "55555555-5555-4555-8555-555555555555",
      },
      body: JSON.stringify({
        contractId,
        receivedOn: "2026-10-26",
        summary: "予約フォームの修正",
        urgent: false,
      }),
      credentials: "omit",
    });
    const estimateCall = fetcher.mock.calls[2];
    expect(String(estimateCall?.[0])).toBe(
      `https://api.example.test/api/v1/admin/requests/${requestId}/estimates`,
    );
    expect(estimateCall?.[1]?.headers).toMatchObject({
      "Idempotency-Key": "66666666-6666-4666-8666-666666666666",
    });
    expect(String(estimateCall?.[0])).not.toContain(
      "55555555-5555-4555-8555-555555555555",
    );
  });

  it("maps request-specific conflict codes without exposing API error details", async () => {
    const client = createAdminApiClient({
      baseUrl: "https://api.example.test",
      getCurrentUser: () => tokenUser,
      fetcher: vi.fn<typeof fetch>(async () =>
        Response.json(
          { error: { code: "request_conflict", private: "internal detail" } },
          { status: 409 },
        ),
      ),
    });
    await expect(client.getAdminRequests()).rejects.toMatchObject({
      code: "request_conflict",
    });
  });

  it("loads pending bank transfers with the administrator session token", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ items: [] }),
    );
    const client = createAdminApiClient({
      baseUrl: "https://api.example.test",
      getCurrentUser: () => tokenUser,
      fetcher,
    });

    await expect(client.getPendingBankTransfers()).resolves.toEqual({
      items: [],
    });
    expect(fetcher).toHaveBeenCalledWith(
      new URL("https://api.example.test/api/v1/admin/bank-transfers/pending"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer admin-id-token",
        }),
        credentials: "omit",
      }),
    );
  });

  it("posts only a confirmed amount/date and preview acknowledgement", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        invoiceId: "44444444-4444-4444-8444-444444444444",
        paymentId: "55555555-5555-4555-8555-555555555555",
        amount: 5500,
        paidOn: "2026-10-26",
        contractId: "33333333-3333-4333-8333-333333333333",
        anchorDate: "2026-10-26",
        period: {
          id: "66666666-6666-4666-8666-666666666666",
          seq: 1,
          startsOn: "2026-10-26",
          endsOn: "2026-11-25",
          priceInclTax: 5500,
          credits: 3,
        },
        preview: true,
        replayed: false,
      }),
    );
    const client = createAdminApiClient({
      baseUrl: "https://api.example.test",
      getCurrentUser: () => tokenUser,
      fetcher,
    });

    await client.confirmBankPayment("44444444-4444-4444-8444-444444444444", {
      amount: 5500,
      paidOn: "2026-10-26",
      previewAcknowledged: true,
    });

    expect(fetcher).toHaveBeenCalledWith(
      new URL(
        "https://api.example.test/api/v1/admin/invoices/44444444-4444-4444-8444-444444444444/confirm-payment",
      ),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          amount: 5500,
          paidOn: "2026-10-26",
          previewAcknowledged: true,
        }),
      }),
    );
  });
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

  it("approves from the reviewed snapshot and parses the idempotent result", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        applicationId: "33333333-3333-4333-8333-333333333333",
        contractId: "22222222-2222-4222-8222-222222222222",
        status: "awaiting_payment",
        invoice: {
          id: "44444444-4444-4444-8444-444444444444",
          invoiceNo: "INV-2026-001",
          kind: "initial",
          status: "issued",
          issuedOn: "2026-10-26",
          dueOn: "2026-11-02",
          totalInclTax: 5500,
          totalExclTax: 5000,
          taxAmount: 500,
          preview: true,
          paymentMethod: "bank_transfer",
        },
        replayed: false,
      }),
    );
    const client = createAdminApiClient({
      baseUrl: "https://api.example.test",
      getCurrentUser: () => tokenUser,
      fetcher,
    });

    await expect(
      client.approveApplication("33333333-3333-4333-8333-333333333333"),
    ).resolves.toMatchObject({ status: "awaiting_payment", replayed: false });
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      "https://api.example.test/api/v1/admin/applications/33333333-3333-4333-8333-333333333333/approve",
    );
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: "{}",
      headers: {
        Authorization: "Bearer admin-id-token",
        "Content-Type": "application/json",
      },
    });
  });

  it("uses the admin token for invoice PDF downloads and returns a blob", async () => {
    const pdf = new Blob(["pdf bytes"], { type: "application/pdf" });
    const fetcher = vi.fn<typeof fetch>(async () => new Response(pdf));
    const client = createAdminApiClient({
      baseUrl: "https://api.example.test",
      getCurrentUser: () => tokenUser,
      fetcher,
    });

    await expect(
      client.getInvoicePdf("44444444-4444-4444-8444-444444444444"),
    ).resolves.toBeInstanceOf(Blob);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      "https://api.example.test/api/v1/admin/invoices/44444444-4444-4444-8444-444444444444/pdf",
    );
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer admin-id-token",
      Accept: "application/pdf",
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

  it("maps missing invoice settings to a safe invoice-specific error", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json(
        { error: { code: "invoice_unavailable", private: "database detail" } },
        { status: 503 },
      ),
    );
    const client = createAdminApiClient({
      baseUrl: "https://api.example.test",
      getCurrentUser: () => tokenUser,
      fetcher,
    });

    await expect(
      client.approveApplication("33333333-3333-4333-8333-333333333333"),
    ).rejects.toMatchObject({ code: "invoice_unavailable" });
  });

  it("loads safe invoice readiness through the admin session", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        canIssue: false,
        mode: "unavailable",
        reason: "issuer_not_configured",
      }),
    );
    const client = createAdminApiClient({
      baseUrl: "https://api.example.test",
      getCurrentUser: () => tokenUser,
      fetcher,
    });

    await expect(client.getInvoiceReadiness()).resolves.toEqual({
      canIssue: false,
      mode: "unavailable",
      reason: "issuer_not_configured",
    });
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      "https://api.example.test/api/v1/admin/invoices/readiness",
    );
  });
});
