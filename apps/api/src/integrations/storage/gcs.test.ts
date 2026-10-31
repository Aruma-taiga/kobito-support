import { afterEach, describe, expect, it, vi } from "vitest";
import { GcsPdfStore } from "./gcs.js";

const token = () =>
  Response.json({
    access_token: "private-token",
    expires_in: 3600,
    token_type: "Bearer",
  });
const pdf = new Uint8Array([37, 80, 68, 70]);

afterEach(() => vi.useRealTimers());

describe("GcsPdfStore", () => {
  it("uploads PDF bytes through JSON API media upload and downloads private media", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(Response.json({ name: "invoices/a b.pdf" }))
      .mockResolvedValueOnce(new Response(pdf));
    const store = new GcsPdfStore({ bucket: "private-bucket", fetcher });
    await store.put("invoices/a b.pdf", pdf);
    expect(await store.get("invoices/a b.pdf")).toEqual(pdf);
    expect(fetcher.mock.calls[0]).toEqual([
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      expect.objectContaining({
        headers: { "Metadata-Flavor": "Google" },
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    ]);
    expect(fetcher.mock.calls[1]).toEqual([
      "https://storage.googleapis.com/upload/storage/v1/b/private-bucket/o?uploadType=media&name=invoices%2Fa+b.pdf&ifGenerationMatch=0",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: "Bearer private-token",
          "content-type": "application/pdf",
        },
        body: pdf,
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    ]);
    expect(fetcher.mock.calls[2]).toEqual([
      "https://storage.googleapis.com/storage/v1/b/private-bucket/o/invoices%2Fa%20b.pdf?alt=media",
      expect.objectContaining({
        method: "GET",
        headers: { authorization: "Bearer private-token" },
        redirect: "error",
      }),
    ]);
  });

  it("accepts an existing object only when its bytes match the retry", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(new Response(null, { status: 412 }))
      .mockResolvedValueOnce(new Response(pdf));
    await new GcsPdfStore({ bucket: "bucket", fetcher }).put("a.pdf", pdf);
    expect(fetcher.mock.calls[2]?.[0]).toBe(
      "https://storage.googleapis.com/storage/v1/b/bucket/o/a.pdf?alt=media",
    );
    expect(fetcher.mock.calls[2]?.[1]?.method).toBe("GET");
  });

  it.each([
    new Uint8Array([37, 80, 68, 71]),
    new Uint8Array([37, 80]),
  ])("rejects an existing object with different bytes", async (existing) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(new Response(null, { status: 412 }))
      .mockResolvedValueOnce(new Response(existing));
    await expect(
      new GcsPdfStore({ bucket: "bucket", fetcher }).put("a.pdf", pdf),
    ).rejects.toMatchObject({ message: "pdf_storage_object_conflict" });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("refreshes cached metadata credentials one minute before expiry", async () => {
    let now = 0;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(new Response(pdf))
      .mockResolvedValueOnce(new Response(pdf))
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(new Response(pdf));
    const store = new GcsPdfStore({
      bucket: "bucket",
      fetcher,
      now: () => now,
    });
    await store.get("a.pdf");
    now = 3_539_000;
    await store.get("a.pdf");
    now = 3_540_000;
    await store.get("a.pdf");
    expect(
      fetcher.mock.calls.filter(([url]) =>
        String(url).includes("metadata.google.internal"),
      ),
    ).toHaveLength(2);
  });

  it("shares a credential refresh across concurrent requests", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) =>
      String(url).includes("metadata.google.internal")
        ? token()
        : new Response(pdf),
    );
    const store = new GcsPdfStore({ bucket: "bucket", fetcher });
    await Promise.all([store.get("a.pdf"), store.get("b.pdf")]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("rejects a missing object safely", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(
      new GcsPdfStore({ bucket: "bucket", fetcher }).get("missing.pdf"),
    ).rejects.toMatchObject({ message: "pdf_storage_not_found" });
  });

  it.each([
    302, 401, 403, 429, 500,
  ])("rejects storage HTTP %s without leaking provider content", async (status) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(new Response("secret provider body", { status }));
    const store = new GcsPdfStore({ bucket: "secret-bucket", fetcher });
    await expect(store.put("secret-invoice.pdf", pdf)).rejects.toMatchObject({
      message: "pdf_storage_http_error",
    });
  });

  it.each([
    { access_token: "", expires_in: 3600, token_type: "Bearer" },
    {
      access_token: "token\r\ninjected",
      expires_in: 3600,
      token_type: "Bearer",
    },
    { access_token: "private-token", expires_in: 0, token_type: "Bearer" },
    { access_token: "private-token", expires_in: "3600", token_type: "Bearer" },
    { access_token: "private-token", expires_in: 3600, token_type: "other" },
  ])("rejects malformed metadata credentials", async (credentials) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(credentials));
    await expect(
      new GcsPdfStore({ bucket: "bucket", fetcher }).get("a.pdf"),
    ).rejects.toMatchObject({ message: "pdf_storage_credentials_error" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("discards a rejected credential so the next request refreshes", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(new Response(pdf));
    const store = new GcsPdfStore({ bucket: "bucket", fetcher });
    await expect(store.get("a.pdf")).rejects.toThrow("pdf_storage_http_error");
    expect(await store.get("a.pdf")).toEqual(pdf);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("sanitizes network errors and retries credential acquisition on a later request", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("private-token secret-invoice.pdf"))
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(new Response(pdf));
    const store = new GcsPdfStore({ bucket: "bucket", fetcher });
    await expect(store.get("a.pdf")).rejects.toMatchObject({
      message: "pdf_storage_network_error",
    });
    expect(await store.get("a.pdf")).toEqual(pdf);
  });

  it("keeps the timeout active while reading response bodies", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(token())
      .mockImplementationOnce(async (_url, init) => {
        const stream = new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener("abort", () =>
              controller.error(new Error("secret timeout detail")),
            );
          },
        });
        return new Response(stream);
      });
    const store = new GcsPdfStore({
      bucket: "bucket",
      fetcher,
      timeoutMs: 100,
    });
    const rejected = expect(store.get("a.pdf")).rejects.toMatchObject({
      message: "pdf_storage_network_error",
    });
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
  });
});
