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

## How to apply / fixes
1. Proper fix: boot the api-server with a SEPARATE test database (e.g. the
   sandbox $DATABASE_URL, which is a DIFFERENT db than NEON — see
   neon-vs-sandbox-db.md) when running the e2e validation gates, so tests never
   touch NEON. This touches the test harness/workflow startup env.
2. Stopgap: purge test rows right before go-live with a name/email filter
   (slug LIKE '%-test-%' or email LIKE '%@example.com'), AFTER the test-suite
   churn has stopped, not while merges are still running.
3. Do not bother re-purging while background task agents are still merging —
   the next validation run refills it.
