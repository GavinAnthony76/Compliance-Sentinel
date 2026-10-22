#!/usr/bin/env node
/**
 * Unit test for the lockout-sweep health watchdog (src/lib/sweep-health.ts).
 *
 * The nightly dormancy sweep logs an "admin.admins_auto_deactivated" activity
 * entry on every scheduled run. checkSweepHealth() alerts platform admins by
 * email when the sweep is ENABLED yet no run has been recorded for >48h
 * (dead scheduler), deduped to at most one alert per 24h via a persistent
 * "admin.sweep_health_alert_sent" activity marker.
 *
 * Covered here:
 *   1. No alert when the sweep is disabled in platform settings.
 *   2. No alert when the last run is recent (<48h).
 *   3. Alert when the last run is stale (>48h): dedupe marker logged first,
 *      one email per active admin with an email address.
 *   4. Dedupe: a recent alert marker suppresses re-alerting.
 *   5. Never ran + empty activity log (fresh install): skip, can't judge.
 *   6. Never ran but system demonstrably alive >48h (old activity): alert.
 *   7. No active admins with email: no alert, no dedupe marker.
 *
 * Follows the lockout-runs-health.test.mjs pattern: mock @workspace/db (and
 * drizzle-orm so the action filter is inspectable), import the real module.
 * NODE_ENV=test keeps sendEmail as a logged no-op (never hits Resend), so
 * assertions run against the returned result + the captured activity-log
 * dedupe marker rather than real deliveries.
 *
 * Run: node --experimental-test-module-mocks tests/sweep-health-alert.test.mjs
 */

import { register } from "node:module";
import { mock } from "node:test";

register("./ts-resolve.loader.mjs", import.meta.url);

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret";
process.env.NODE_ENV = "test";

// Mock the notifications module so tests can control per-send delivery
// outcomes ({ delivered: false }, thrown sends) — the real sendEmail
// short-circuits to delivered:true under NODE_ENV=test.
let recoveryEmailImpl = async () => ({ delivered: true });
let recoverySends = [];
const relativeMocks = {
  "../src/lib/notifications.ts": {
    resolveBaseUrl: () => "http://test.local",
    sendSweepHealthAlertEmail: async () => ({ delivered: true }),
    sendSweepHealthRecoveredEmail: async (opts) => {
      recoverySends.push(opts);
      return recoveryEmailImpl(opts);
    },
  },
};
for (const [specifier, namedExports] of Object.entries(relativeMocks)) {
  mock.module(specifier, { namedExports });
}

const resendNamedExports = {
  Resend: class {
    constructor() {
      this.emails = { send: async () => ({ error: null }) };
    }
  },
};
mock.module("resend", { namedExports: resendNamedExports });

// Inspectable stand-ins for drizzle operators so the db mock can tell which
// activity-log action is being queried and which direction it's ordered.
const drizzleNamedExports = {
    eq: (col, val) => ({ op: "eq", col, val }),
    and: (...args) => ({ op: "and", args }),
    or: (...args) => ({ op: "or", args }),
    desc: (col) => ({ dir: "desc", col }),
    asc: (col) => ({ dir: "asc", col }),
    sql: () => ({ op: "sql" }),
    gte: (col, val) => ({ op: "gte", col, val }),
    lt: (col, val) => ({ op: "lt", col, val }),
    lte: (col, val) => ({ op: "lte", col, val }),
    gt: (col, val) => ({ op: "gt", col, val }),
    inArray: (col, val) => ({ op: "inArray", col, val }),
    isNull: (col) => ({ op: "isNull", col }),
    ne: (col, val) => ({ op: "ne", col, val }),
    count: () => ({ op: "count" }),
};
mock.module("drizzle-orm", { namedExports: drizzleNamedExports });

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
let settingsRows = [{ staleAdminDays: 90, staleAdminSweepEnabled: true }];
let activityRows = []; // [{action, createdAt, ...}]
let adminRows = [];    // [{id, email, firstName}]
let insertedLogs = []; // captured activity-log inserts
// Simulated persistent recovery claim (platform_settings.sweep_recovery_notified_alert_at).
let claimedAlertAt = null;   // Date | null
let claimShouldFail = false; // simulate a DB write failure on the claim UPDATE
let claimAttempts = 0;       // how many claim UPDATEs were attempted

