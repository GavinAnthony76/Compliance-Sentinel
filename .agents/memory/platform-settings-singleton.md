---
name: Platform settings singleton
description: How platform-wide admin-configurable settings are stored and read in the lawn-saas/api-server project.
---

# Platform settings

Platform-wide config (not company-scoped, not env vars) lives in a **single-row**
`platform_settings` table pinned to `id = 1`, lazily created with defaults on
first read. Schema: `lib/db/src/schema/platform-settings.ts`. Accessor lib:
`artifacts/api-server/src/lib/platform-settings.ts` (`getPlatformSettings`,
`updatePlatformSettings`, plus MIN/MAX day bounds).

**Why singleton row, not key-value:** the platform only needs a handful of typed
fields; a typed row is simpler than a generic KV store and gives drizzle types
for free.

**How to apply:**
- The dormant-admin lockout threshold (`staleAdminDays`) and whether the daily
  sweep runs (`staleAdminSweepEnabled`) are read fresh inside
  `deactivateStaleAdmins` (lib/stale-admins.ts) on every run — a `scheduled`
  trigger short-circuits to a no-op when the sweep is disabled; a `manual`
  trigger always runs.
- Admin endpoints `GET/PUT /api/admin/settings` (routes/admin.ts) expose it;
  PUT logs an `admin.platform_settings_updated` activity entry with from/to.
- Frontend (admin-settings.tsx, admin-admins.tsx) reads via raw `adminFetch`
  (not the orval client) — adding fields here needs no openapi/codegen change.
- To add a new platform setting: add a column to the schema, rebuild db dist
  (`tsc -b` in lib/db) AND `pnpm --filter @workspace/db run push-force`, then
  extend the lib + endpoint + UI.
