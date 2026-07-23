#!/usr/bin/env node
/**
 * CI/validation harness for the platform-admin dormant-deactivation suites
 * (standalone entrypoint).
 *
 * Shared lifecycle (build → schema push → start server → run suites → teardown)
 * lives in tests/ci-harness.mjs. This wrapper runs ONLY the admin group on its
 * own isolated port/dist, with outbound email disabled (the global sweep would
 * otherwise email real dormant operators). To run the whole gate with a single
 * build, use tests/run-all-ci.mjs instead.
 *
 * Unlike the permissions/access groups, this suite seeds and removes its OWN
 * throwaway platform admins, so no company-level DB snapshot/purge is needed.
 *
 * Exit code 0 = every suite passed, non-zero = at least one failed.
 */

import { useLocalTestDatabase } from "./test-db-guard.mjs";
import { runHarness, HARNESSES } from "./ci-harness.mjs";

// Force the suite onto the local throwaway DB so a validation run can never
// touch real data (even if the suite's own restore step fails). This also
// aborts if DATABASE_URL looks like production, since the harness force-pushes
// schema to it. See test-db-guard.mjs.
await useLocalTestDatabase();

runHarness(HARNESSES.admin)
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("Unexpected error in admin-deactivation validation harness:", err);
    process.exit(1);
  });
