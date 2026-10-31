# KOMOJU Hosted Page integration

`HttpKomojuClient` creates card-only payment sessions through the documented
KOMOJU Sessions API. Card entry remains on KOMOJU's hosted page. The live
merchant configuration and end-to-end behavior have not been verified against
a real KOMOJU account. `FakeKomojuClient` is for local tests only.

KOMOJU test-mode measurement on 2026-11-01 showed that an
`external_order_num` can be used only once per merchant, including after a
session is cancelled. Payment-link creation therefore sends the invoice number
followed by a fresh six-character lowercase alphanumeric identifier. Webhooks
accept either the legacy invoice number or this suffixed form and resolve the
invoice using only the exact invoice-number portion. The original provider
reference remains in the sanitized event payload for auditability.
