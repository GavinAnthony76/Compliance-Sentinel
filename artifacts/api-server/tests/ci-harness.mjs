/**
 * Shared plumbing for the api-server CI/validation harnesses.
 *
 * Each harness (lead-access, staff-access, admin-access) used to copy-paste the
 * same build / start / wait / cleanup boilerplate AND rebuild the esbuild
 * bundle for itself. This module centralizes that lifecycle:
 *
 *   - buildServer(dist)   — esbuild bundle into an isolated output dir
 *   - pushSchema()        — sync schema to the local test database
 *   - runHarness(config)  — start server on an isolated port, run suites,
 *                           purge namespaced test data, tear down; returns
 *                           an exit code (0 = all passed & cleaned up).
 *
 * The combined runner (run-all-ci.mjs) builds ONE bundle and pushes schema
 * ONCE, then calls runHarness() for each suite group with
 * { prebuiltDist, skipSchemaPush } so the whole gate compiles the server a
 * single time. The per-harness scripts still work standalone: without those
 * options runHarness() builds its own isolated dist and pushes schema itself.
 *
 * Callers MUST invoke useLocalTestDatabase() (tests/test-db-guard.mjs) before
 * runHarness so no validation run can ever touch the production Neon database.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  snapshotMaxCompanyId,
  purgeTestDataAbove,
  makeRunNamespace,
} from "./db-cleanup.mjs";

export const artifactDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 500;

export function run(command, args, opts = {}) {
  const { onOutput, ...spawnOpts } = opts;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: artifactDir,
      stdio: onOutput ? ["ignore", "pipe", "pipe"] : "inherit",
      ...spawnOpts,
    });
    if (onOutput) {
      child.stdout.on("data", (d) => onOutput(d.toString()));
      child.stderr.on("data", (d) => onOutput(d.toString()));
    }
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

export async function waitForServer(base) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      // Any HTTP response (even 401/404) means the server is accepting traffic.
      const res = await fetch(`${base}/auth/login`, {
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

/** Build the api-server bundle into an isolated output dir. */
export async function buildServer(dist) {
  console.log(`• Building api-server into ${dist}…`);
  return run("node", ["build.mjs"], {
    env: { ...process.env, BUILD_OUTDIR: dist },
  });
}

/** Sync schema to the local test database (DATABASE_URL, guarded upstream). */
export async function pushSchema() {
  console.log("• Syncing schema to local test database…");
  return run("pnpm", ["--filter", "db", "push-force"]);
}

// Track live servers so process-level signal handlers (installed once) can
// always tear down whatever server is currently running.
const liveServers = new Set();
let signalHandlersInstalled = false;

