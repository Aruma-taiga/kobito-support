# Repository instructions

## Scope and delivery

- Repository: `kobito-support`; GitHub account: `Aruma-taiga`.
- Follow the user-approved five sequential PR stages. Work only on the currently authorized stage, and wait for its CI to pass before starting the next stage. Keep changes within the authorized stage; do not start business/API or web functionality until its stage is approved.
- Keep PR titles and descriptions in Japanese.
- Prefer the low-cost `gpt-6-luna` model for implementation and testing work. Use test-driven development: write meaningful tests first, observe the failing result, implement, and run them again.
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

## Local development

- Node.js 22 or newer; pnpm version is pinned by the root `packageManager` field and lockfile.
- Use the repo-local Corepack shim in `.tools/bin` where needed so a project's setup does not replace a global toolchain used by other repositories.
- Root checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm test:db`. The DB integration command prepares only the exact loopback `kobito_support_test` database before using it.
- Local services: `docker compose up -d`; inspect readiness with `docker compose ps`, and stop only this repository's services with `docker compose down`.
- `pnpm db:reset` is destructive by design. Its implementation must reject production mode, non-loopback hosts, query/fragment overrides, and database names other than `kobito_support` in development or `kobito_support_test` in test mode before creating a connection. Never broaden that allowlist.
