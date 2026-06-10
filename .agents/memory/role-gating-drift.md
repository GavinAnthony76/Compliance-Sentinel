---
name: Staff/manager role-gating drift
description: Where role-based access is enforced for the lawn-saas company app, and which manager-only pages are NOT enforced at the API read level.
---

# Staff vs. manager (owner/admin) role gating

The company-app role gate exists in two independent layers that must stay in sync:

- **Frontend**: `artifacts/lawn-saas/src/App.tsx` `ProtectedRoute managerOnly` (redirects staff to `/dashboard`) and `artifacts/lawn-saas/src/components/layout.tsx` (hides `managerOnly` nav items). Treats **10** pages as manager-only: invoices, recurring, routes, reviews, automations, follow-ups, team, reporting, leads, billing.
- **Backend**: `requireRole("owner","admin")` in `artifacts/api-server/src/lib/auth.ts`, applied per-router.

## The drift (verified)
Only **6** routers enforce `requireRole` on all methods: `invoices`, `recurring-plans`, `routes-mgmt`, `reviews`, `automations`, `team`. `billing`/`leads` gate **writes** only.

`follow-ups`, `reporting`, and `leads` **GET** endpoints are gated by `requireFeature` (and active subscription), **not** by role — so a staff token with the right plan can still **read** that data directly via the API even though the UI hides those pages. `billing` GET (`/status`, `/usage`, `/plans`) is also open (used by the trial banner for all users — likely intentional).

**Why it matters:** "staff can't see the page" (frontend) is not the same as "staff can't read the data" (API). Closing the gap means adding `requireRole` to the read endpoints of follow-ups/reporting/leads — but check shared callers first (e.g. the trial banner hits billing for every user, so don't role-gate billing reads).

**How to verify:** `cd artifacts/api-server && pnpm run test:permissions` (black-box, self-provisions owner+staff against the running server). Middleware order matters: in the gated routers `requireRole` runs **before** `requireFeature`, so staff gets a clean 403, not 402.
