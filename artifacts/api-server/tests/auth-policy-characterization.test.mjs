#!/usr/bin/env node
/**
 * REVIEW-A — characterization + fault-injection tests for the identity and
 * subscription middleware (src/lib/auth.ts, src/lib/subscription.ts) and a
 * static matrix of which routers mount which guard.
 *
 * These tests PIN CURRENT BEHAVIOR, including the fail-open paths recorded in
 * docs/claude-handoff/reviews/REVIEW-A-auth-policy.md. Cases marked
 * "FINDING" are not endorsements: they document today's behavior so that the
 * policy decision (deny vs. allow vs. 503 for each case) lands as a deliberate,
 * reviewed change to this file rather than a silent behavior shift.
 *
 * Mocks: @workspace/db (a fake db whose next result or failure each case
 * controls) and drizzle-orm. No network or database is touched.
 *
 * Exit code 0 = all checks passed, 1 = at least one check failed.
 */

import { register } from "node:module";
import { mock } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-resolve.loader.mjs", import.meta.url);

process.env.SESSION_SECRET = "review-a-user-secret";
process.env.ADMIN_JWT_SECRET = "review-a-admin-secret";

// --- Fake db: each select resolves to `nextRows`, or rejects when `failNext` --
let nextRows = [];
let failNext = false;
let selectCount = 0;
const fakeDb = {
  select() {
    selectCount++;
    const resolve = () => {
      if (failNext) return Promise.reject(new Error("db unavailable (test)"));
      return Promise.resolve(nextRows);
    };
    const builder = {
      from: () => builder,
      where: () => builder,
      limit: () => resolve(),
      then: (ok, err) => resolve().then(ok, err),
    };
    return builder;
  },
};
const column = (name) => ({ name });
const table = new Proxy({}, { get: (_t, prop) => column(String(prop)) });
const dbNamedExports = { db: fakeDb, usersTable: table, companiesTable: table };
mock.module("@workspace/db", { namedExports: dbNamedExports });
const drizzleNamedExports = { eq: (col, val) => ({ op: "eq", col, val }) };
mock.module("drizzle-orm", { namedExports: drizzleNamedExports });

const { assertMockCovers } = await import("./mock-surface-check.mjs");
for (const [packageName, providedNames] of [
  ["@workspace/db", Object.keys(dbNamedExports)],
  ["drizzle-orm", Object.keys(drizzleNamedExports)],
]) {
  assertMockCovers({
    testFile: import.meta.url,
    packageName,
    providedNames,
    entryFiles: ["../src/lib/auth.ts", "../src/lib/subscription.ts"],
  });
}

const { requireAuth, requireAdminAuth, signUserToken, signAdminToken } = await import("../src/lib/auth.ts");
const { requireActiveSubscription } = await import("../src/lib/subscription.ts");

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

async function run(middleware, req, { rows = [], fail = false } = {}) {
  nextRows = rows;
  failNext = fail;
  selectCount = 0;
  let status = null;
  let nextCalled = false;
  const res = {
    status(code) {
      status = code;
      return res;
    },
    json() {
      return res;
    },
  };
  await middleware(req, res, () => {
    nextCalled = true;
  });
  return { status, nextCalled, req, selects: selectCount };
}

const bearer = (token) => ({ headers: { authorization: `Bearer ${token}` } });
const userToken = signUserToken({ userId: 7, companyId: 3, role: "admin" });
const nowSec = Math.floor(Date.now() / 1000);

console.log("requireAuth (company users):");
{
  const r = await run(requireAuth, bearer(userToken), { rows: [{ passwordChangedAt: null, isActive: true }] });
  check("valid token + active user -> next", r.nextCalled && r.req.user?.userId === 7);
}
{
  const r = await run(requireAuth, { headers: {} });
  check("missing Authorization -> 401", r.status === 401 && !r.nextCalled);
}
{
  const r = await run(requireAuth, bearer("not-a-jwt"));
  check("malformed token -> 401", r.status === 401 && !r.nextCalled);
}
{
  const r = await run(requireAuth, bearer(signAdminToken({ adminId: 1, role: "admin" })));
  check("platform-admin token cannot act as a company user -> 401", r.status === 401 && !r.nextCalled);
}
{
  const r = await run(requireAuth, bearer(userToken), { rows: [{ passwordChangedAt: new Date((nowSec + 60) * 1000) }] });
  check("token issued before the last password change -> 401", r.status === 401 && !r.nextCalled);
}
{
  const r = await run(requireAuth, bearer(userToken), { rows: [{ passwordChangedAt: null, isActive: false }] });
  check("FINDING A1: deactivated user (is_active=false) is still let through", r.nextCalled && r.status === null);
}
{
  const r = await run(requireAuth, bearer(userToken), { rows: [] });
  check("FINDING A2: deleted user (no row) is still let through", r.nextCalled && r.status === null);
}
{
  const r = await run(requireAuth, bearer(userToken), { fail: true });
  check("FINDING A3: user lookup DB failure fails OPEN (next)", r.nextCalled && r.status === null);
}
{
  const r = await run(requireAuth, bearer(userToken), { rows: [{ passwordChangedAt: null, isActive: true, role: "staff" }] });
  check("FINDING A4: role comes from the token, not the current DB role", r.nextCalled && r.req.user?.role === "admin", r.req.user?.role);
}

