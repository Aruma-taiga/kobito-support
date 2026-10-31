# Webhooks

## KOMOJU inbox

`POST /webhooks/komoju` accepts `application/json` requests up to 64 KiB only when `X-Komoju-Signature` matches the exact raw request bytes using the configured `KOMOJU_WEBHOOK_SECRET` HMAC-SHA256 key. The body event `id` is the deduplication key; `X-Komoju-ID` is not used for deduplication.

The durable inbox stores only an explicit allowlist of event, payment, status, amount, currency, and invoice-reference fields. Unknown fields, including `metadata` and `payment_details`, are discarded before storage and replay fingerprinting. Identical event IDs and meaningful fields are acknowledged as duplicates. A reused event ID with changed allowlisted fields is durably flagged and returns 409 for operations review. Persistence failures return 503 so KOMOJU can retry.

After an event is stored, the route starts processing in the background (`KomojuEventProcessor`, `komoju-processor.ts`); events that are still unprocessed are picked up by the next trigger. A stored event is reconciled against the invoice it references. `payment.captured` / `subscription.captured` record the payment, mark the invoice paid, and let the existing payment-confirmation path grant credits and establish the contract. `payment.failed`, `payment.expired`, `payment.cancelled`, and `subscription.failed` mark an issued invoice as failed. Duplicate deliveries do not apply twice (the event ID is the deduplication key and payment IDs are unique).

Events that cannot be applied safely are kept with `processed_at` set and a `review:<reason>` outcome ("要確認"), without changing financial records. Reasons include an unsupported event type, a missing or unknown invoice reference, an amount mismatch (the event `total` is compared with the invoice total), an invoice state conflict, a payment-method or payment-ID conflict, a preview invoice, and an event ID collision. Admins can see and resolve these in the admin console (PR #52). Processing errors are recorded as `failed:<reason>` and retried by a later batch.

Invoice reference: KOMOJU allows each `external_order_num` to be used only once per merchant, so the client appends a six-character identifier to the invoice number when creating a session (for example `KS-2026-00001-ab12cd`). On receipt, `invoiceNumberFromExternalOrderNum` strips that suffix and the bare invoice number is used for lookup; a bare invoice number is also accepted.
