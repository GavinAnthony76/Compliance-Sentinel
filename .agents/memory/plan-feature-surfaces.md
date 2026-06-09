---
name: Plan feature surfaces must stay in sync
description: The 3 independent places that decide what a plan can do/see can drift; change them together.
---

A feature's plan tier is expressed in THREE independent surfaces that do NOT
reference each other. Changing one without the others creates confusing "advertised
but does nothing" (or vice-versa) bugs:

1. **Feature gating** — `artifacts/api-server/src/lib/features.ts` (`PLAN_FEATURES`,
   `hasFeature`). The real enforcement; backend routes call `hasFeature(plan, key)`.
2. **Pricing display** — DB-backed plan catalog (`plan-catalog.ts` `DEFAULT_PLANS`
   seeds the `plans` table; the table is the live source of truth and is editable,
   so it can diverge from the code defaults). These are free-text bullet strings.
3. **In-app feature UI** — the actual settings/page that lets a user use the feature
   (e.g. Settings → Branding tab in `lawn-saas/src/pages/settings.tsx`). This is the
   surface most likely to be forgotten when gating.

**Why:** Branding (logo/color/review URL) was Growth+ in (1) and the public booking
page already ignored those fields for Starter, but the Settings → Branding tab had
NO gate, so Starter users could fill in branding that silently did nothing.

**How to apply:** When changing a feature's plan tier, update all three. Frontend
plan checks use `user?.company?.subscriptionPlan` via `useAuthState`; the shared
helper pattern is `planHasFeature(currentPlan, 'growth'|'pro')` in
`lawn-saas/src/components/layout.tsx`. Prefer keeping a gated tab visible with an
upsell (drives upgrades) over hiding it.