const dbMock = {
  select: () => {
    let fromTable = null;
    let whereCond = null;
    let orderDir = null;
    const c = {
      from(t) { fromTable = t; return c; },
      where(cond) { whereCond = cond; return c; },
      orderBy(o) { orderDir = o?.dir ?? null; return c; },
      limit() { return c; },
      then(onFulfilled, onRejected) {
        return Promise.resolve().then(() => {
          if (fromTable?.__table === "platform_settings") return settingsRows;
          if (fromTable?.__table === "platform_admins") {
            return adminRows; // isActive filter — all test rows are active
          }
          if (fromTable?.__table === "activity_logs") {
            let rows = activityRows.slice();
            if (whereCond?.op === "eq" && whereCond.col === "activity_logs.action") {
              rows = rows.filter((r) => r.action === whereCond.val);
            }
            rows.sort((a, b) =>
              orderDir === "asc"
                ? a.createdAt - b.createdAt
                : b.createdAt - a.createdAt,
            );
            return rows;
          }
          return [];
        }).then(onFulfilled, onRejected);
      },
    };
    return c;
  },
  update: (t) => {
    // Models the atomic per-incident recovery claim: the conditional UPDATE on
    // platform_settings succeeds (returns a row) only when the stored claim
    // differs from the alert timestamp being claimed — mirroring
    // `sweep_recovery_notified_alert_at IS DISTINCT FROM $alertAt`.
    let setValues = null;
    const c = {
      set(v) { setValues = v; return c; },
      where() { return c; },
      returning() { return c; },
      then(onFulfilled, onRejected) {
        return Promise.resolve().then(() => {
          if (t?.__table !== "platform_settings") return [];
          claimAttempts++;
          if (claimShouldFail) throw new Error("simulated: claim write failed");
          const next = setValues?.sweepRecoveryNotifiedAlertAt ?? null;
          const same =
            claimedAlertAt !== null && next !== null &&
            claimedAlertAt.getTime() === next.getTime();
          if (same) return []; // claim already held for this incident
          claimedAlertAt = next;
          return [{ id: 1 }];
        }).then(onFulfilled, onRejected);
      },
    };
    return c;
  },
  insert: (t) => ({
    values(v) {
      if (t?.__table === "activity_logs") insertedLogs.push(v);
      const c = { onConflictDoNothing: () => c, returning: () => c, then: (f, r) => Promise.resolve([]).then(f, r) };
      return c;
    },
  }),
};

const dbNamedExports = {
  db: dbMock,
  platformAdminsTable,
  activityLogsTable,
  platformSettingsTable,
  DEFAULT_STALE_ADMIN_DAYS: 90,
  ...tables,
};
mock.module("@workspace/db", { namedExports: dbNamedExports });

// Preflight: fail with an actionable message if production code grew an
// import these mocks don't provide (instead of an opaque import-time crash).
const { assertSuiteMocksCover } = await import("./mock-surface-check.mjs");
assertSuiteMocksCover({
  testFile: import.meta.url,
  entryFiles: ["../src/lib/sweep-health.ts"],
  packageMocks: { resend: resendNamedExports, "drizzle-orm": drizzleNamedExports, "@workspace/db": dbNamedExports },
  relativeMocks,
});

const { checkSweepHealth, SWEEP_ALERT_ACTION, SWEEP_RECOVERED_ACTION } = await import("../src/lib/sweep-health.ts");

