---
name: RBAC dual-surface enforcement
description: Role gating must be applied on BOTH the frontend nav and the backend route, or staff are blocked in UI but APIs stay open.
---

Role-based access in lawn-saas lives in two independent places that must stay in sync:

1. **Frontend** — `artifacts/lawn-saas/src/components/layout.tsx` nav items carry a
   `managerOnly` flag (filtered by `isManager = role === 'owner' || 'admin'`), and
   `App.tsx` `ProtectedRoute` has a `managerOnly` prop that redirects staff to
   `/dashboard`.
2. **Backend** — each manager-only route module must call
   `router.use(requireRole("owner", "admin"))` (from `../lib/auth`).

**Why:** Frontend gating is cosmetic only. A staff user can still call the API
directly. A real gap shipped where `follow-ups.ts` and `reporting.ts` were flagged
`managerOnly` in the nav but only had `requireFeature`/plan gating, not
`requireRole` — so staff were blocked in the UI but the endpoints answered 200.

**How to apply:** Whenever you add or change a `managerOnly` nav item, grep the
matching route file for `requireRole` and add it if missing. Verify end-to-end by
minting a staff JWT (`signUserToken` secret = `SESSION_SECRET || JWT_SECRET`) and
curling the endpoint — expect 403 for staff, 200 for owner. `requireRole` returns
403 `{error:"Forbidden"}`.

**Not every staff-accessible endpoint is a bug.** `leads.ts` is intentionally
"managers, or assigned staff": the list filters by `assignedUserId` for non-managers
and `/:id`/`PUT` return 403 unless the lead is assigned to that user. That is correct
per-resource authorization — do NOT blanket `requireRole` it. Only lock endpoints
that expose company-wide/financial data with no per-row ownership check (e.g. billing
usage/status/connect-status, reporting, follow-ups). Billing `/plans` (catalog) and
the Stripe webhooks must stay open.

Separately: the sidebar identity block must show the signed-in **user's** name +
role (from `/api/auth/me` `firstName`/`lastName`/`role`), not the company name —
otherwise it's impossible to tell which account you're viewing when debugging
role behavior.
