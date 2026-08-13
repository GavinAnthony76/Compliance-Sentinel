---
name: Stale-admin sweep scheduler
description: Why the lockout sweep uses a persisted due-check + pg advisory lock instead of a bare 24h setInterval
---

- The scheduled admin-lockout sweep must not rely on an in-process 24h timer: restarts/scale-to-zero reset it, so it never fired in production (last run June 17).
**Why:** Autoscale (Cloud Run) can kill or duplicate instances at any time; only DB-persisted state survives.
**How to apply:** `runStaleAdminSweepIfDue` (lib/stale-admins.ts) checks the newest `admin.admins_auto_deactivated` activity row at startup + hourly, runs only when >=24h old, guarded by `pg_try_advisory_lock` with a re-check under the lock, and repairs the cadence marker durably because `logActivity` swallows insert failures. Any similar background job should copy this pattern (persisted marker + advisory try-lock + re-check + loud failure logging).
- Skipped runs (sweep disabled in settings) intentionally write no marker; the watchdog handles disabled state, and app.ts only info-logs non-skipped runs.
