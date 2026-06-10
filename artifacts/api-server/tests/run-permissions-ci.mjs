#!/usr/bin/env node
/**
 * CI/validation harness for the lead-access tests.
 *
 * The lead ownership / permissions suites include two HTTP e2e tests that need a
 * RUNNING api-server. This harness makes the whole suite self-contained so it can
 * be wired up as an automated validation step (a release gate):
 *
 *   1. Build the api-server (esbuild bundle).
 *   2. Start it on an isolated port with the current environment.
 *   3. Wait until it answers HTTP.
 *   4. Run, in order:
 *        - tests/lead-ownership.test.mjs  (pure unit test, no server needed)
 *        - tests/permissions.e2e.mjs      (HTTP e2e)
 *        - tests/lead-ownership.e2e.mjs   (HTTP e2e)
 *   5. Always tear the server down.
 *
 * Exit code 0 = every suite passed, non-zero = at least one suite failed (which
 * blocks the change from being marked complete).
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const artifactDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.PERMISSIONS_CI_PORT || "5099";
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
    console.error("Build failed; aborting lead-access validation.");
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
    "tests/lead-ownership.test.mjs",
    "tests/permissions.e2e.mjs",
    "tests/lead-ownership.e2e.mjs",
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
  console.log(`\nLead-access validation: ${suites.length - failed}/${suites.length} suites passed.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Unexpected error in lead-access validation harness:", err);
  process.exit(1);
});