console.log("\nrequireAdminAuth (platform admins):");
{
  const r = await run(requireAdminAuth, bearer(signAdminToken({ adminId: 1, role: "admin" })), { rows: [{ isActive: false }] });
  check("FINDING A5: no DB check at all — a deactivated admin's token is accepted", r.nextCalled && r.selects === 0, `selects=${r.selects}`);
}
{
  const r = await run(requireAdminAuth, bearer(userToken));
  check("company-user token cannot act as a platform admin -> 401", r.status === 401 && !r.nextCalled);
}

console.log("\nrequireActiveSubscription:");
const user = { userId: 7, companyId: 3, role: "owner", type: "user" };
const day = 24 * 60 * 60 * 1000;
const sub = (method, rows, opts = {}) => run(requireActiveSubscription, { method, user, headers: {} }, { rows, ...opts });
{
  const r = await sub("POST", [{ subscriptionStatus: "active" }]);
  check("active subscription write -> next", r.nextCalled);
}
{
  const r = await sub("POST", [{ subscriptionStatus: "canceled" }]);
  check("canceled subscription write -> 402", r.status === 402 && !r.nextCalled);
}
{
  const r = await sub("POST", [{ subscriptionStatus: "trialing", trialEndsAt: new Date(Date.now() - day) }]);
  check("expired trial write -> 402", r.status === 402 && !r.nextCalled);
}
{
  const r = await sub("POST", [{ subscriptionStatus: "past_due", currentPeriodEnd: new Date(Date.now() - 3 * day) }]);
  check("past_due within the 7-day grace -> next", r.nextCalled);
}
{
  const r = await sub("POST", [{ subscriptionStatus: "past_due", currentPeriodEnd: new Date(Date.now() - 8 * day) }]);
  check("past_due beyond the grace -> 402", r.status === 402 && !r.nextCalled);
}
{
  const r = await sub("GET", [{ subscriptionStatus: "canceled" }]);
  check("reads (GET) are never subscription-gated, even when canceled (by design)", r.nextCalled && r.selects === 0);
}
{
  const r = await sub("POST", []);
  check("FINDING A6: missing company row fails OPEN (next)", r.nextCalled && r.status === null);
}
{
  const r = await sub("POST", [], { fail: true });
  check("FINDING A7: company lookup DB failure fails OPEN (next)", r.nextCalled && r.status === null);
}
{
  const r = await sub("POST", [{ subscriptionStatus: "active", isActive: false }]);
  check("FINDING A8: a platform-suspended company (is_active=false) is not blocked", r.nextCalled && r.status === null);
}
{
  const r = await run(requireActiveSubscription, { method: "POST", headers: {} });
  check("no authenticated user -> next (left to the auth guard)", r.nextCalled);
}

// --- Static mount matrix ------------------------------------------------------
// Which routers carry router-level identity / subscription guards. Changing
// either list should be a reviewed decision (see the REVIEW-A document).
console.log("\nRouter mount matrix:");
const routesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "routes");
const matrix = {};
for (const file of readdirSync(routesDir).filter((f) => f.endsWith(".ts") && f !== "index.ts")) {
  const src = readFileSync(join(routesDir, file), "utf8");
  const uses = [...src.matchAll(/^router\.use\(([^\n]*)\);?$/gm)].map((m) => m[1]).join(" ");
  matrix[file.replace(/\.ts$/, "")] = {
    identity: /\brequire(Admin)?Auth\b/.test(uses),
    subscription: /\brequireActiveSubscription\b/.test(uses),
  };
}
const noRouterIdentity = Object.keys(matrix).filter((n) => !matrix[n].identity).sort();
const identityNoSubscription = Object.keys(matrix).filter((n) => matrix[n].identity && !matrix[n].subscription && n !== "admin").sort();

// Public / portal / webhook / per-route-guarded routers (each documented in REVIEW-A).
const EXPECTED_NO_ROUTER_IDENTITY = [
  "admin-auth", "auth", "contact", "customer-portal", "health", "plans", "platform",
  "public-booking", "public-estimates", "public-reviews", "sms-consent", "sms-webhook", "storage",
];
// Company routers that authenticate but do not subscription-gate writes.
const EXPECTED_IDENTITY_NO_SUBSCRIPTION = [
  "activity", "appointment-photos", "autopay", "billing", "communications", "dashboard", "routes-mgmt", "settings",
];
check(
  "routers without a router-level identity guard match the reviewed list",
  JSON.stringify(noRouterIdentity) === JSON.stringify(EXPECTED_NO_ROUTER_IDENTITY),
  `got ${JSON.stringify(noRouterIdentity)}`,
);
check(
  "authenticated company routers without requireActiveSubscription match the reviewed list",
  JSON.stringify(identityNoSubscription) === JSON.stringify(EXPECTED_IDENTITY_NO_SUBSCRIPTION),
  `got ${JSON.stringify(identityNoSubscription)}`,
);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
