---
name: Access-control e2e suites pollute the NEON (prod) DB
description: Why the live NEON database keeps filling with test companies, and what to do before go-live.
---

## The problem
The api-server access-control e2e suites (tests/*-access.e2e.mjs, run via the
`lead-access` / `staff-access` validation workflows and on every task merge)
SELF-PROVISION real companies/users/customers by calling POST /auth/register
against the running api-server. The api-server connects to NEON_DATABASE_URL —
the SAME database that serves the app/production. The suites do NOT clean up,
so each run leaves dozens of rows behind.

**Symptom:** after TRUNCATE-ing all tenant tables, `companies`/`users`/
`customers` counts climb back up on their own (e.g. 174 companies in 30 min).
Test rows have recognizable names: "Pay Test", "Portal Test", "Billing Test",
"Manager Test", "Shared Test", "Renamed A/B", slugs like
`pay-test-portalb-<ts>-<rand>`, owner emails `*@example.com`.

**Why it matters:** you cannot keep the prod DB clean for launch while these
suites run, and real customer data will be intermixed with test fixtures.

## CURRENT FIX (in place)
Both CI harnesses (tests/run-access-ci.mjs and tests/run-permissions-ci.mjs)
self-clean via tests/db-cleanup.mjs, using TWO independent guards so real tenant
data is never touched:
1. Snapshot MAX(companies.id) before the suites run; only consider `id > snapshot`.
2. Of those, only delete companies whose OWNER email LIKE '%@example.com' (every
   e2e suite registers its owner with an @example.com address). A real signup that
   lands during the test window uses a real email and is preserved.
Cleanup runs in a `finally`; company deletes cascade to all company-scoped child
tables; activity_logs (no FK to companies) is cleared first for the doomed set.
**Why these two guards, not just id>snapshot:** id>snapshot alone would delete a
genuine signup created during the validation window — the @example.com marker is
the safety net against deleting live tenant data on the prod DB.
3. **Disjoint owner-email namespaces per runner (CRITICAL for concurrency).** The
   permissions and access CI harnesses are separate processes that the validation
   gate runs CONCURRENTLY against the same DB. A global "delete every @example.com
   company above my snapshot" makes each runner delete the OTHER runner's
   still-in-use companies mid-test — symptom: access suite gets random 404s and
   `customers_company_id_companies_id_fk` FK violations while permissions passes.
   Fix: permissions runner creates only `lead_*`/`perm_*` owners and purges ONLY
   those; access runner creates everything else and purges everything EXCEPT
   `lead_%`/`perm_%`. The two delete sets are then provably disjoint. The shared
   pattern list lives in db-cleanup.mjs (PERMISSIONS_OWNER_PATTERNS) as the single
   source of truth. **Why:** snapshot+marker is NOT enough under concurrency —
   isolation also requires that no two concurrent runners share a delete namespace.
**Why not a separate test DB:** full isolation via sandbox $DATABASE_URL was
rejected — that DB has a stale/partial schema (ongoing sync burden). Snapshot +
marker purge keeps NEON clean with no schema-sync work.
**Requires:** `pg` is a devDependency of api-server (pnpm strict node_modules —
the runner can't import pg transitively from @workspace/db without it).
**Strictness:** snapshot is a hard precondition — if it throws, the runner aborts
BEFORE running the polluting suites; a purge failure is treated as a run failure
(non-zero exit) so leftover pollution is never silently passed.

## Manual purge (if residue ever accumulates)
Identify the single real owner company first (it is NOT an @example.com account),
then in a txn via `psql "$NEON_DATABASE_URL"` delete every OTHER company plus its
activity_logs. Keep activity_logs rows with NULL company_id (platform admin.login).
Test rows are recognizable: owner emails `*@example.com`, names like "Pay Test" /
"Billing Test" / "Manager Test", slugs `*-test-*-<ts>-<rand>`.
