#!/usr/bin/env node
/**
 * Unit test for the optional custom lockout note on a manual admin
 * deactivation (PUT /admin/admins/:id with { isActive: false, note }).
 *
 * The note must flow into BOTH surfaces of a manual deactivation:
 *   - the deactivation email (sendAdminDeactivationEmail in lib/notifications.ts)
 *   - the activity-log metadata (metadataJson.note)
 * and it must flow NOWHERE else:
 *   - a deactivation without a note stores/sends no note
 *   - a non-deactivation update ignores a note in the request body
 *   - the bulk dormancy sweep (deactivateStaleAdmins) NEVER carries a
 *     per-person note — its emails cite inactivity, not an admin's note.
 *
 * The PUT route lives inside the express admin router, which makes live DB
 * calls and (transitively) imports half the server — so, following the
 * billing-status-email.test.mjs pattern, this suite mocks `@workspace/db` and
 * the `resend` package via node:test module mocking, imports the real router,
 * and invokes the PUT /admins/:id handler directly (bypassing the auth
 * middleware by supplying req.admin). No production code changes, no network,
 * no real database.
 *
 * Run: node --experimental-test-module-mocks tests/admin-deactivation-note.test.mjs
 * Exit code 0 = all checks passed, 1 = at least one check failed.
 */

import { register } from "node:module";
import { mock } from "node:test";

// Resolve api-server's extensionless relative .ts imports the way esbuild does.
register("./ts-resolve.loader.mjs", import.meta.url);

// lib/auth.ts throws at import time without these.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret";
process.env.ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "test-admin-secret";
// Make sendEmail take the real Resend path (creds present, NODE_ENV not
// "test") so we can capture the outgoing payload through the mocked `resend`.
process.env.NODE_ENV = "development";
process.env.RESEND_API_KEY = "re_test_dummy";
process.env.RESEND_FROM_EMAIL = "noreply@greensynk.test";
delete process.env.ADMIN_SUPPORT_EMAIL;

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
// Mock @workspace/db: a tiny thenable query-builder stub. Tables are proxies
// whose properties resolve to strings so drizzle's eq()/sql`` helpers accept
// them at call time.
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
  update: (t) =>
    chain(() => (t.__table === "platform_admins" ? updateReturningRows : [])),
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

const { sendAdminDeactivationEmail } = await import("../src/lib/notifications.ts");
const { deactivateStaleAdmins } = await import("../src/lib/stale-admins.ts");
const adminRouter = (await import("../src/routes/admin.ts")).default;

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

const NOTE_LABEL = "Note from the administrator";

function emailMentionsNote(email, note) {
  const html = email?.html || "";
  const text = email?.text || "";
  return (
    html.includes(NOTE_LABEL) && html.includes(note) &&
    text.includes(NOTE_LABEL) && text.includes(note)
  );
}
function emailHasNoteSection(email) {
  return (email?.html || "").includes(NOTE_LABEL) || (email?.text || "").includes(NOTE_LABEL);
}

// ---------------------------------------------------------------------------
// Part 1: sendAdminDeactivationEmail rendering
// ---------------------------------------------------------------------------
console.log("sendAdminDeactivationEmail rendering:");

sentEmails.length = 0;
await sendAdminDeactivationEmail({
  to: "victim@example.com",
  firstName: "Pat",
  reason: "manual",
  note: "Left the company on 2026-07-01",
  supportEmail: "support@greensynk.test",
});
check("manual deactivation with a note sends one email", sentEmails.length === 1, `sent ${sentEmails.length}`);
check(
  "the note appears in both the HTML and plain-text bodies",
  emailMentionsNote(sentEmails[0], "Left the company on 2026-07-01"),
);
check(
  "manual reason cites an administrator, not inactivity",
  (sentEmails[0]?.text || "").includes("by a platform administrator") &&
    !(sentEmails[0]?.text || "").includes("inactivity"),
);

sentEmails.length = 0;
await sendAdminDeactivationEmail({
  to: "victim@example.com",
  firstName: "Pat",
  reason: "manual",
  supportEmail: "support@greensynk.test",
});
check("manual deactivation without a note has no note section", sentEmails.length === 1 && !emailHasNoteSection(sentEmails[0]));

sentEmails.length = 0;
await sendAdminDeactivationEmail({
  to: "victim@example.com",
  firstName: "Pat",
  reason: "manual",
  note: '<script>alert("x")</script>',
  supportEmail: "support@greensynk.test",
});
check(
  "a note is HTML-escaped in the HTML body",
  !(sentEmails[0]?.html || "").includes("<script>") &&
    (sentEmails[0]?.html || "").includes("&lt;script&gt;"),
);

sentEmails.length = 0;
await sendAdminDeactivationEmail({
  to: "victim@example.com",
  firstName: "Pat",
  reason: "inactivity",
  supportEmail: "support@greensynk.test",
});
check(
  "inactivity email cites inactivity and has no note section",
  (sentEmails[0]?.text || "").includes("inactivity") && !emailHasNoteSection(sentEmails[0]),
);

// ---------------------------------------------------------------------------
// Part 2: PUT /admins/:id pass-through (real route handler, mocked I/O)
// ---------------------------------------------------------------------------
const putLayer = adminRouter.stack.find(
  (l) => l.route && l.route.path === "/admins/:id" && l.route.methods.put,
);
if (!putLayer) {
  console.error("FATAL: PUT /admins/:id route not found on the admin router");
  process.exit(1);
}
const putHandler = putLayer.route.stack[0].handle;

