# Integrations

Provider adapters are added in later stages. This directory has no payment, email, or other external-service calls yet.

## Initial invoice PDF

Invoice PDFs are rendered from escaped, self-contained HTML with Playwright Chromium. JavaScript is disabled, the browser context denies every network request, and the HTML CSP blocks network and embedded content. Configure `INVOICE_CHROMIUM_EXECUTABLE` to an absolute Chromium path; the production image installs Debian Chromium and Noto CJK fonts at `/usr/bin/chromium`. PDF generation has a 15-second browser/page timeout and a 5 MiB output limit.

The first deployment stores frozen PDF bytes, MIME type, and SHA-256 in PostgreSQL (`invoice_documents`) in the same transaction as the invoice. This is a temporary local document adapter; production must use a Cloud Storage adapter before issuing invoices externally. If the production document adapter is unavailable, issuance must fail closed. Reads return the stored bytes and never render a replacement.

For local sample issuance, set `DEV_INVOICE_PREVIEW=1`, run the demo Firebase Auth emulator and use only the loopback `kobito_support` database, then run `pnpm --filter @kobito/api seed:dev-billing`. This helper only sets `invoice_preview_enabled`; it preserves company identity, registration numbers, and bank details. Preview PDFs visibly say `開発用サンプル・お支払い不要 / 正式な請求書ではありません` and show absent registration or bank values as `未設定`. Preview issuance does not queue email notifications. Production configuration cannot enable this flag.
