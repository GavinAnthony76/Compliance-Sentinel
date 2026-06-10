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

`billing` GET (`/status`, `/usage`, `/plans`) is intentionally left open — the trial banner in the shared layout hits these for every user including staff, so role-gating them breaks the staff UI. `billing` gates **writes** (e.g. POST /billing/subscribe) only.

**Why it matters:** "staff can't see the page" (frontend) is not the same as "staff can't read the data" (API). When adding a manager-only page, gate the API read endpoints too — but check shared callers first (the trial banner hits billing for every user, so don't role-gate billing reads).

**How to verify:** `cd artifacts/api-server && pnpm run test:permissions` (black-box, self-provisions owner+staff against the running server). Middleware order matters: in the gated routers `requireRole` runs **before** `requireFeature`, so staff gets a clean 403, not 402.