let failures = 0;
function check(name, condition, detail) {
  if (condition) console.log(`  PASS  ${name}`);
  else { failures++; console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

const NOW = new Date("2026-07-21T12:00:00Z");
const hoursAgo = (h) => new Date(NOW.getTime() - h * 60 * 60 * 1000);
const RUN_ACTION = "admin.admins_auto_deactivated";

function reset() {
  settingsRows = [{ staleAdminDays: 90, staleAdminSweepEnabled: true }];
  activityRows = [];
  adminRows = [{ id: 1, email: "root@greensynk.com", firstName: "Root" }];
  insertedLogs = [];
  claimedAlertAt = null;
  claimShouldFail = false;
  claimAttempts = 0;
  recoveryEmailImpl = async () => ({ delivered: true });
  recoverySends = [];
}

console.log("checkSweepHealth():");

// 1. Sweep disabled — silence even with an ancient last run.
reset();
settingsRows = [{ staleAdminDays: 90, staleAdminSweepEnabled: false }];
activityRows = [{ action: RUN_ACTION, createdAt: hoursAgo(200) }];
let r = await checkSweepHealth(NOW);
check("disabled sweep never alerts", r.alerted === false && r.reason === "sweep_disabled", JSON.stringify(r));
check("disabled sweep logs no marker", insertedLogs.length === 0);

// 2. Recent run (<48h) — healthy.
reset();
activityRows = [{ action: RUN_ACTION, createdAt: hoursAgo(20) }];
r = await checkSweepHealth(NOW);
check("recent run (<48h) does not alert", r.alerted === false && r.reason === "run_recent", JSON.stringify(r));

// 3. Stale run (>48h) — alert + dedupe marker.
reset();
activityRows = [{ action: RUN_ACTION, createdAt: hoursAgo(60) }];
r = await checkSweepHealth(NOW);
check("stale run (>48h) alerts", r.alerted === true && r.reason === "alerted", JSON.stringify(r));
check("alert logs the dedupe marker",
  insertedLogs.length === 1 && insertedLogs[0].action === SWEEP_ALERT_ACTION,
  JSON.stringify(insertedLogs));
check("marker metadata carries overdue hours + recipients",
  insertedLogs[0]?.metadataJson?.overdueHours === 60 &&
  insertedLogs[0]?.metadataJson?.recipients === 1,
  JSON.stringify(insertedLogs[0]?.metadataJson));

// 4. Dedupe — a fresh alert marker suppresses re-alerting.
reset();
activityRows = [
  { action: RUN_ACTION, createdAt: hoursAgo(60) },
  { action: SWEEP_ALERT_ACTION, createdAt: hoursAgo(5) },
];
r = await checkSweepHealth(NOW);
check("recent alert marker suppresses re-alert", r.alerted === false && r.reason === "recently_alerted", JSON.stringify(r));
check("suppressed tick logs no new marker", insertedLogs.length === 0);

// 4b. Dedupe window elapsed (>24h) while still stale — re-alerts.
reset();
activityRows = [
  { action: RUN_ACTION, createdAt: hoursAgo(80) },
  { action: SWEEP_ALERT_ACTION, createdAt: hoursAgo(30) },
];
r = await checkSweepHealth(NOW);
check("re-alerts after the 24h dedupe window", r.alerted === true, JSON.stringify(r));

// 5. Never ran, empty activity log — fresh install, can't judge.
reset();
activityRows = [];
r = await checkSweepHealth(NOW);
check("empty activity history skips (no_reference)", r.alerted === false && r.reason === "no_reference", JSON.stringify(r));

// 6. Never ran, but other activity proves the system is >48h old — alert.
reset();
activityRows = [{ action: "company.created", createdAt: hoursAgo(100) }];
r = await checkSweepHealth(NOW);
check("never-ran with >48h-old system alerts", r.alerted === true, JSON.stringify(r));
check("never-ran marker records lastRunAt=null", insertedLogs[0]?.metadataJson?.lastRunAt === null, JSON.stringify(insertedLogs[0]?.metadataJson));

// 7. No admins with an email address — nothing to send, no marker burned.
reset();
adminRows = [{ id: 1, email: "", firstName: "NoMail" }];
activityRows = [{ action: RUN_ACTION, createdAt: hoursAgo(60) }];
r = await checkSweepHealth(NOW);
check("no recipients: no alert, reason=no_recipients", r.alerted === false && r.reason === "no_recipients", JSON.stringify(r));
check("no recipients: dedupe marker not logged", insertedLogs.length === 0);

// 8. Recovery: sweep ran again AFTER an outage alert — one-time all-clear.
reset();
activityRows = [
  { action: SWEEP_ALERT_ACTION, createdAt: hoursAgo(30) },
  { action: RUN_ACTION, createdAt: hoursAgo(2) },
];
r = await checkSweepHealth(NOW);
check("run newer than alert sends recovery notice",
  r.alerted === false && r.reason === "recovered" && r.recovered === true, JSON.stringify(r));
check("recovery logs its own dedupe marker",
  insertedLogs.length === 1 && insertedLogs[0].action === SWEEP_RECOVERED_ACTION,
  JSON.stringify(insertedLogs));
check("recovery marker metadata carries run + alert timestamps",
  insertedLogs[0]?.metadataJson?.recoveredRunAt === hoursAgo(2).toISOString() &&
  insertedLogs[0]?.metadataJson?.alertSentAt === hoursAgo(30).toISOString(),
  JSON.stringify(insertedLogs[0]?.metadataJson));

// 8b. Recovery dedupe: an existing claim for THIS alert suppresses resend.
reset();
claimedAlertAt = hoursAgo(30); // claim already held for this incident
activityRows = [
  { action: SWEEP_ALERT_ACTION, createdAt: hoursAgo(30) },
  { action: RUN_ACTION, createdAt: hoursAgo(2) },
];
r = await checkSweepHealth(NOW);
check("recovery notice is one-time (held claim suppresses resend)",
  r.alerted === false && r.reason === "run_recent", JSON.stringify(r));
check("suppressed recovery logs no new marker", insertedLogs.length === 0);

// 8c. Claim from a PREVIOUS incident doesn't suppress a new one.
reset();
claimedAlertAt = hoursAgo(200); // old incident's claim
activityRows = [
  { action: SWEEP_ALERT_ACTION, createdAt: hoursAgo(30) },
  { action: RUN_ACTION, createdAt: hoursAgo(2) },
];
r = await checkSweepHealth(NOW);
check("stale claim from prior incident doesn't suppress",
  r.reason === "recovered" && insertedLogs.length === 1 &&
  insertedLogs[0].action === SWEEP_RECOVERED_ACTION,
  JSON.stringify({ r, insertedLogs }));

// 8g. Concurrency: two overlapping ticks — only the claim winner sends.
reset();
activityRows = [
  { action: SWEEP_ALERT_ACTION, createdAt: hoursAgo(30) },
  { action: RUN_ACTION, createdAt: hoursAgo(2) },
];
const [r1, r2] = await Promise.all([checkSweepHealth(NOW), checkSweepHealth(NOW)]);
const recoveredCount = [r1, r2].filter((x) => x.reason === "recovered").length;
check("concurrent ticks: exactly one wins the claim and sends",
  recoveredCount === 1 && claimAttempts === 2, JSON.stringify({ r1, r2, claimAttempts }));
check("concurrent ticks: exactly one dashboard marker logged",
  insertedLogs.filter((l) => l.action === SWEEP_RECOVERED_ACTION).length === 1,
  JSON.stringify(insertedLogs));

// 8i. Delivery failure ({delivered:false}): claim released, retried next tick,
// and the successful retry stays deduped afterwards.
reset();
recoveryEmailImpl = async () => ({ delivered: false });
activityRows = [
  { action: SWEEP_ALERT_ACTION, createdAt: hoursAgo(30) },
  { action: RUN_ACTION, createdAt: hoursAgo(2) },
];
r = await checkSweepHealth(NOW);
check("all sends undelivered: not reported as recovered",
  r.reason === "run_recent" && recoverySends.length === 1, JSON.stringify(r));
check("all sends undelivered: claim released for retry", claimedAlertAt === null, String(claimedAlertAt));
check("all sends undelivered: no dashboard marker logged", insertedLogs.length === 0, JSON.stringify(insertedLogs));
// Retry tick with delivery working again — sends and holds the claim.
recoveryEmailImpl = async () => ({ delivered: true });
r = await checkSweepHealth(NOW);
check("retry after released claim sends the recovery notice",
  r.reason === "recovered" && recoverySends.length === 2, JSON.stringify(r));
check("successful retry logs marker with delivery counts",
  insertedLogs.length === 1 && insertedLogs[0].metadataJson?.delivered === 1 && insertedLogs[0].metadataJson?.failed === 0,
  JSON.stringify(insertedLogs));
// Third tick — dedupe holds after the successful retry.
r = await checkSweepHealth(NOW);
check("dedupe holds after successful retry",
  r.reason === "run_recent" && recoverySends.length === 2, JSON.stringify(r));

// 8j. Thrown delivery behaves like undelivered: claim released, no marker.
reset();
recoveryEmailImpl = async () => { throw new Error("simulated: provider down"); };
activityRows = [
  { action: SWEEP_ALERT_ACTION, createdAt: hoursAgo(30) },
  { action: RUN_ACTION, createdAt: hoursAgo(2) },
];
r = await checkSweepHealth(NOW);
check("thrown send: not recovered, claim released",
  r.reason === "run_recent" && claimedAlertAt === null && insertedLogs.length === 0,
  JSON.stringify({ r, claimedAlertAt }));

// 8k. Partial delivery: one admin reached — counts as sent, claim held.
reset();
adminRows = [
  { id: 1, email: "root@greensynk.com", firstName: "Root" },
  { id: 2, email: "ops@greensynk.com", firstName: "Ops" },
];
recoveryEmailImpl = async (opts) =>
  opts.to === "root@greensynk.com" ? { delivered: true } : { delivered: false };
activityRows = [
  { action: SWEEP_ALERT_ACTION, createdAt: hoursAgo(30) },
  { action: RUN_ACTION, createdAt: hoursAgo(2) },
];
r = await checkSweepHealth(NOW);
check("partial delivery still counts as recovered",
  r.reason === "recovered" && claimedAlertAt !== null, JSON.stringify(r));
check("partial delivery marker records delivered=1 failed=1",
  insertedLogs[0]?.metadataJson?.delivered === 1 && insertedLogs[0]?.metadataJson?.failed === 1,
  JSON.stringify(insertedLogs[0]?.metadataJson));

// 8h. Claim write failure: the error propagates and NO un-deduped email/marker.
reset();
claimShouldFail = true;
activityRows = [
  { action: SWEEP_ALERT_ACTION, createdAt: hoursAgo(30) },
  { action: RUN_ACTION, createdAt: hoursAgo(2) },
];
let threw = false;
try { await checkSweepHealth(NOW); } catch { threw = true; }
check("claim write failure propagates (send aborted)", threw === true);
check("claim write failure logs no marker", insertedLogs.length === 0, JSON.stringify(insertedLogs));

// 8d. No recovery notice when the run predates the alert (outage still open).
reset();
activityRows = [
  { action: RUN_ACTION, createdAt: hoursAgo(80) },
  { action: SWEEP_ALERT_ACTION, createdAt: hoursAgo(5) },
];
r = await checkSweepHealth(NOW);
check("run older than alert: no recovery, still deduped alert",
  r.alerted === false && r.reason === "recently_alerted", JSON.stringify(r));

// 8e. Recent run with no prior alert: plain healthy, no recovery email.
reset();
activityRows = [{ action: RUN_ACTION, createdAt: hoursAgo(2) }];
r = await checkSweepHealth(NOW);
check("recent run without prior alert is just run_recent",
  r.reason === "run_recent" && insertedLogs.length === 0, JSON.stringify(r));

// 8f. Recovery with no recipients: no marker burned, falls through to healthy.
reset();
adminRows = [{ id: 1, email: "", firstName: "NoMail" }];
activityRows = [
  { action: SWEEP_ALERT_ACTION, createdAt: hoursAgo(30) },
  { action: RUN_ACTION, createdAt: hoursAgo(2) },
];
r = await checkSweepHealth(NOW);
check("recovery with no recipients burns no marker",
  r.reason === "run_recent" && insertedLogs.length === 0, JSON.stringify(r));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed");
