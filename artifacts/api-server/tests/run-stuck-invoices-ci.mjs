#!/usr/bin/env node
/**
 * CI/validation harness for the stuck-invoice sweep tests.
 *
 * tests/stuck-invoices.test.mjs runs the REAL releaseStuckProcessingInvoices
 * sweep against a real database (so the SQL "stuck longer than the window"
 * cutoff is genuinely exercised), mocking only Stripe and the notification
 * dispatchers. That means it needs:
 *
 *   1. The local throwaway test database (NEVER production Neon) — enforced by
 *      test-db-guard.mjs both here and inside the suite itself.
 *   2. The current schema pushed to that database.
 *   3. Node's module-mocking flag (--experimental-test-module-mocks).
 *
 * No api-server build or running server is required: the suite imports the
 * sweep's TypeScript source directly.
 *
 * Exit code 0 = suite passed, non-zero = failure (blocks completion).
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { useLocalTestDatabase } from "./test-db-guard.mjs";

// Redirect every DB entrypoint onto the local test DB, and abort if
// DATABASE_URL looks like production (we force-push schema to it below).
useLocalTestDatabase();

const artifactDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: artifactDir, stdio: "inherit", ...opts });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function main() {
  console.log("• Syncing schema to local test database…");
  const pushCode = await run("pnpm", ["--filter", "db", "push-force"]);
  if (pushCode !== 0) {
    console.error("Schema push to local test DB failed; aborting.");
    process.exit(pushCode);
  }

  console.log("\n=== tests/stuck-invoices.test.mjs ===");
  const code = await run(
    "node",
    ["--experimental-test-module-mocks", "tests/stuck-invoices.test.mjs"],
    { env: { ...process.env, NODE_ENV: "test" } },
  );

  console.log("\n=== tests/autopay-sweep-race.test.mjs ===");
  const raceCode = await run(
    "node",
    ["--experimental-test-module-mocks", "tests/autopay-sweep-race.test.mjs"],
    { env: { ...process.env, NODE_ENV: "test" } },
  );
  console.log("\n=== tests/autopay-claim-ownership.test.mjs ===");
  const ownershipCode = await run(
    "node",
    ["--experimental-test-module-mocks", "tests/autopay-claim-ownership.test.mjs"],
    { env: { ...process.env, NODE_ENV: "test" } },
  );
  process.exit(code !== 0 ? code : raceCode !== 0 ? raceCode : ownershipCode);
}

main().catch((err) => {
  console.error("Unexpected error in stuck-invoice validation harness:", err);
  process.exit(1);
});