function killAllServers() {
  for (const server of liveServers) {
    try {
      server.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
}

function installSignalHandlers() {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;
  process.on("exit", killAllServers);
  process.on("SIGINT", () => {
    killAllServers();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    killAllServers();
    process.exit(143);
  });
}

/**
 * Run one harness (a group of suites against its own isolated server).
 *
 * config:
 *   label          — human-readable name used in log/summary lines
 *   dist           — default isolated build dir for standalone runs
 *   port           — port to serve on (already resolved from env by caller)
 *   suites         — ordered list of test files to run
 *   nsPrefix       — if set, snapshot the DB, mint a TEST_RUN_NS namespace and
 *                    purge that namespace's companies afterwards
 *   disableEmail   — if true, strip Resend creds from the server env so
 *                    sendEmail() is a no-op mock (global admin sweep safety)
 *
 * options:
 *   prebuiltDist   — use this already-built bundle instead of building
 *   skipSchemaPush — schema was already pushed by the caller
 *   onOutput       — if set, ALL output (harness logs, server output, suite
 *                    output) is routed through this callback instead of the
 *                    parent's stdio, so concurrent harnesses can buffer their
 *                    logs per group and keep failures readable.
 *
 * Returns an exit code: 0 = every suite passed and cleanup succeeded.
 */
export async function runHarness(config, options = {}) {
  const { label, port, suites, nsPrefix, disableEmail } = config;
  const dist = options.prebuiltDist || config.dist;
  const base = `http://127.0.0.1:${port}/api`;
  const onOutput = options.onOutput;
  const log = onOutput ? (msg) => onOutput(`${msg}\n`) : console.log;
  const logError = onOutput ? (msg) => onOutput(`${msg}\n`) : console.error;

  // --- Build ----------------------------------------------------------------
  if (!options.prebuiltDist) {
    const buildCode = await buildServer(dist);
    if (buildCode !== 0) {
      logError(`Build failed; aborting ${label}.`);
      return buildCode;
    }
  }

  // --- Sync schema to the local test database -------------------------------
  if (!options.skipSchemaPush) {
    const pushCode = await pushSchema();
    if (pushCode !== 0) {
      logError("Schema push to local test DB failed; aborting.");
      return pushCode;
    }
  }

  // --- Start server ---------------------------------------------------------
  const serverEnv = {
    ...process.env,
    PORT: String(port),
    NODE_ENV: process.env.NODE_ENV || "test",
  };
  if (disableEmail) {
    // POST /admin/admins/deactivate-stale emails EVERY admin it sweeps, and the
    // sweep is global — so without this a validation run could send false "your
    // access was disabled" notices. With RESEND_API_KEY unset, sendEmail() is a
    // no-op mock.
    delete serverEnv.RESEND_API_KEY;
    delete serverEnv.RESEND_FROM_EMAIL;
  }

  log(
    `• Starting api-server on port ${port}${disableEmail ? " (email delivery disabled)" : ""}…`
  );
  const server = spawn("node", ["--enable-source-maps", `${dist}/index.mjs`], {
    cwd: artifactDir,
    stdio: onOutput ? ["ignore", "pipe", "pipe"] : "inherit",
    env: serverEnv,
  });
  if (onOutput) {
    server.stdout.on("data", (d) => onOutput(d.toString()));
    server.stderr.on("data", (d) => onOutput(d.toString()));
  }

  let serverExited = false;
  server.on("exit", (code) => {
    serverExited = true;
    liveServers.delete(server);
    if (code !== 0 && code !== null) {
      logError(`api-server exited early with code ${code}.`);
    }
  });
  liveServers.add(server);
  installSignalHandlers();

  const shutdown = () => {
    if (!serverExited) {
      try {
        server.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
    liveServers.delete(server);
  };

  // --- Wait for readiness ---------------------------------------------------
  log("• Waiting for api-server to accept traffic…");
  const ready = await waitForServer(base);
  if (!ready || serverExited) {
    logError("api-server did not become ready in time; aborting.");
    shutdown();
    return 1;
  }
  log(`• api-server ready at ${base}\n`);

  // --- Optional DB snapshot + per-run namespace ------------------------------
  // Snapshot the DB so every company the suites create can be purged afterwards.
  // This is a hard precondition: if we can't snapshot, we can't clean up, so
  // abort rather than run suites that would permanently pollute the database.
  let dbSnapshot;
  let runNs;
  if (nsPrefix) {
    try {
      dbSnapshot = await snapshotMaxCompanyId();
    } catch (err) {
      logError(
        `Could not snapshot DB before tests; aborting to avoid un-cleanable pollution: ${err.message}`
      );
      shutdown();
      return 1;
    }
    // Every suite embeds this token in the OWNER email of each company it
    // provisions (via TEST_RUN_NS); cleanup purges ONLY this token's companies,
    // so overlapping runs never delete each other's in-flight rows.
    runNs = makeRunNamespace(nsPrefix);
    log(`• Run namespace: ${runNs}`);
  }

  // --- Run the suites -------------------------------------------------------
  let failed = 0;
  let cleanupFailed = false;
  try {
    for (const suite of suites) {
      // A suite is either "tests/foo.mjs" or { file, nodeArgs } for suites
      // that need extra node flags (e.g. --experimental-test-module-mocks).
      const file = typeof suite === "string" ? suite : suite.file;
      const nodeArgs = typeof suite === "string" ? [] : suite.nodeArgs || [];
      log(`\n=== ${file} ===`);
      const suiteEnv = { ...process.env, API_BASE: base };
      if (runNs) suiteEnv.TEST_RUN_NS = runNs;
      const code = await run("node", [...nodeArgs, file], {
        env: suiteEnv,
        onOutput,
      });
      if (code !== 0) failed++;
    }
  } finally {
    if (nsPrefix) {
      // Always purge, even if a suite threw, so failures don't leave residue.
      // A purge failure is itself a run failure so leftover pollution is visible.
      try {
        await purgeTestDataAbove(dbSnapshot, {
          ownerPatterns: [`${runNs}%@example.com`],
          log,
        });
      } catch (err) {
        cleanupFailed = true;
        logError(
          `[db-cleanup] CRITICAL: cleanup failed, test data may remain: ${err.message}`
        );
      }
    }
    shutdown();
  }

  log(
    `\n${label}: ${suites.length - failed}/${suites.length} suites passed.`
  );
  return failed === 0 && !cleanupFailed ? 0 : 1;
}

/** Harness configs shared by the standalone scripts and the combined runner. */
export const HARNESSES = {
  permissions: {
    label: "Lead-access validation",
    dist: "dist-permissions",
    get port() {
      return process.env.PERMISSIONS_CI_PORT || "5099";
    },
    nsPrefix: "perm",
    suites: [
      "tests/lead-ownership.test.mjs",
      "tests/permissions.e2e.mjs",
      "tests/lead-ownership.e2e.mjs",
    ],
  },
  access: {
    label: "Access validation",
    dist: "dist-access",
    get port() {
      return process.env.ACCESS_CI_PORT || "5098";
    },
    nsPrefix: "acc",
    suites: [
      "tests/billing-activity.test.mjs",
      "tests/invoice-number.e2e.mjs",
      "tests/invoice-billing-access.e2e.mjs",
      "tests/appointment-customer-access.e2e.mjs",
      "tests/property-service-access.e2e.mjs",
      "tests/estimate-recurring-plan-access.e2e.mjs",
      "tests/shared-screen-access.e2e.mjs",
      "tests/manager-screen-access.e2e.mjs",
      "tests/billing-access.e2e.mjs",
      "tests/portal-auth.e2e.mjs",
      "tests/payment-access.e2e.mjs",
      "tests/receipt-pdf-access.e2e.mjs",
      "tests/invoice-pdf-access.e2e.mjs",
      "tests/portal-document-access.e2e.mjs",
      "tests/portal-appointment-actions.e2e.mjs",
      "tests/invoice-summary.e2e.mjs",
      "tests/invoice-export-filters.e2e.mjs",
      "tests/appointment-export-filters.e2e.mjs",
    ],
  },
  admin: {
    label: "Admin-deactivation validation",
    dist: "dist-admin",
    get port() {
      return process.env.ADMIN_CI_PORT || "5097";
    },
    // Seeds/removes its OWN throwaway platform admins, so no company-level
    // snapshot/purge namespace is needed here.
    nsPrefix: null,
    disableEmail: true,
    suites: [
      // Unit suite covering the custom lockout note (deactivation-email
      // rendering, PUT /admins/:id pass-through, bulk sweep carries no note).
      {
        file: "tests/admin-deactivation-note.test.mjs",
        nodeArgs: ["--experimental-test-module-mocks"],
      },
      // Unit suite covering the lockout-runs sweep-health endpoint
      // (sweepEnabled flag so the panel can tell "disabled" from "broken").
      {
        file: "tests/lockout-runs-health.test.mjs",
        nodeArgs: ["--experimental-test-module-mocks"],
      },
      // Unit suite: the scheduled sweep is skipped when disabled in settings
      // (manual runs proceed) and honors the configured threshold.
      {
        file: "tests/admin-sweep-toggle.test.mjs",
        nodeArgs: ["--experimental-test-module-mocks"],
      },
      // Unit suite covering the sweep-health watchdog (email alert when the
      // enabled nightly sweep hasn't recorded a run for >48h, with 24h dedupe).
      {
        file: "tests/sweep-health-alert.test.mjs",
        nodeArgs: ["--experimental-test-module-mocks"],
      },
      // Unit suite: updatePlatformSettings() clamps an out-of-range lockout
      // threshold (defense-in-depth behind the route's zod validation — a
      // stored 0 would lock every admin out).
      {
        file: "tests/platform-settings-clamp.test.mjs",
        nodeArgs: ["--experimental-test-module-mocks"],
      },
      "tests/admin-stale-deactivation.e2e.mjs",
      // Pins the GET /admin/lockout-runs contract (auth, newest-first
      // ordering, metadata mapping, manual-sweep exclusion) so the Admin
      // Users lockout-history panel can't silently break.
      "tests/admin-lockout-runs.e2e.mjs",
      // E2E: PUT /admin/settings custom thresholds actually change what the
      // sweep deactivates; settings are restored afterwards.
      "tests/admin-settings-threshold.e2e.mjs",
    ],
  },
};
