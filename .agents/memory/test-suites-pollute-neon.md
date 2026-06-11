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
3. **Per-RUN namespace token (CRITICAL for concurrency).** Every runner mints a
   unique token at startup via `makeRunNamespace(label)` in db-cleanup.mjs (e.g.
   `accmq90x7e704d594ae`), passes it to its suites as the `TEST_RUN_NS` env var,
   and the suites prepend it to the OWNER email of every company they register
   (`<token>_…@example.com`). Cleanup then purges ONLY `<token>%@example.com`.
   Because the token is unique per run, ANY two runs — concurrent or back-to-back,
   same harness or different — provision and purge provably-disjoint sets.
   **Why this replaced the old per-runner-TYPE split (`lead_%`/`perm_%` vs the
   rest):** that split only isolated permissions-vs-access. Two runs of the SAME
   harness (e.g. a manual `staff-access` plus the workflow) shared one namespace,
   so one run's cleanup deleted the other's in-flight rows — symptom: rotating
   flaky failures like "could not create invoice 500" (FK violation on
   invoice_line_items) or "could not create staff 403", a different suite failing
   almost every run so the gate showed 9/10 though each suite passed in isolation.
   **How to apply:** any NEW suite that registers a company MUST embed
   `process.env.TEST_RUN_NS` in its owner email, or cleanup will both miss it
   (pollution) AND a concurrent run can clobber it. Cleanup keys off the OWNER
   email only (the purge `EXISTS` subquery), so staff/customer emails need not
   carry the token — the company delete cascades to them.
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
