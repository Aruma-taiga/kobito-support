# Integrations

## KOMOJU

`komoju/client.ts` creates Hosted Page sessions for single card payments, passing the invoice number plus a short identifier as `payment_data.external_order_num` (see `../webhooks/README.md` for how it is reversed). No card data is handled here; entry happens on KOMOJU's hosted page. `komoju/fake-client.ts` is a test double. `komoju/webhook-signature.ts` verifies webhook signatures against exact raw request bytes with HMAC-SHA256. Processing of stored events is in `../webhooks/`, which also describes the durable inbox and its storage allowlist. Recurring billing (Subscriptions) is not used. Real-merchant behavior was checked only in test mode (W1).

## Mail

`mail/sender.ts` defines the `MailSender` port and a `LogMailSender` development sink. `mail/resend.ts` is the Resend adapter, selected with `MAIL_PROVIDER=resend` together with `RESEND_API_KEY` and `MAIL_FROM`. Real sending has not been verified against a production Resend account and sender domain.

## Storage

`storage/pdf-store.ts` is the invoice PDF store port. `storage/postgres.ts` (default, `PDF_STORAGE=postgres`) is the local adapter. `storage/gcs.ts` stores PDFs in a private Cloud Storage bucket (`PDF_STORAGE=gcs`, `PDF_BUCKET`); `storage/configured.ts` chooses the adapter from configuration. The GCS adapter has not been exercised against a real bucket.

## LINE Login

The LINE ID token verifier posts to the fixed LINE Login verification endpoint and checks the returned subject, channel audience, issuer, and expiration. Outbound redirects are rejected, credentials are omitted, and provider response bytes are capped. The accounts module uses the verified subject to sign in an existing linked customer or link it from an authenticated customer session. Production LINE channel setup and real-provider verification remain outstanding. No LINE message or notification is sent.

Use the API-local `smoke:line-auth` script to exercise the real API composition, PostgreSQL repository, Firebase Admin custom-token creation, Firebase Auth Emulator sign-in, and customer scope. Only the LINE verification HTTP response is mocked; the mock still receives calls at the fixed provider URL.

## Initial invoice PDF

Invoice PDFs are rendered from escaped, self-contained HTML with Playwright Chromium. JavaScript is disabled, the browser context denies every network request, and the HTML CSP blocks network and embedded content. Configure `INVOICE_CHROMIUM_EXECUTABLE` to an absolute Chromium path; the production image installs Debian Chromium and Noto CJK fonts at `/usr/bin/chromium`. PDF generation has a 15-second browser/page timeout and a 5 MiB output limit.

The first deployment stores frozen PDF bytes, MIME type, and SHA-256 in PostgreSQL (`invoice_documents`) in the same transaction as the invoice. This is a temporary local document adapter; production should set `PDF_STORAGE=gcs` (see Storage above) before issuing invoices externally. If the production document adapter is unavailable, issuance must fail closed. Reads return the stored bytes and never render a replacement.

For local sample issuance, set `DEV_INVOICE_PREVIEW=1`, run the demo Firebase Auth emulator and use only the loopback `kobito_support` database, then run `pnpm --filter @kobito/api seed:dev-billing`. This helper only sets `invoice_preview_enabled`; it preserves company identity, registration numbers, and bank details. Preview PDFs visibly say `開発用サンプル・お支払い不要 / 正式な請求書ではありません` and show absent registration or bank values as `未設定`. Preview issuance does not queue email notifications. Production configuration cannot enable this flag.
