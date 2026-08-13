#!/usr/bin/env node
/**
 * Unit test for the "sweep disabled" toggle and custom-threshold plumbing in
 * the dormant-admin sweep (src/lib/stale-admins.ts).
 *
 * The SCHEDULED daily sweep cannot be triggered over HTTP, so this suite
 * exercises deactivateStaleAdmins() directly (with @workspace/db and `resend`
 * mocked, following the admin-deactivation-note.test.mjs pattern) to prove:
 *   1. A scheduled run with staleAdminSweepEnabled=false is SKIPPED
 *      (result.skipped === true): no admin is touched, no email is sent, and
 *      no activity log is written.
 *   2. A MANUAL run with the sweep disabled still proceeds (not skipped).
 *   3. A scheduled run with the sweep enabled proceeds and applies the CUSTOM
 *      threshold from platform settings (result.thresholdDays), including in
 *      the activity-log metadata.
 *
 * The HTTP-level custom-threshold behavior (PUT /admin/settings + real sweep
 * against a running server) is covered by tests/admin-settings-threshold.e2e.mjs.
 *
 * Run: node --experimental-test-module-mocks tests/admin-sweep-toggle.test.mjs
 * Exit code 0 = all checks passed, 1 = at least one check failed.
 */

import { register } from "node:module";
import { mock } from "node:test";

// Resolve api-server's extensionless relative .ts imports the way esbuild does.
register("./ts-resolve.loader.mjs", import.meta.url);

// lib/auth.ts throws at import time without these.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret";
process.env.ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "test-admin-secret";
// Make sendEmail take the real Resend path so we can observe (mocked) sends.
process.env.NODE_ENV = "development";
process.env.RESEND_API_KEY = "re_test_dummy";
process.env.RESEND_FROM_EMAIL = "noreply@greensynk.test";

// ---------------------------------------------------------------------------
// Mock the `resend` package: capture every outgoing email.
// ---------------------------------------------------------------------------
const sentEmails = [];
mock.module("resend", {
  namedExports: {
    Resend: class {
      constructor() {
        this.emails = {
          send: async (payload) => {
            sentEmails.push(payload);
            return { error: null };
          },
        };
      }
    },
  },
});

// ---------------------------------------------------------------------------
// Mock @workspace/db (same thenable query-builder stub as the note test).
// ---------------------------------------------------------------------------
function tableProxy(name) {
  return new Proxy(
    { __table: name },
    {
      get(target, prop) {
        if (prop === "__table") return name;
        if (typeof prop !== "string" || prop === "then") return undefined;
        return `${name}.${prop}`;
      },
    },
  );
}

const platformAdminsTable = tableProxy("platform_admins");
const activityLogsTable = tableProxy("activity_logs");
const platformSettingsTable = tableProxy("platform_settings");
const tables = Object.fromEntries(
  [
    "companiesTable", "usersTable", "customersTable", "appointmentsTable",
    "invoicesTable", "invoiceLineItemsTable", "leadsTable", "estimatesTable",
    "followUpCampaignsTable", "followUpLogsTable", "communicationEventsTable",
    "smsConsentEventsTable", "plansTable",
  ].map((n) => [n, tableProxy(n)]),
);

// Controlled per test:
let updateReturningRows = []; // rows db.update(platform_admins)…returning() yields
let settingsRows = [{ staleAdminDays: 90, staleAdminSweepEnabled: true }];
let adminUpdateCalls = 0; // how many times db.update(platform_admins) ran
const activityInserts = []; // captured logActivity() rows

function chain(resolveRows) {
  const c = {};
  const passthrough = [
    "from", "where", "limit", "set", "values", "returning",
    "onConflictDoNothing", "orderBy", "leftJoin", "innerJoin", "groupBy",
  ];
  for (const m of passthrough) c[m] = () => c;
  c.then = (onFulfilled, onRejected) =>
    Promise.resolve().then(resolveRows).then(onFulfilled, onRejected);
  return c;
}

const dbMock = {
  select: () => {
    let fromTable = null;
    const c = chain(() =>
      fromTable && fromTable.__table === "platform_settings" ? settingsRows : [],
    );
    c.from = (t) => {
      fromTable = t;
      return c;
    };
    return c;
  },
  update: (t) => {
    if (t.__table === "platform_admins") adminUpdateCalls++;
    return chain(() => (t.__table === "platform_admins" ? updateReturningRows : []));
  },
  insert: (t) => {
    const c = chain(() => []);
    const base = c.values;
    c.values = (vals) => {
      if (t.__table === "activity_logs") activityInserts.push(vals);
      return base();
    };
    return c;
  },
};

