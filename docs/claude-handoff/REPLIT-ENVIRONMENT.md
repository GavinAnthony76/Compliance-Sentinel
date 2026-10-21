# Replit environment and portability

## Verified environment

`.replit` declares nodejs-24, python-3.11, postgresql-16; observed Node/pnpm are 24.13.0 / 10.26.1. The workspace is a pnpm TypeScript monorepo. Lockfile and workspace configuration must remain authoritative.

### Artifact services

| Artifact | Preview path | Development | Production |
| --- | --- | --- | --- |
| API server | `/api` | PORT 8080; `pnpm --filter @workspace/api-server run dev` | Build via package build; `node --enable-source-maps artifacts/api-server/dist/index.mjs`; health `/api/healthz` |
| Lawn SaaS | `/` | PORT 26093, BASE_PATH=/, API_PORT=8080; package dev | Client + SSR + prerender build; `node artifacts/lawn-saas/ssr-server.mjs` |
| GreenSynk ad | `/greensynk-ad` | Separate Vite workflow | Separate artifact, not the business application |
| Component sandbox | `/__mockup` as reported by its dev server | Separate preview workflow | Do not confuse component previews with production SaaS |

Service contracts live in each artifact’s `.replit-artifact/artifact.toml`. Do not hand-edit routing/deployment manifests as part of an unrelated defect. On Replit, artifact tooling validates such configuration.

The user sees a proxied preview. Use artifact-aware API/base URLs, not browser-hardcoded localhost. Local browser development uses Vite’s `/api` proxy and API_PORT. `server.allowedHosts: true` accommodates the managed proxy.

## Publishing boundary

Read-only platform metadata returned public autoscale deployment `https://greensynk.com`, with a successful current build. `.replit` uses application routing and autoscale; it runs `pnpm store prune` post-build. No publishing change was made.

Git push/pull and publishing are separate operations. Whether external GitHub automation can publish is not proven by .replit; no checked-in .github/workflows was found, but platform-side or external automation may exist. A human must verify and disable any production-triggering route before Claude pushes.

Do not use REPLIT_DEV_DOMAIN or REPLIT_DOMAINS as the production URL. Do not treat local source rollback as proof that a deployed image or database was rolled back.

## Configuration names — never values

| Category | Variable names | Requirements |
| --- | --- | --- |
| Database | DATABASE_URL | Required by source; isolated DB for development/tests; managed automatically on Replit |
| Company JWT | SESSION_SECRET or JWT_SECRET | Required; SESSION_SECRET takes precedence |
| Admin JWT | ADMIN_JWT_SECRET | Required separately by current auth module |
| Portal JWT | Same configured JWT/SESSION source, derived with portal prefix | Do not invent a separate PORTAL_JWT_SECRET unless implementing an approved migration |
| Runtime | PORT, NODE_ENV, LOG_LEVEL | PORT mandatory for API/Vite; test suppression depends on NODE_ENV |
| Web/base routing | BASE_PATH, API_PORT, FRONTEND_URL, APP_BASE_URL | Explicit local versus production URL separation; Vite requires BASE_PATH |
| Stripe | STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_V2_WEBHOOK_SECRET | Account/mode-specific; mock or approved sandbox only for Claude |
| Stripe plans/fees | STRIPE_STARTER_PRICE_ID, STRIPE_GROWTH_PRICE_ID, STRIPE_PRO_PRICE_ID, STRIPE_PLATFORM_FEE_PERCENT | IDs depend on configured Stripe account; preserve current fee semantics |
| Email | RESEND_API_KEY, RESEND_FROM_EMAIL | Current sender transport; absence disables real delivery |
| SMS | TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER | Consent requirements independent of credentials |
| AI | AI_INTEGRATIONS_OPENAI_API_KEY, AI_INTEGRATIONS_OPENAI_BASE_URL | Managed proxy may not be available outside Replit |
| Storage | PRIVATE_OBJECT_DIR, PUBLIC_OBJECT_SEARCH_PATHS, DEFAULT_OBJECT_STORAGE_BUCKET_ID | Isolated storage/stub for Claude; never production bucket credentials |
| Support/contact | ADMIN_SUPPORT_EMAIL, CONTACT_EMAIL | Business recipient routing; configure non-customer test destinations |
| Replit managed identity | REPL_IDENTITY, WEB_REPL_RENEWAL, REPLIT_CONNECTORS_HOSTNAME, REPLIT_DEPLOYMENT | Runtime supplied; do not copy/export to Claude |

Source also has development-domain fallback names such as REPLIT_DOMAINS and REPL_SLUG. Legacy NEON_DATABASE_URL is not the app database selector; do not restore it.

Secrets metadata was consulted without reading values. An unset entry in the secrets API is not proof a runtime variable or production service is unavailable; configuration can differ by environment and injection mechanism. No production credential health audit was performed.

## Outside-Replit setup

1. Obtain the approved repository and exact baseline commit; do not clone an unapproved similarly named repo.
2. Use Node 24 and pnpm 10.26.1. Run `pnpm install --frozen-lockfile`; never replace the lockfile with npm/yarn output. Current native-package allowlists target Linux x64/glibc; other OS/architectures need explicit validation, not a silent lockfile rewrite.
3. Provision disposable PostgreSQL with a separate database user. Supply DATABASE_URL using that environment’s secure mechanism.
4. Supply unique local-only SESSION_SECRET/JWT_SECRET and ADMIN_JWT_SECRET securely. No production secrets or customer data.
5. Keep provider credentials absent unless a scoped mock/sandbox setup is approved. Storage/AI/managed connectors require stubs or isolated equivalents.
6. On the disposable database only, initialize schema using the existing reviewed process; see DATABASE.md. Do not run scripts/post-merge.sh just to “finish setup.”
7. Rebuild library declarations with `pnpm run typecheck:libs`.
8. API local start: from the package, existing `dev:local` builds and loads a package `.env` with Node’s env-file support. Alternatively provide secure environment externally and use the normal package build/start commands.
9. Frontend local start: `PORT=26093 BASE_PATH=/ API_PORT=8080 pnpm --filter @workspace/lawn-saas dev`.
10. Validate using VALIDATION.md and compare with BASELINE.md before feature work.

Local .env files are ignored; never commit them. An API start launches background workers and can write data immediately. “Just start the server” is not safe with production/development-real-data credentials.

## Platform documentation consulted

- https://docs.replit.com/features/workspace-tools/git-interface
- https://docs.replit.com/features/publishing/overview
- https://docs.replit.com/features/data-and-storage/development-and-production
- https://docs.replit.com/features/version-control/checkpoints-and-rollbacks

These describe platform capabilities; they do not establish this repository’s GitHub branch protections, automation, backup retention, or account-specific permissions.
