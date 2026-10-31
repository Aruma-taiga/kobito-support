import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { type AppDependencies, createApp } from "../app.js";
import { verifyKomojuSignature } from "../integrations/komoju/webhook-signature.js";
import { parseKomojuInboxEvent } from "./komoju-validation.js";

const secret = "test-webhook-secret";
const event = {
  id: "evt_123",
  type: "payment.captured",
  data: {
    id: "pay_123",
    status: "captured",
    amount: 2500,
    total: 2500,
    currency: "JPY",
    external_order_num: "KS-2026-00001",
    captured_at: "2026-01-01T10:00:00Z",
    metadata: { planted: "METADATA_SENTINEL" },
    payment_details: {
      expiry_month: "EXPIRY_SENTINEL",
      expiry_year: "YEAR_SENTINEL",
      number: "PAN_SENTINEL",
      security_code: "CVV_SENTINEL",
    },
  },
};

function signed(raw: string) {
  return createHmac("sha256", secret).update(raw).digest("hex");
}

function makeApp(overrides: Record<string, unknown> = {}) {
  const defaults = {
    config: {
      nodeEnv: "test" as const,
      databaseUrl: "postgres://test",
      firebaseProjectId: "demo",
      webOrigin: "http://localhost:5173",
      port: 3000,
      invoicePrefix: "KS",
      komojuWebhookSecret: secret,
    },
    verifier: { verifyIdToken: vi.fn() },
    accounts: { findByAuthUserId: vi.fn(), findCustomer: vi.fn() },
    applications: {
      getPublicCatalog: vi.fn(),
      getPublicPartner: vi.fn(),
      submit: vi.fn(),
    },
    admin: {
      listApplications: vi.fn(),
      getCustomerDetail: vi.fn(),
      declineApplication: vi.fn(),
    },
    invoices: {},
    publicSettings: {
      getServiceName: vi.fn(),
      getContactEmail: vi.fn(),
    },
    logger: { info: vi.fn(), error: vi.fn() },
    komojuInbox: { receive: vi.fn(async () => "accepted" as const) },
  } as unknown as AppDependencies;
  return createApp({ ...defaults, ...overrides } as AppDependencies);
}

describe("KOMOJU webhook HTTP boundary", () => {
  it("verifies exact raw bytes and stores only the allowlisted event", async () => {
    const receive = vi.fn(async () => "accepted" as const);
    const app = makeApp({ komojuInbox: { receive } });
    const raw = ` {\n "id":"evt_123", "type":"payment.captured", "data":${JSON.stringify(event.data)} } `;
    const response = await app.request("/webhooks/komoju", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-komoju-signature": signed(raw),
        "x-komoju-id": "delivery-abc",
      },
      body: raw,
    });
    expect(response.status).toBe(200);
    expect(receive).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "evt_123",
        type: "payment.captured",
        data: {
          id: "pay_123",
          status: "captured",
          amount: 2500,
          total: 2500,
          currency: "JPY",
          external_order_num: "KS-2026-00001",
          captured_at: "2026-01-01T10:00:00Z",
        },
      }),
    );
    expect(JSON.stringify(receive.mock.calls)).not.toMatch(/SENTINEL/);
    const replay = await app.request("/webhooks/komoju", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-komoju-signature": signed(raw),
        "x-komoju-id": "different-delivery-id",
      },
      body: raw,
    });
    expect(replay.status).toBe(200);
    expect(receive).toHaveBeenCalledTimes(2);
  });

  it("acknowledges immediately after persistence even when the async processor fails", async () => {
    const receive = vi.fn(async () => "accepted" as const);
    const triggerProcessing = vi.fn(async () => {
      throw new Error("private processing failure");
    });
    const app = makeApp({
      komojuInbox: { receive },
      komojuTriggerProcessing: triggerProcessing,
    });
    const body = JSON.stringify(event);
    const response = await app.request("/webhooks/komoju", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-komoju-signature": signed(body),
      },
      body,
    });
    expect(response.status).toBe(200);
    expect(triggerProcessing).toHaveBeenCalledOnce();
  });

  it.each([
    "text/plain",
    "application/problem+json",
  ])("rejects invalid content type %s", async (contentType) => {
    const receive = vi.fn();
    const app = makeApp({ komojuInbox: { receive } });
    const response = await app.request("/webhooks/komoju", {
      method: "POST",
      headers: {
        "content-type": contentType,
        "x-komoju-signature": signed("{}"),
      },
      body: "{}",
    });
    expect(response.status).toBe(415);
    expect(receive).not.toHaveBeenCalled();
  });

  it("rejects tampered signatures, malformed signatures, and invalid JSON", async () => {
    const receive = vi.fn();
    const app = makeApp({ komojuInbox: { receive } });
    for (const [raw, signature] of [
      ["{}", "0".repeat(64)],
      ["{}", "xyz"],
      ["{", signed("{")],
    ] as const) {
      const response = await app.request("/webhooks/komoju", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-komoju-signature": signature,
        },
        body: raw,
      });
      expect(response.status).toBe(400);
    }
    expect(receive).not.toHaveBeenCalled();
  });

  it("rejects invalid UTF-8 and accepts unknown event types without retaining unknown fields", async () => {
    const receive = vi.fn(async () => "accepted" as const);
    const app = makeApp({ komojuInbox: { receive } });
    const invalidUtf8 = new Uint8Array([0xff, 0xfe, 0xfd]);
    expect(
      (
        await app.request("/webhooks/komoju", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-komoju-signature": createHmac("sha256", secret)
              .update(invalidUtf8)
              .digest("hex"),
          },
          body: invalidUtf8,
        })
      ).status,
    ).toBe(400);

    const unknownRaw = JSON.stringify({
      id: "evt_unknown",
      type: "future.provider.event",
      data: { id: "object_1", future_secret_field: "UNKNOWN_SENTINEL" },
    });
    expect(
      (
        await app.request("/webhooks/komoju", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-komoju-signature": signed(unknownRaw),
          },
          body: unknownRaw,
        })
      ).status,
    ).toBe(200);
    expect(receive).toHaveBeenLastCalledWith({
      id: "evt_unknown",
      type: "future.provider.event",
      data: { id: "object_1" },
    });
  });

  it("fails closed if secret is unconfigured and returns retryable errors for storage failure", async () => {
    const receive = vi.fn(async () => {
      throw new Error("database private sentinel");
    });
    const app = makeApp({ komojuInbox: { receive } });
    const body = JSON.stringify(event);
    const unconfigured = makeApp({
      config: {
        nodeEnv: "test",
        databaseUrl: "postgres://test",
        firebaseProjectId: "demo",
        webOrigin: "http://localhost:5173",
        port: 3000,
        invoicePrefix: "KS",
      },
    });
    const request = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-komoju-signature": signed(body),
      },
      body,
    } as const;
    expect(
      (await unconfigured.request("/webhooks/komoju", request)).status,
    ).toBe(503);
    const response = await app.request("/webhooks/komoju", request);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("database private sentinel");
  });

  it("rejects oversized bodies and missing event identifiers without persisting", async () => {
    const receive = vi.fn();
    const app = makeApp({ komojuInbox: { receive } });
    const large = " ".repeat(65_537);
    expect(
      (
        await app.request("/webhooks/komoju", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-komoju-signature": signed(large),
          },
          body: large,
        })
      ).status,
    ).toBe(413);
    const raw = JSON.stringify({ type: "payment.captured", data: {} });
    expect(
      (
        await app.request("/webhooks/komoju", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-komoju-signature": signed(raw),
          },
          body: raw,
        })
      ).status,
    ).toBe(400);
    expect(receive).not.toHaveBeenCalled();
  });
});

