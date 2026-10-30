# Webhooks

## KOMOJU inbox

`POST /webhooks/komoju` accepts `application/json` requests up to 64 KiB only when `X-Komoju-Signature` matches the exact raw request bytes using the configured `KOMOJU_WEBHOOK_SECRET` HMAC-SHA256 key. The body event `id` is the deduplication key; `X-Komoju-ID` is not used for deduplication.

The durable inbox stores only an explicit allowlist of event, payment, status, amount, currency, and invoice-reference fields. Unknown fields, including `metadata` and `payment_details`, are discarded before storage and replay fingerprinting. Identical event IDs and meaningful fields are acknowledged as duplicates. A reused event ID with changed allowlisted fields is durably flagged and returns 409 for operations review. Persistence failures return 503 so KOMOJU can retry.

This stage only verifies and stores events. Events remain unprocessed (`processed_at` stays null); it does not change invoices, payments, credits, contracts, or notifications. Unknown event types are stored safely for later handling. Collision records are durable, but an operations review UI and collision-resolution workflow are not part of this stage.
