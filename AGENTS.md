# Repository instructions

## Scope and delivery

- Repository: `kobito-support`; GitHub account: `Aruma-taiga`.
- The five foundation PR stages are complete. The user authorized continuing with applications, review, initial invoicing, bank-transfer reconciliation, and contract activation. Deliver bounded vertical slices as separate PRs and wait for each slice's CI before starting the next implementation stage. Do not merge PRs or deploy without authorization.
- Keep PR titles and descriptions in Japanese.
- Prefer the low-cost `gpt-6-luna` model for implementation and testing work. Use test-driven development: write meaningful tests first, observe the failing result, implement, and run them again.
- Delegate bounded implementation, testing, investigation, and browser tasks to sub-agents regularly. Keep the main thread focused on decisions, critical review, and concise verified outcomes rather than duplicating investigations or relaying full logs. Assign non-overlapping file ownership when working in parallel.
- Coordinate runtime resources as well as files: assign ownership of development servers, ports, and browser sessions. Parallel browser tasks must use separate named sessions/profiles. Mock servers must use separately allocated ports and must never replace or shadow the real API or web server being used for another agent's browser verification. Stop only processes you own, and report server lifecycle changes before handoffs.
- Keep each stage's README accurate. Do not claim app workflows exist until implemented and verified.

## Product sources and language

- Read project documents before starting work that depends on them. `docs/system-design-v1.md` is the design source of truth, followed by `docs/schema-v1.sql`, `docs/implementation-plan-v1.md`, `docs/requirements-definition-v1.md`, and `docs/screen-flow-spec-v1.md` for their respective details.
- Do not silently edit source design documents as implementation artifacts. Surface mismatches for the owner to resolve.
- Use the approved term **審査** for application review and its statuses/actions.
- Keep the proposed monorepo layout from system design: `apps/web` for UI, `apps/api` for the API, `packages/shared` for shared types/validation/domain calculations, `db/migrations` for ordered SQL history, `db/src` and `db/scripts` for migration/reset/seed tooling, `infra` for infrastructure notes/configuration, and `docs` for design sources. Applied migrations are immutable; add a new migration instead of editing a deployed one. In API code, group by business module, then keep routes, services, and repositories separate; external providers belong under `integrations`, scheduled work under `jobs`, webhooks under `webhooks`, and runtime concerns under `platform`.

## Data and security

- Never accept, process, store, or log card numbers, security codes, expiration dates, or card tokens. Card entry belongs on the payment provider's hosted UI. Persist only the provider identifiers permitted by the design.
- Do not commit secrets. Keep `.env` ignored; environment validation errors may identify variable names but must not print submitted values.
- The web app must access business data only through the API, never by connecting directly to PostgreSQL.
- Every customer API read and write must be scoped by the authenticated customer's ID. Admin access requires the designed second factor.
- Keep service/company identity, invoice registration, and bank details configurable. The later runtime public settings source is the `settings` table; do not hardcode business identity in application logic.
- Add focused tests for financial arithmetic, periods, credits, invoice numbering, duplicate webhook delivery, and customer data scoping in the stages that implement those behaviors.
- Keep `packages/shared` deterministic and free of database/network access. Web and API consumers must use its shared calculation, status, type, and validation APIs instead of reimplementing them. Keep Japanese validation messages and plan labels centralized there, and cover domain boundaries with tests.
- In the API, create principals only after Firebase Admin verifies an ID token and `user_accounts` resolves the UID. Derive `CustomerScope` from that principal and require it for customer repository reads/writes. Admin operations require DB role plus verified second-factor evidence, and mutation plus audit record share one transaction. Log only generated request IDs, route templates, methods, status, and duration; never raw request or database errors.

## Local development

- Node.js 22.22.2 or newer; pnpm version is pinned by the root `packageManager` field and lockfile. jsdom in the web test toolchain requires Node 22.22.2 on the Node 22 line.
- Use the repo-local Corepack shim in `.tools/bin` where needed so a project's setup does not replace a global toolchain used by other repositories.
- Root checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm test:db`. The DB integration command prepares only the exact loopback `kobito_support_test` database before using it.
- Local services: `docker compose up -d`; inspect readiness with `docker compose ps`, and stop only this repository's services with `docker compose down`.
- `pnpm db:reset` is destructive by design. Its implementation must reject production mode, non-loopback hosts, query/fragment overrides, and database names other than `kobito_support` in development or `kobito_support_test` in test mode before creating a connection. Never broaden that allowlist.
- The web app uses Firebase Auth for sign-in and calls business APIs through the API client. Keep browser Firebase configuration in `VITE_` variables only, attach ID tokens automatically to authenticated API calls, and never add direct database access or card fields to the web app.
- Keep Japanese user-facing web text in `packages/shared/src/messages.ts`. The service name comes from the public settings API; do not bake service/company identity into web UI assets.
