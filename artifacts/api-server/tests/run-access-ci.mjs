#!/usr/bin/env node
/**
 * CI/validation harness for the non-lead access-control e2e suites.
 *
 * These suites are black-box HTTP tests that need a RUNNING api-server. This
 * harness makes them self-contained so they can be wired up as an automated
 * validation step (a release gate), mirroring tests/run-permissions-ci.mjs:
 *
 *   1. Build the api-server (esbuild bundle).
 *   2. Start it on an isolated port with the current environment.
 *   3. Wait until it answers HTTP.
 *   4. Run, in order:
 *        - tests/invoice-billing-access.e2e.mjs       (invoices + billing access)
 *        - tests/appointment-customer-access.e2e.mjs  (appointments + customers access)
 *        - tests/portal-auth.e2e.mjs                  (customer portal auth)
 *        - tests/payment-access.e2e.mjs               (autopay + portal payment guards)
 *   5. Always tear the server down.
 *
 * Exit code 0 = every suite passed, non-zero = at least one suite failed (which
 * blocks the change from being marked complete).
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const artifactDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.ACCESS_CI_PORT || "5098";
const BASE = `http://127.0.0.1:${PORT}/api`;
const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 500;

function run(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: artifactDir,
      stdio: "inherit",
      ...opts,
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function waitForServer() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      // Any HTTP response (even 401/404) means the server is accepting traffic.
      const res = await fetch(`${BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.status > 0) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
  }
  return false;
}

async function main() {
  // --- Build ----------------------------------------------------------------
  console.log("• Building api-server…");
  const buildCode = await run("node", ["build.mjs"]);
  if (buildCode !== 0) {
    console.error("Build failed; aborting access validation.");
    process.exit(buildCode);
  }

  // --- Start server ---------------------------------------------------------
  console.log(`• Starting api-server on port ${PORT}…`);
  const server = spawn("node", ["--enable-source-maps", "dist/index.mjs"], {
    cwd: artifactDir,
    stdio: "inherit",
    env: { ...process.env, PORT, NODE_ENV: process.env.NODE_ENV || "test" },
  });

  let serverExited = false;
  server.on("exit", (code) => {
    serverExited = true;
    if (code !== 0 && code !== null) {
      console.error(`api-server exited early with code ${code}.`);
    }
  });

  const shutdown = () => {
    if (!serverExited) {
      try {
        server.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
  };
  process.on("exit", shutdown);
  process.on("SIGINT", () => {
    shutdown();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    shutdown();
    process.exit(143);
  });

  // --- Wait for readiness ---------------------------------------------------
  console.log("• Waiting for api-server to accept traffic…");
  const ready = await waitForServer();
  if (!ready || serverExited) {
    console.error("api-server did not become ready in time; aborting.");
    shutdown();
    process.exit(1);
  }
  console.log(`• api-server ready at ${BASE}\n`);

  // --- Run the suites -------------------------------------------------------
  const suites = [
    "tests/invoice-billing-access.e2e.mjs",
    "tests/appointment-customer-access.e2e.mjs",
    "tests/portal-auth.e2e.mjs",
    "tests/payment-access.e2e.mjs",
  ];

  let failed = 0;
  for (const suite of suites) {
    console.log(`\n=== ${suite} ===`);
    const code = await run("node", [suite], {
      env: { ...process.env, API_BASE: BASE },
    });
    if (code !== 0) failed++;
  }

  shutdown();
  console.log(`\nAccess validation: ${suites.length - failed}/${suites.length} suites passed.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Unexpected error in access validation harness:", err);
  process.exit(1);
});
