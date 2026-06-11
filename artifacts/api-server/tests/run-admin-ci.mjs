#!/usr/bin/env node
/**
 * CI/validation harness for the platform-admin dormant-deactivation e2e suite.
 *
 * The suite is a black-box HTTP test that needs a RUNNING api-server. This
 * harness makes it self-contained so it can be wired up as an automated
 * validation step (a release gate), mirroring tests/run-permissions-ci.mjs:
 *
 *   1. Build the api-server (esbuild bundle).
 *   2. Start it on an isolated port with the current environment.
 *   3. Wait until it answers HTTP.
 *   4. Run tests/admin-stale-deactivation.e2e.mjs.
 *   5. Always tear the server down.
 *
 * Unlike the permissions/access harnesses, this suite seeds and removes its OWN
 * throwaway platform admins (and restores any real admin a global sweep catches),
 * so no company-level DB snapshot/purge is needed here.
 *
 * Exit code 0 = the suite passed, non-zero = it failed (which blocks the change
 * from being marked complete).
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const artifactDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Build into a harness-specific dir so concurrent CI runs never race on a shared
// `dist/` (which can flake esbuild with "Unexpected end of input").
const DIST = "dist-admin";
const PORT = process.env.ADMIN_CI_PORT || "5097";
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
  console.log(`• Building api-server into ${DIST}…`);
  const buildCode = await run("node", ["build.mjs"], {
    env: { ...process.env, BUILD_OUTDIR: DIST },
  });
  if (buildCode !== 0) {
    console.error("Build failed; aborting admin-deactivation validation.");
    process.exit(buildCode);
  }

  // --- Start server ---------------------------------------------------------
  // Disable outbound email for this server. POST /admin/admins/deactivate-stale
  // emails EVERY admin it sweeps, and the sweep is global against the shared real
  // database — so without this, a validation run could send false "your access
  // was disabled" notices to real dormant operators (a side effect the test's DB
  // restore cannot undo). With RESEND_API_KEY unset, sendEmail() is a no-op mock.
  const serverEnv = { ...process.env, PORT, NODE_ENV: process.env.NODE_ENV || "test" };
  delete serverEnv.RESEND_API_KEY;
  delete serverEnv.RESEND_FROM_EMAIL;

  console.log(`• Starting api-server on port ${PORT} (email delivery disabled)…`);
  const server = spawn("node", ["--enable-source-maps", `${DIST}/index.mjs`], {
    cwd: artifactDir,
    stdio: "inherit",
    env: serverEnv,
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

  // --- Run the suite --------------------------------------------------------
  let code = 1;
  try {
    console.log("=== tests/admin-stale-deactivation.e2e.mjs ===");
    code = await run("node", ["tests/admin-stale-deactivation.e2e.mjs"], {
      env: { ...process.env, API_BASE: BASE },
    });
  } finally {
    shutdown();
  }

  console.log(`\nAdmin-deactivation validation: ${code === 0 ? "PASSED" : "FAILED"}.`);
  process.exit(code === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Unexpected error in admin-deactivation validation harness:", err);
  process.exit(1);
});
