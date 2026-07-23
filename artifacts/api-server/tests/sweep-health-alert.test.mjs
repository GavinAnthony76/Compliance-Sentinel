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

mock.module("resend", {
  namedExports: {
    Resend: class {
      constructor() {
        this.emails = { send: async () => ({ error: null }) };
      }
    },
  },
});

// Inspectable stand-ins for drizzle operators so the db mock can tell which
// activity-log action is being queried and which direction it's ordered.
mock.module("drizzle-orm", {
  namedExports: {
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
  },
});

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
  update: () => {
    const c = { set: () => c, where: () => c, returning: () => c, then: (f, r) => Promise.resolve([]).then(f, r) };
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

mock.module("@workspace/db", {
  namedExports: {
    db: dbMock,
    platformAdminsTable,
    activityLogsTable,
    platformSettingsTable,
    DEFAULT_STALE_ADMIN_DAYS: 90,
    ...tables,
  },
});

const { checkSweepHealth, SWEEP_ALERT_ACTION } = await import("../src/lib/sweep-health.ts");

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

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed");
