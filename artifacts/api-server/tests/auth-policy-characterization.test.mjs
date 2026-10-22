#!/usr/bin/env node
/**
 * REVIEW-A — characterization + fault-injection tests for the identity and
 * subscription middleware (src/lib/auth.ts, src/lib/subscription.ts) and a
 * static matrix of which routers mount which guard.
 *
 * Originally pinned the fail-open paths recorded in
 * docs/claude-handoff/reviews/REVIEW-A-auth-policy.md; now asserts the approved
 * policy: deleted/deactivated principals are rejected even with existing
 * tokens, roles and company membership come from the database, lookup
 * failures return a retryable 503, a missing company is rejected, and
 * administrative suspension blocks operational access (session + billing
 * recovery exempt) while expired subscriptions keep read-only access.
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
      leftJoin: () => builder,
      where: () => builder,
      limit: () => resolve(),
      then: (ok, err) => resolve().then(ok, err),
    };
    return builder;
  },
};
const column = (name) => ({ name });
const table = new Proxy({}, { get: (_t, prop) => column(String(prop)) });
const dbNamedExports = { db: fakeDb, usersTable: table, companiesTable: table, platformAdminsTable: table };
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
// The joined user + company row requireAuth reads on every request.
const userRow = (overrides = {}) => ({
  isActive: true, role: "admin", companyId: 3, passwordChangedAt: null, companyRowId: 3, companyActive: true, ...overrides,
});
const at = (path, token = userToken) => ({ headers: { authorization: `Bearer ${token}` }, originalUrl: path });
{
  const r = await run(requireAuth, at("/api/customers"), { rows: [userRow()] });
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
  const r = await run(requireAuth, at("/api/customers"), { rows: [userRow({ passwordChangedAt: new Date((nowSec + 60) * 1000) })] });
  check("token issued before the last password change -> 401", r.status === 401 && !r.nextCalled);
}
{
  const r = await run(requireAuth, at("/api/customers"), { rows: [userRow({ isActive: false })] });
  check("A1: deactivated user's existing token -> 401", r.status === 401 && !r.nextCalled, `${r.status}`);
}
{
  const r = await run(requireAuth, at("/api/customers"), { rows: [] });
  check("A2: deleted user's existing token -> 401", r.status === 401 && !r.nextCalled, `${r.status}`);
}
{
  const r = await run(requireAuth, at("/api/customers"), { fail: true });
  check("A3: identity lookup failure -> retryable 503, not access", r.status === 503 && !r.nextCalled, `${r.status}`);
}
{
  const r = await run(requireAuth, at("/api/customers"), { rows: [userRow({ role: "staff" })] });
  check("A4: the CURRENT database role is used, not the token's", r.nextCalled && r.req.user?.role === "staff", r.req.user?.role);
}
{
  const r = await run(requireAuth, at("/api/customers"), { rows: [userRow({ companyId: 99, companyRowId: 99 })] });
  check("A4: a user moved to another company cannot use the old company's token -> 401", r.status === 401 && !r.nextCalled, `${r.status}`);
}
{
  const r = await run(requireAuth, at("/api/customers"), { rows: [userRow({ companyRowId: null, companyActive: null })] });
  check("A6: missing company record -> 403", r.status === 403 && !r.nextCalled, `${r.status}`);
}
for (const path of ["/api/customers", "/api/invoices/12", "/api/portal/auth/send-invite"]) {
  const r = await run(requireAuth, at(path), { rows: [userRow({ companyActive: false })] });
  check(`A8: suspended company is blocked from operational access (${path}) -> 403`, r.status === 403 && !r.nextCalled, `${r.status}`);
}
for (const path of ["/api/auth/me", "/api/billing/status", "/api/billing/portal-session"]) {
  const r = await run(requireAuth, at(path), { rows: [userRow({ companyActive: false })] });
  check(`A8: suspended company keeps session/billing-recovery access (${path})`, r.nextCalled, `${r.status}`);
}
{
  const r = await run(requireAuth, at("/api/billingx"), { rows: [userRow({ companyActive: false })] });
  check("A8: the exemption is prefix-exact (/api/billingx is not billing)", r.status === 403, `${r.status}`);
}

console.log("\nrequireAdminAuth (platform admins):");
const adminToken = signAdminToken({ adminId: 1, role: "admin" });
{
  const r = await run(requireAdminAuth, bearer(adminToken), { rows: [{ isActive: true, role: "super_admin" }] });
  check("active admin -> next, with the CURRENT database role", r.nextCalled && r.req.admin?.role === "super_admin", r.req.admin?.role);
}
{
  const r = await run(requireAdminAuth, bearer(adminToken), { rows: [{ isActive: false, role: "admin" }] });
  check("A5: deactivated admin's existing token -> 401", r.status === 401 && !r.nextCalled, `${r.status}`);
}
{
  const r = await run(requireAdminAuth, bearer(adminToken), { rows: [] });
  check("A5: deleted admin's existing token -> 401", r.status === 401 && !r.nextCalled, `${r.status}`);
}
{
  const r = await run(requireAdminAuth, bearer(adminToken), { fail: true });
  check("admin lookup failure -> retryable 503", r.status === 503 && !r.nextCalled, `${r.status}`);
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
  check("expired/canceled subscriptions keep read-only access (GET)", r.nextCalled && r.selects === 0);
}
{
  const r = await sub("POST", []);
  check("A6: missing company row on a write -> 403", r.status === 403 && !r.nextCalled, `${r.status}`);
}
{
  const r = await sub("POST", [], { fail: true });
  check("A7: subscription lookup failure -> retryable 503, not access", r.status === 503 && !r.nextCalled, `${r.status}`);
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