describe("KOMOJU signature and payload allowlist", () => {
  it("uses lowercase hexadecimal SHA-256 HMAC over the exact raw bytes", () => {
    const raw = new TextEncoder().encode(' {"id":"evt"} ');
    expect(
      verifyKomojuSignature(raw, signed(new TextDecoder().decode(raw)), secret),
    ).toBe(true);
    expect(verifyKomojuSignature(raw, signed('{"id":"evt"}'), secret)).toBe(
      false,
    );
    expect(
      verifyKomojuSignature(
        raw,
        signed(new TextDecoder().decode(raw)).toUpperCase(),
        secret,
      ),
    ).toBe(false);
    expect(verifyKomojuSignature(raw, undefined, secret)).toBe(false);
  });

  it("strips every unknown field and refuses unsafe financial values", () => {
    expect(parseKomojuInboxEvent(event)).toEqual({
      id: "evt_123",
      type: "payment.captured",
      data: {
        id: "pay_123",
        status: "captured",
        amount: 2500,
        total: 2500,
        currency: "JPY",
        external_order_num: "KS-2026-00001",
        captured_at: "2026-01-01T10:00:00Z",
      },
    });
    expect(
      parseKomojuInboxEvent({
        ...event,
        data: { ...event.data, captured_at: "not-a-timestamp" },
      }),
    ).toBeUndefined();
    expect(
      parseKomojuInboxEvent({
        ...event,
        data: { amount: Number.MAX_SAFE_INTEGER + 1 },
      }),
    ).toBeUndefined();
    expect(parseKomojuInboxEvent({ ...event, id: "" })).toBeUndefined();
    expect(
      parseKomojuInboxEvent({
        ...event,
        data: { external_order_num: "CUSTOM-2026-100000" },
      })?.data.external_order_num,
    ).toBe("CUSTOM-2026-100000");
    expect(
      parseKomojuInboxEvent({
        ...event,
        data: { external_order_num: "ACME-EU-2026-2147483647" },
      })?.data.external_order_num,
    ).toBe("ACME-EU-2026-2147483647");
    expect(
      parseKomojuInboxEvent({
        ...event,
        data: { external_order_num: "ACME-2026-12345678901" },
      }),
    ).toBeUndefined();
  });
});
