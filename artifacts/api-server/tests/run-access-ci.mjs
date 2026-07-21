#!/usr/bin/env node
/**
 * CI/validation harness for the non-lead access-control e2e suites
 * (standalone entrypoint).
 *
 * Shared lifecycle (build → schema push → start server → run suites → purge →
 * teardown) lives in tests/ci-harness.mjs. This wrapper runs ONLY the
 * staff-access group on its own isolated port/dist. To run the whole gate with
 * a single build, use tests/run-all-ci.mjs instead.
 *
 * Exit code 0 = every suite passed, non-zero = at least one suite failed.
 */

import { useLocalTestDatabase } from "./test-db-guard.mjs";
import { runHarness, HARNESSES } from "./ci-harness.mjs";

// Force the suites onto the local throwaway DB so a validation run can never
// pollute the production Neon database (even if per-run cleanup fails). This
// also aborts if DATABASE_URL looks like production, since the harness
// force-pushes schema to it. See test-db-guard.mjs.
useLocalTestDatabase();

runHarness(HARNESSES.access)
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("Unexpected error in access validation harness:", err);
    process.exit(1);
  });