mock.module("@workspace/db", {
  namedExports: {
    db: dbMock,
    pool: { connect: async () => ({ query: async () => ({ rows: [{ locked: true }] }), release: () => {} }) },
    platformAdminsTable,
    activityLogsTable,
    platformSettingsTable,
    DEFAULT_STALE_ADMIN_DAYS: 90,
    ...tables,
  },
});

const { deactivateStaleAdmins } = await import("../src/lib/stale-admins.ts");

let failures = 0;
let passes = 0;
function check(name, condition, detail) {
  if (condition) {
    passes++;
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function resetCapture() {
  sentEmails.length = 0;
  activityInserts.length = 0;
  adminUpdateCalls = 0;
}

// ---------------------------------------------------------------------------
// Test 1: scheduled run is SKIPPED when the sweep is disabled in settings
// ---------------------------------------------------------------------------
console.log("Scheduled run with staleAdminSweepEnabled = false:");
{
  settingsRows = [{ staleAdminDays: 30, staleAdminSweepEnabled: false }];
  updateReturningRows = [{ id: 201, email: "dormant@greensynk.test", firstName: "Dora" }];
  resetCapture();

  const result = await deactivateStaleAdmins({ trigger: "scheduled" });
  check("result.skipped is true", result.skipped === true, `got ${JSON.stringify(result)}`);
  check("no admin is deactivated", result.deactivatedCount === 0 && result.deactivatedIds.length === 0);
  check("skipped result still reports the configured thresholdDays", result.thresholdDays === 30, `got ${result.thresholdDays}`);
  check("the platform_admins table is never touched", adminUpdateCalls === 0, `update called ${adminUpdateCalls}x`);
  check("no activity log is written for a skipped run", activityInserts.length === 0, `wrote ${activityInserts.length}`);
  check("no deactivation email is sent", sentEmails.length === 0, `sent ${sentEmails.length}`);
}

// ---------------------------------------------------------------------------
// Test 2: MANUAL run still proceeds while the sweep is disabled
// ---------------------------------------------------------------------------
console.log("\nManual run with staleAdminSweepEnabled = false:");
{
  settingsRows = [{ staleAdminDays: 30, staleAdminSweepEnabled: false }];
  updateReturningRows = [{ id: 202, email: "dormant@greensynk.test", firstName: "Dora" }];
  resetCapture();

  const result = await deactivateStaleAdmins({ excludeAdminId: 7, actorAdminId: 7, trigger: "manual" });
  check("manual run is NOT skipped", result.skipped !== true, `got ${JSON.stringify(result)}`);
  check("manual run deactivates the dormant admin", result.deactivatedCount === 1 && result.deactivatedIds.includes(202));
  check("manual run applies the configured threshold", result.thresholdDays === 30, `got ${result.thresholdDays}`);
  check("manual run updates the platform_admins table", adminUpdateCalls === 1, `update called ${adminUpdateCalls}x`);
  const log = activityInserts.find((l) => l.action === "admin.admins_bulk_deactivated");
  check("manual run writes the bulk-deactivation activity log", !!log);
  check("manual run emails the swept admin", sentEmails.length === 1, `sent ${sentEmails.length}`);
}

// ---------------------------------------------------------------------------
// Test 3: scheduled run proceeds when enabled and applies the custom threshold
// ---------------------------------------------------------------------------
console.log("\nScheduled run with the sweep enabled and a custom 365-day threshold:");
{
  settingsRows = [{ staleAdminDays: 365, staleAdminSweepEnabled: true }];
  updateReturningRows = [{ id: 203, email: "verydormant@greensynk.test", firstName: "Rip" }];
  resetCapture();

  const result = await deactivateStaleAdmins({ trigger: "scheduled" });
  check("scheduled run is not skipped when enabled", result.skipped !== true, `got ${JSON.stringify(result)}`);
  check("scheduled run reports the custom thresholdDays = 365", result.thresholdDays === 365, `got ${result.thresholdDays}`);
  check("scheduled run deactivates the dormant admin", result.deactivatedCount === 1 && result.deactivatedIds.includes(203));
  const log = activityInserts.find((l) => l.action === "admin.admins_auto_deactivated");
  check("scheduled run writes an admin.admins_auto_deactivated activity log", !!log);
  check(
    "activity-log metadata carries the custom threshold and trigger",
    log?.metadataJson?.thresholdDays === 365 && log?.metadataJson?.trigger === "scheduled",
    `metadataJson=${JSON.stringify(log?.metadataJson)}`,
  );
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
