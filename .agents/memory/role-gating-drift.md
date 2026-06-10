---
name: Staff/manager role-gating drift
description: Where role-based access is enforced for the lawn-saas company app, and which manager-only pages are NOT enforced at the API read level.
---

# Staff vs. manager (owner/admin) role gating

The company-app role gate exists in two independent layers that must stay in sync:

- **Frontend**: `artifacts/lawn-saas/src/App.tsx` `ProtectedRoute managerOnly` (redirects staff to `/dashboard`) and `artifacts/lawn-saas/src/components/layout.tsx` (hides `managerOnly` nav items). Treats **10** pages as manager-only: invoices, recurring, routes, reviews, automations, follow-ups, team, reporting, leads, billing.
- **Backend**: `requireRole("owner","admin")` in `artifacts/api-server/src/lib/auth.ts`, applied per-router.

## The drift (now resolved)
`invoices`, `recurring-plans`, `routes-mgmt`, `reviews`, `automations`, `team`, `follow-ups`, `reporting`, and `leads` all enforce `requireRole("owner","admin")` at the **router level** (so their GET reads reject staff with 403, not just writes). `leads` got a `router.use(requireRole(...))` placed BEFORE `requireFeature` — its per-route requireRole on POST/DELETE/convert and the isManager staff-filter branches in the GETs are now redundant but left as harmless defense-in-depth.

`billing` now gates its reads too: `/status` and `/usage` enforce `requireRole("owner","admin")` (staff → 403). This is SAFE — the trial banner (`use-trial-status.ts`) reads `company.subscriptionStatus`/`trialEndsAt` from `useAuthState` (the auth/me payload), NOT from `/billing/status`; those endpoints are only called by the manager-only billing page. `/billing/plans` stays open (shared plan listing). Earlier notes claimed gating billing reads breaks the staff UI — that is no longer true given the auth-state-backed banner. `billing` also gates writes (subscribe/portal/connect/onboard).

**Why it matters:** "staff can't see the page" (frontend) is not the same as "staff can't read the data" (API). When adding a manager-only page, gate the API read endpoints too — but check shared callers first (an endpoint hit by a banner/layout for every user must stay open or you 403 the staff UI).

**How to verify:** two black-box release gates, both self-provisioning (boot their own api-server):
- `pnpm --filter @workspace/api-server run test:permissions:ci` (validation step `lead-access`) — staff/manager role gating + lead row-ownership.
- `pnpm --filter @workspace/api-server run test:access:ci` (validation step `staff-access`) — invoice tenant-isolation + invoice/billing role gating + appointment/customer + property/service tenant isolation & staff access + customer-portal auth isolation + autopay/portal payment guards. Suites: `invoice-billing-access`, `appointment-customer-access`, `property-service-access`, `portal-auth`, `payment-access` (run via `tests/run-access-ci.mjs`). Properties & services are intentionally NOT role-gated (only requireAuth+requireActiveSubscription), so staff keep full CRUD; the suite asserts that.
- The shared `run-access-ci.mjs` boots ONE server (NODE_ENV=test) and runs every suite against it from `127.0.0.1`. The in-memory rate limiter in `app.ts` (10 registrations/60s per IP+URL) is **bypassed when NODE_ENV==="test"** — without that, adding another suite's registrations trips the shared counter and a downstream suite fails with 429. Don't remove that test-env guard when adding suites.

Middleware order matters: in the gated routers `requireRole` runs **before** `requireFeature`, so staff gets a clean 403, not 402. Portal auth is a separate JWT domain (secret + `portal:` suffix); business tokens 401 on portal routes and vice-versa.
