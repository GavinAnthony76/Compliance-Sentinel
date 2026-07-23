#!/usr/bin/env node
/**
 * Combined CI/validation runner: the full api-server test gate with ONE build.
 *
 * Instead of each harness compiling its own esbuild bundle (3 identical builds
 * per full gate), this runner:
 *
 *   1. Builds the api-server ONCE into an isolated dist (dist-ci).
 *   2. Pushes schema to the local test database ONCE.
 *   3. Runs each harness group sequentially — permissions, access, admin —
 *      each still on its own isolated port with its own server instance,
 *      per-run cleanup namespace, and teardown (see tests/ci-harness.mjs).
 *
 * The standalone entrypoints (run-permissions-ci.mjs, run-access-ci.mjs,
 * run-admin-ci.mjs) keep working for running a single group in isolation; they
 * build their own separate dists so a concurrent standalone run never races
 * this runner's bundle.
 *
 * Exit code 0 = every group passed, non-zero = at least one group failed.
 */

import { useLocalTestDatabase } from "./test-db-guard.mjs";
import {
  buildServer,
  pushSchema,
  runHarness,
  run,
  HARNESSES,
} from "./ci-harness.mjs";

// Force everything onto the local throwaway DB so a validation run can never
// pollute the production Neon database. Also aborts if DATABASE_URL looks like
// production, since we force-push schema to it. See test-db-guard.mjs.
useLocalTestDatabase();

const DIST = "dist-ci";

async function main() {
  // Static guard first (fast, no build/DB needed): every call to the payment
  // email dispatchers must be awaited, or Autoscale silently drops the sends.
  console.log("\n########## Awaited payment-dispatch guard ##########\n");
  console.log("=== tests/awaited-dispatch.test.mjs ===");
  const guardCode = await run("node", ["tests/awaited-dispatch.test.mjs"], {
    env: { ...process.env, NODE_ENV: "test" },
  });

  // Complementary static guard: every code path that flips an invoice to
  // "paid" must actually CALL both dispatchers (receipt + owner notification),
  // so a new payment path can't ship without emails at all.
  console.log("\n########## Paid-transition dispatch guard ##########\n");
  console.log("=== tests/paid-transition-dispatch.test.mjs ===");
  const paidGuardCode = await run("node", ["tests/paid-transition-dispatch.test.mjs"], {
    env: { ...process.env, NODE_ENV: "test" },
  });

  const buildCode = await buildServer(DIST);
  if (buildCode !== 0) {
    console.error("Build failed; aborting combined validation.");
    process.exit(buildCode);
  }

  const pushCode = await pushSchema();
  if (pushCode !== 0) {
    console.error("Schema push to local test DB failed; aborting.");
    process.exit(pushCode);
  }

  const groups = ["permissions", "access", "admin"];
  const results = {};
  for (const name of groups) {
    console.log(`\n########## ${HARNESSES[name].label} ##########\n`);
    results[name] = await runHarness(HARNESSES[name], {
      prebuiltDist: DIST,
      skipSchemaPush: true,
    });
  }

  // Stuck-invoice sweep suite: runs the real sweep against the local test DB
  // directly (no server/build needed), mocking Stripe + notifications. Schema
  // was already pushed above. Mirrors tests/run-stuck-invoices-ci.mjs.
  console.log("\n########## Stuck-invoice sweep validation ##########\n");
  console.log("=== tests/stuck-invoices.test.mjs ===");
  results["stuck-invoices"] = await run(
    "node",
    ["--experimental-test-module-mocks", "tests/stuck-invoices.test.mjs"],
    { env: { ...process.env, NODE_ENV: "test" } },
  );

  // Sweep vs. autopay-charge race suite: interleaves the real sweep with the
  // real charge route mid-flight to lock in the compare-and-swap guards that
  // prevent a released invoice from being double-charged.
  console.log("\n########## Sweep/autopay race validation ##########\n");
  console.log("=== tests/autopay-sweep-race.test.mjs ===");
  results["autopay-sweep-race"] = await run(
    "node",
    ["--experimental-test-module-mocks", "tests/autopay-sweep-race.test.mjs"],
    { env: { ...process.env, NODE_ENV: "test" } },
  );

  // Claim-ownership race suite: a stale failed charge's revert must not
  // release a newer writer's in-progress claim (ownership token on the claim).
  console.log("\n########## Claim-ownership race validation ##########\n");
  console.log("=== tests/autopay-claim-ownership.test.mjs ===");
  results["autopay-claim-ownership"] = await run(
    "node",
    ["--experimental-test-module-mocks", "tests/autopay-claim-ownership.test.mjs"],
    { env: { ...process.env, NODE_ENV: "test" } },
  );

  // Notification-email module-mock suites: no server/DB needed (they mock
  // @workspace/db + resend entirely in-memory). Each starts with a preflight
  // (tests/mock-surface-check.mjs) that fails with an actionable "add X to the
  // mock" message if production code grew a new @workspace/db / drizzle-orm
  // import the mock doesn't cover — instead of an opaque import-time
  // SyntaxError. Note: these suites manage NODE_ENV themselves (they must NOT
  // run as "test" or sendEmail short-circuits before the mocked resend client).
  const emailSuites = [
    ["billing-emails", "tests/billing-status-email.test.mjs", "Billing status email validation"],
    ["payment-receipts", "tests/payment-receipt-email.test.mjs", "Payment receipt email validation"],
  ];
  const emailLabels = {};
  for (const [key, file, label] of emailSuites) {
    emailLabels[key] = label;
    console.log(`\n########## ${label} ##########\n`);
    console.log(`=== ${file} ===`);
    results[key] = await run("node", ["--experimental-test-module-mocks", file]);
  }

  console.log("\n========== Combined validation summary ==========");
  let failed = 0;
  const guardOk = guardCode === 0;
  if (!guardOk) failed++;
  console.log(`  ${guardOk ? "PASS" : "FAIL"}  Awaited payment-dispatch guard`);
  const paidGuardOk = paidGuardCode === 0;
  if (!paidGuardOk) failed++;
  console.log(`  ${paidGuardOk ? "PASS" : "FAIL"}  Paid-transition dispatch guard`);
  for (const name of groups) {
    const ok = results[name] === 0;
    if (!ok) failed++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${HARNESSES[name].label}`);
  }
  const stuckOk = results["stuck-invoices"] === 0;
  if (!stuckOk) failed++;
  console.log(`  ${stuckOk ? "PASS" : "FAIL"}  Stuck-invoice sweep validation`);
  const raceOk = results["autopay-sweep-race"] === 0;
  if (!raceOk) failed++;
  console.log(`  ${raceOk ? "PASS" : "FAIL"}  Sweep/autopay race validation`);
  const ownershipOk = results["autopay-claim-ownership"] === 0;
  if (!ownershipOk) failed++;
  console.log(`  ${ownershipOk ? "PASS" : "FAIL"}  Claim-ownership race validation`);
  for (const [key] of emailSuites) {
    const ok = results[key] === 0;
    if (!ok) failed++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${emailLabels[key]}`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Unexpected error in combined validation runner:", err);
  process.exit(1);
});
