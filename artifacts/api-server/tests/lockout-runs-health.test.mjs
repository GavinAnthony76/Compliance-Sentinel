#!/usr/bin/env node
/**
 * Unit test for GET /admin/lockout-runs sweep-health data.
 *
 * The admin lockout panel now warns when the nightly dormancy sweep looks
 * stalled, and distinguishes "broken" from "deliberately disabled". For that
 * it needs the endpoint to expose:
 *   - runs[] / lastRun (already present)
 *   - sweepEnabled: the staleAdminSweepEnabled platform setting
 *
 * Following the admin-deactivation-note.test.mjs pattern: mock @workspace/db,
 * import the real router, invoke the GET /lockout-runs handler directly.
 *
 * Run: node --experimental-test-module-mocks tests/lockout-runs-health.test.mjs
 */

import { register } from "node:module";
import { mock } from "node:test";

register("./ts-resolve.loader.mjs", import.meta.url);

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret";
process.env.ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "test-admin-secret";
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
let activityRows = [];

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
    const c = chain(() => {
      if (fromTable?.__table === "platform_settings") return settingsRows;
      if (fromTable?.__table === "activity_logs") return activityRows;
      return [];
    });
    c.from = (t) => {
      fromTable = t;
      return c;
    };
    return c;
  },
  update: () => chain(() => []),
  insert: () => chain(() => []),
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

const adminRouter = (await import("../src/routes/admin.ts")).default;

const layer = adminRouter.stack.find(
  (l) => l.route && l.route.path === "/lockout-runs" && l.route.methods.get,
);
if (!layer) {
  console.error("FATAL: GET /lockout-runs route not found on the admin router");
  process.exit(1);
}
const handler = layer.route.stack[0].handle;

async function callHandler(query = {}) {
  let jsonBody = null;
  let statusCode = 200;
  const res = {
    status(c) { statusCode = c; return this; },
    json(b) { jsonBody = b; return this; },
  };
  await handler({ query }, res);
  return { statusCode, body: jsonBody };
}

let failures = 0;
function check(name, condition, detail) {
  if (condition) console.log(`  PASS  ${name}`);
  else { failures++; console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("GET /lockout-runs sweep health:");

// 1. Enabled sweep with a recent run.
const recent = new Date();
activityRows = [{
  id: 7,
  createdAt: recent,
  action: "admin.admins_auto_deactivated",
  metadataJson: { count: 2, thresholdDays: 90 },
}];
settingsRows = [{ staleAdminDays: 90, staleAdminSweepEnabled: true }];
let r = await callHandler();
check("responds 200", r.statusCode === 200);
check("exposes sweepEnabled=true from platform settings", r.body?.sweepEnabled === true, JSON.stringify(r.body));
check("lastRun carries ranAt + count + threshold",
  r.body?.lastRun?.id === 7 &&
  r.body?.lastRun?.deactivatedCount === 2 &&
  r.body?.lastRun?.thresholdDays === 90);

// 2. Sweep disabled in platform settings.
settingsRows = [{ staleAdminDays: 90, staleAdminSweepEnabled: false }];
r = await callHandler();
check("exposes sweepEnabled=false when the sweep is turned off", r.body?.sweepEnabled === false, JSON.stringify(r.body));

// 3. No runs at all (fresh install / never scheduled).
activityRows = [];
settingsRows = [{ staleAdminDays: 90, staleAdminSweepEnabled: true }];
r = await callHandler();
check("empty history yields lastRun=null with sweepEnabled still present",
  r.body?.lastRun === null && Array.isArray(r.body?.runs) && r.body.runs.length === 0 && r.body?.sweepEnabled === true,
  JSON.stringify(r.body));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed");
