import { Hono } from "hono";
import { verifyKomojuSignature } from "../integrations/komoju/webhook-signature.js";
import type { ApiVariables } from "../platform/types.js";
import type { KomojuInbox } from "./komoju-contracts.js";
import { parseKomojuInboxEvent } from "./komoju-validation.js";

const maxBodyBytes = 64 * 1024;

export function createKomojuWebhookRoutes(dependencies: {
  secret: string | undefined;
  inbox: KomojuInbox;
  triggerProcessing?: () => Promise<unknown>;
}) {
  const routes = new Hono<{ Variables: ApiVariables }>();
  routes.post("/webhooks/komoju", async (context) => {
    if (!dependencies.secret)
      return context.json({ error: { code: "webhook_unavailable" } }, 503);
    const contentType = context.req
      .header("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (contentType !== "application/json") {
      return context.json({ error: { code: "unsupported_media_type" } }, 415);
    }
    const declaredLength = Number(context.req.header("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
      return context.json({ error: { code: "payload_too_large" } }, 413);
    }
    const rawBody = await readBoundedBody(context.req.raw.body, maxBodyBytes);
    if (!rawBody)
      return context.json({ error: { code: "payload_too_large" } }, 413);
    const signature = context.req.header("x-komoju-signature");
    if (!verifyKomojuSignature(rawBody, signature, dependencies.secret)) {
      return context.json({ error: { code: "invalid_signature" } }, 400);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(rawBody),
      );
    } catch {
      return context.json({ error: { code: "invalid_webhook" } }, 400);
    }
    const event = parseKomojuInboxEvent(parsed);
    if (!event)
      return context.json({ error: { code: "invalid_webhook" } }, 400);
    try {
      const result = await dependencies.inbox.receive(event);
      if (result === "collision")
        return context.json({ error: { code: "event_collision" } }, 409);
      void dependencies.triggerProcessing?.().catch(() => undefined);
      return context.json({ received: true }, 200);
    } catch {
      return context.json({ error: { code: "webhook_unavailable" } }, 503);
    }
  });
  return routes;
}

async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<Uint8Array | undefined> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