async function callPut(body, { id = 42, actingAdminId = 7 } = {}) {
  sentEmails.length = 0;
  activityInserts.length = 0;
  updateReturningRows = [
    {
      id, email: "target@greensynk.test", firstName: "Taylor", lastName: "Ops",
      role: "admin", isActive: body.isActive ?? true,
    },
  ];
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  await putHandler({ params: { id: String(id) }, body, admin: { adminId: actingAdminId } }, res);
  return res;
}

console.log("\nPUT /admins/:id — manual deactivation WITH a note:");
{
  const note = "Contract ended; access revoked per security policy.";
  const res = await callPut({ isActive: false, note });
  check("responds 200", res.statusCode === 200, `got ${res.statusCode}`);
  const log = activityInserts.find((l) => l.action === "admin.admin_deactivated");
  check("writes an admin.admin_deactivated activity log", !!log);
  check(
    "activity log stores the note in metadataJson.note",
    log?.metadataJson?.note === note,
    `metadataJson=${JSON.stringify(log?.metadataJson)}`,
  );
  check("sends exactly one deactivation email", sentEmails.length === 1, `sent ${sentEmails.length}`);
  check("the deactivation email carries the note", emailMentionsNote(sentEmails[0], note));
  check("email goes to the deactivated admin", sentEmails[0]?.to?.includes?.("target@greensynk.test") || sentEmails[0]?.to === "target@greensynk.test");
}

console.log("\nPUT /admins/:id — manual deactivation WITHOUT a note:");
{
  const res = await callPut({ isActive: false });
  check("responds 200", res.statusCode === 200, `got ${res.statusCode}`);
  const log = activityInserts.find((l) => l.action === "admin.admin_deactivated");
  check("writes an admin.admin_deactivated activity log", !!log);
  check(
    "activity log stores NO note metadata",
    log?.metadataJson == null || log.metadataJson.note === undefined,
    `metadataJson=${JSON.stringify(log?.metadataJson)}`,
  );
  check("deactivation email has no note section", sentEmails.length === 1 && !emailHasNoteSection(sentEmails[0]));
}

console.log("\nPUT /admins/:id — blank/whitespace note is treated as no note:");
{
  const res = await callPut({ isActive: false, note: "   " });
  const log = activityInserts.find((l) => l.action === "admin.admin_deactivated");
  check("responds 200", res.statusCode === 200, `got ${res.statusCode}`);
  check(
    "whitespace-only note stores no metadata note",
    log?.metadataJson == null || !log.metadataJson.note,
    `metadataJson=${JSON.stringify(log?.metadataJson)}`,
  );
  check("email has no note section", sentEmails.length === 1 && !emailHasNoteSection(sentEmails[0]));
}

console.log("\nPUT /admins/:id — non-deactivation update ignores a note:");
{
  const res = await callPut({ firstName: "Renamed", note: "should be ignored" });
  check("responds 200", res.statusCode === 200, `got ${res.statusCode}`);
  const log = activityInserts.find((l) => l.action === "admin.admin_updated");
  check("writes an admin.admin_updated activity log", !!log);
  check(
    "no note is stored on a plain update",
    log?.metadataJson == null || log.metadataJson.note === undefined,
    `metadataJson=${JSON.stringify(log?.metadataJson)}`,
  );
  check("no deactivation email is sent", !sentEmails.some((e) => (e.subject || "").toLowerCase().includes("disabled")));
}

console.log("\nPUT /admins/:id — reactivation ignores a note:");
{
  const res = await callPut({ isActive: true, note: "should be ignored" });
  check("responds 200", res.statusCode === 200, `got ${res.statusCode}`);
  const log = activityInserts.find((l) => l.action === "admin.admin_reactivated");
  check("writes an admin.admin_reactivated activity log", !!log);
  check(
    "no note is stored on a reactivation",
    log?.metadataJson == null || log.metadataJson.note === undefined,
    `metadataJson=${JSON.stringify(log?.metadataJson)}`,
  );
  check("no email carries a note section", !sentEmails.some(emailHasNoteSection));
}

// ---------------------------------------------------------------------------
// Part 3: the bulk dormancy sweep never carries a note
// ---------------------------------------------------------------------------
console.log("\ndeactivateStaleAdmins (bulk sweep) never includes a note:");
{
  sentEmails.length = 0;
  activityInserts.length = 0;
  updateReturningRows = [
    { id: 101, email: "dormant1@greensynk.test", firstName: "Dora" },
    { id: 102, email: "dormant2@greensynk.test", firstName: "Mant" },
  ];
  const result = await deactivateStaleAdmins({ excludeAdminId: 7, actorAdminId: 7, trigger: "manual" });
  check("sweep reports both dormant admins", result.deactivatedCount === 2, `got ${result.deactivatedCount}`);
  check("sweep sends one email per swept admin", sentEmails.length === 2, `sent ${sentEmails.length}`);
  check("no sweep email contains a note section", !sentEmails.some(emailHasNoteSection));
  check(
    "every sweep email cites inactivity, not an administrator's note",
    sentEmails.every((e) => (e.text || "").includes("inactivity")),
  );
  const bulkLog = activityInserts.find((l) => l.action === "admin.admins_bulk_deactivated");
  check("bulk activity log is written", !!bulkLog);
  check(
    "bulk activity metadata has no note key",
    bulkLog?.metadataJson != null && !("note" in bulkLog.metadataJson),
    `metadataJson=${JSON.stringify(bulkLog?.metadataJson)}`,
  );
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
