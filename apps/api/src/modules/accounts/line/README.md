# LINE account linking

The accounts module exposes customer-scoped LINE linking and public LINE sign-in. LINE ID tokens are verified by the adapter in `integrations/line`; only an existing, non-anonymized customer account can be used to mint a Firebase custom token. The link transaction locks and re-reads the customer row, keeps an existing link immutable, and maps the unique LINE ID constraint to a conflict response.

`LINE_LOGIN_CHANNEL_ID` enables LINE verification. Without it, the LINE token operations return `503 service_unavailable`. An invalid LINE ID token on an authenticated link request returns `400 invalid_line_token`, keeping it distinct from a Firebase session `401 unauthorized`; public sign-in retains the generic 401 response. This repository has not been verified against a configured production LINE channel. This feature does not send LINE messages or other notifications.

## Local smoke

Run `pnpm --filter @kobito/api smoke:line-auth` with `TEST_DATABASE_URL` set to the exact loopback `kobito_support_test` database, `FIREBASE_PROJECT_ID` set to a `demo-` project, and `FIREBASE_AUTH_EMULATOR_HOST` set to a loopback Auth Emulator. The script uses a mock response for the fixed LINE verification endpoint and real PostgreSQL and Firebase Auth SDKs. It creates and removes only its own fixture. It does not contact LINE or send notifications.
