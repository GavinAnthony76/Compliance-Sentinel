# Architecture

## Repository and runtime map

| Location | Responsibility | Dependencies and preservation requirements |
| --- | --- | --- |
| `artifacts/lawn-saas/src/App.tsx` | React application shell, Wouter routes, query defaults, authorization-header injection, protected routes | Preserve caller-supplied Authorization, distinct user/admin/portal sessions, route ordering, and artifact base path |
| `artifacts/lawn-saas/src/pages/` | Public marketing/auth, business operations, portal, platform administration | Shared generated API client plus direct fetch calls; navigation hiding is not API authorization |
| `artifacts/lawn-saas/src/components/` | Shared UI and layout | Radix/shadcn-style primitives, forms, searchable selections, responsive behavior |
| `artifacts/lawn-saas/src/hooks/` | Session and UI hooks | Query cache must not force-refetch disabled auth queries on 401 |
| `artifacts/api-server/src/index.ts` | Catalog initialization, PORT validation, Express startup | Requires database and authentication configuration even when not exercising login |
| `artifacts/api-server/src/app.ts` | Helmet/CORS/logging, layered rate limits, body parsing, raw Stripe body capture, route mount, worker startup | Preserve raw-body ordering and JSON limits; importing app starts workers |
| `artifacts/api-server/src/routes/index.ts` | Authoritative API router registry | Mounted at `/api` by app.ts |
| `artifacts/api-server/src/routes/` | HTTP validation, auth/role/feature gates, tenant predicates, workflow writes | Existing routes are implemented directly rather than through a uniform controller layer |
| `artifacts/api-server/src/lib/` | Domain services and external integrations | Financial/notification workers cross multiple endpoints; do not change one path in isolation |
| `lib/db/src/schema/` | Drizzle schema definitions | PostgreSQL, company ownership, child-table relationships, timestamps, delete policies |
| `lib/db/src/index.ts` | Shared pg Pool and Drizzle client | Reads DATABASE_URL; no Neon fallback here |
| `lib/api-spec/openapi.yaml` | API contract source | Not proof every runtime route is specified; compare routes directly |
| `lib/api-spec/orval.config.ts` | React Query and Zod generation | Generation cleans generated output; never run spec generation as harmless inspection |
| `lib/api-client-react/src/` | Generated React hooks/types and custom fetch | Frontend depends on generated contracts and declaration build |
| `lib/api-zod/src/` | Generated request/response validation exports | Backend consumes schemas; export collisions need explicit resolution |
| `lib/integrations-openai-ai-server/src/` | OpenAI-compatible proxy support | Replit-managed AI variables; avoid eager imports when configuration is absent |
| `artifacts/greensynk-ad/` | Separate branded video/web artifact | Included in root checks; do not remove it to make the SaaS gate green |
| `artifacts/mockup-sandbox/` | Separate component preview environment | Not production SaaS screens; retain its independent scope |
| `scripts/post-merge.sh` | Dependency installation and schema reconciliation after platform task merges | Runs db push; requires separate schema review, not a safe generic test command |

## Technology baseline

Actual runtime observed: Node `v24.13.0`, pnpm `10.26.1`. The manifests declare React 19.1.0, React DOM 19.1.0, Vite ^7.3.5, TypeScript ~5.9.2, Tailwind ^4.1.14, Express ^5, Drizzle ^0.45.2, Zod 3.25.76, Stripe ^20.4.1, Resend ^6.12.4, Twilio ^6.0.2, PDFKit ^0.18.0, and Vitest ^4.1.10. Ranges are manifest declarations, not claims about every installed transitive version. `pnpm-lock.yaml` is authoritative for resolution.

## Request flow

Browser route -> page/hook -> generated client or authenticated fetch -> artifact-aware `/api` routing -> Express protections -> router-level/per-handler auth and input validation -> domain helper -> tenant-scoped Drizzle query -> response/cache update.

Server-side rendering uses `artifacts/lawn-saas/ssr-server.mjs`, not Vite dev in production. The build creates client assets, an SSR bundle, and prerendered public pages using `prerender.mjs` and `vite.ssr.config.ts`.

## API ownership map

Each name below is a file under `artifacts/api-server/src/routes/`. Mounts are relative to `/api`.

| Mount | Route owner |
| --- | --- |
| Health / root router | `health.ts` |
| `/auth` | `auth.ts` |
| `/customers`, `/properties`, `/services` | `customers.ts`, `properties.ts`, `services.ts` |
| `/appointments`, `/recurring-plans` | `appointments.ts`, `recurring-plans.ts` |
| `/invoices`, `/estimates` | `invoices.ts`, `estimates.ts` |
| `/routes` | `routes-mgmt.ts` |
| `/review-requests`, `/reviews` | `review-requests.ts`, `reviews.ts` |
| `/automations`, `/follow-ups` | `automations.ts`, `follow-ups.ts` |
| `/team`, `/settings`, `/dashboard`, `/activity` | `team.ts`, `settings.ts`, `dashboard.ts`, `activity.ts` |
| `/billing` | `billing.ts`, including subscription, Connect and webhook handlers |
| `/admin/auth`, `/admin` | `admin-auth.ts`, `admin.ts` |
| `/public` | `public-booking.ts`, `public-estimates.ts`, `public-reviews.ts` |
| `/export`, `/reporting` | `export.ts`, `reporting.ts` |
| `/portal` | `customer-portal.ts` |
| `/autopay`, `/leads`, `/communications` | `autopay.ts`, `leads.ts`, `communications.ts` |
| Storage paths defined internally | `storage.ts` |
| `/appointment-photos` | `appointment-photos.ts` |
| `/contact`, `/plans`, `/platform` | `contact.ts`, `plans.ts`, `platform.ts` |
| `/sms-consent`, `/sms` | `sms-consent.ts`, `sms-webhook.ts` |

## Identity and authorization

`src/lib/auth.ts` implements bcrypt cost 12 and JWT signing/verification. Company tokens last 7 days, admin tokens 4 hours; portal tokens in `routes/customer-portal.ts` last 30 days and use a portal-specific derived signing key. SESSION_SECRET or JWT_SECRET and a separate ADMIN_JWT_SECRET are required by the auth module. No Clerk/Replit Auth implementation was found on this path.

Company roles are owner/admin/staff. `requireRole` and database ownership checks are separate from UI `managerOnly` guards. The company token supplies authenticated companyId; body/query company identifiers are not authorization. Admin and customer portal are separate identity surfaces.

Risks requiring review: password-change freshness lookup allows requests through on database exceptions; missing user rows are not rejected by that lookup. Admin JWT verification does not itself reload active status on each request. Subscription middleware deliberately passes GETs and fails open on lookup errors; it is not uniformly mounted on every domain router. See BACKLOG.md: REVIEW-A.

## Background processing

app.ts imports and starts reminder scanning, pending follow-ups, recurring appointment generation, processing-invoice recovery, stale-admin sweeping, and sweep-health monitoring. These are in-process loops, not an external durable queue. Autoscale suspension and multiple instances therefore matter. The stale-admin sweep has a persisted cadence and PostgreSQL advisory lock; do not assume all other jobs share those protections. See FEATURE-INVENTORY.md and REVIEW-C.

## Existing protection and gaps

Route/API permissions, portal documents/actions, exports, payment ownership, payment notifications, stale-admin behavior, invoice processing UI, and selected input widgets have tests. There is no proof of comprehensive full-browser coverage of all screens, external-provider correctness, or all event triggers. A green mock suite is not a live delivery confirmation. Tests and exact commands are indexed in VALIDATION.md.
