#!/usr/bin/env node
/**
 * End-to-end verification of access control on the remaining authenticated,
 * tenant-scoped "shell" surfaces that previously had NO automated access-control
 * gate:
 *
 *   - team        (manager-only, /team)
 *   - settings    (GET staff-accessible, mutations manager-only, /settings)
 *   - activity    (staff-accessible, /activity)
 *   - dashboard   (staff-accessible, /dashboard)
 *   - reporting   (manager-only, /reporting)
 *   - admin       (platform-admin ONLY, /admin — company users must never reach it)
 *
 * This is a black-box test: it talks to a RUNNING api-server over HTTP and
 * self-provisions two independent companies (each with an owner + staff) so the
 * run is repeatable and independent of existing data. Each surface is shared and
 * tenant-scoped, so a regression could either leak another tenant's data or
 * wrongly block/allow staff. This suite locks down both halves:
 *
 *   1. Tenant isolation — company B must never read or mutate company A's
 *      records (cross-tenant mutations must 404, and B's list/aggregate views
 *      must not include A's rows).
 *   2. The intended staff access is preserved per the router's requireRole usage:
 *        - team / reporting ARE manager-only (owner/admin), so staff must stay
 *          locked out (403) while the owner retains access.
 *        - settings reads + payment-config reads are staff-accessible, but
 *          settings mutations are manager-only (staff must get 403).
 *        - activity / dashboard are NOT role-gated, so staff keep full access
 *          within their own company.
 *        - admin is a SEPARATE auth realm (requireAdminAuth): company user
 *          tokens — owner OR staff — must be rejected with 401, never reach it.
 *
 * Usage:
 *   API_BASE="https://<host>/api" node tests/manager-screen-access.e2e.mjs
 *   # or, inside the Replit workspace, it derives the base from REPLIT_DEV_DOMAIN
 *
 * Exit code 0 = all checks passed, 1 = at least one check failed.
 */

const BASE =
  process.env.API_BASE ||
  (process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}/api`
    : "http://localhost:5000/api");

const PASSWORD = "TestPass123!";
const stamp = Date.now();

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

async function req(method, path, { token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON response is fine */
  }
  return { status: res.status, json };
}

async function registerCompany(label) {
  const nsPrefix = process.env.TEST_RUN_NS ? `${process.env.TEST_RUN_NS}_` : "";
  const ownerEmail = `${nsPrefix}mgr_${label}_owner_${stamp}@example.com`;
  const reg = await req("POST", "/auth/register", {
    body: {
      firstName: "Olive",
      lastName: "Owner",
      email: ownerEmail,
      password: PASSWORD,
      companyName: `Manager Test ${label} ${stamp}`,
      selectedPlan: "pro",
    },
  });
  // Self-serve owners register UNVERIFIED with no token; flip the verification
  // gate in the test DB (mirrors clicking the emailed link), then log in.
  if (reg.status === 201) {
    const { markOwnerVerified } = await import("./verify-owner.mjs");
    await markOwnerVerified(ownerEmail);
    const ownerLogin = await req("POST", "/auth/login", { body: { identifier: ownerEmail, password: PASSWORD } });
    reg.status = ownerLogin.status === 200 ? 201 : ownerLogin.status;
    reg.json = ownerLogin.json;
  }
  if (reg.status !== 201 || !reg.json?.token) {
    console.error(`Setup failed: could not register company ${label}`, reg.status, reg.json);
    process.exit(1);
  }
  // Read settings so we have the company's own id (used for isolation checks).
  const settings = await req("GET", "/settings", { token: reg.json.token });
  if (settings.status !== 200 || !settings.json?.id) {
    console.error(`Setup failed: could not read settings for company ${label}`, settings.status, settings.json);
    process.exit(1);
  }
  return { ownerToken: reg.json.token, companyId: settings.json.id };
}

async function createStaff(ownerToken, label) {
  const email = `mgr_${label}_staff_${stamp}@example.com`;
  const created = await req("POST", "/team", {
    token: ownerToken,
    body: { firstName: "Steve", lastName: "Staff", email, password: PASSWORD, role: "staff" },
  });
  if (created.status !== 201 || !created.json?.id) {
    console.error(`Setup failed: could not create staff for ${label}`, created.status, created.json);
    process.exit(1);
  }
  const login = await req("POST", "/auth/login", { body: { identifier: email, password: PASSWORD } });
  if (login.status !== 200 || !login.json?.token) {
    console.error(`Setup failed: could not log in staff for ${label}`, login.status, login.json);
    process.exit(1);
  }
  return { token: login.json.token, id: created.json.id };
}

async function createCustomer(ownerToken, label) {
  const created = await req("POST", "/customers", {
    token: ownerToken,
    body: { firstName: "Cara", lastName: "Customer", phone: `557${stamp}`.slice(0, 12) + label },
  });
  if (created.status !== 201 || !created.json?.id) {
    console.error(`Setup failed: could not create customer for ${label}`, created.status, created.json);
    process.exit(1);
  }
  return created.json.id;
}

async function main() {
  console.log(`Manager-screen access e2e against: ${BASE}\n`);

  // --- Provision two independent companies (A = victim, B = attacker) --------
  const companyA = await registerCompany("A");
  const companyB = await registerCompany("B");
  const staffA = await createStaff(companyA.ownerToken, "A");

  // Company A has a customer; company B intentionally has none, so any
  // cross-tenant leak in an aggregate count is visible (A>=1 vs B==0).
  await createCustomer(companyA.ownerToken, "A");

  // ==========================================================================
  // 1. TEAM — manager-only (owner/admin)
  // ==========================================================================
  console.log("\n=== Team (manager-only) ===");
  {
    const r = await req("GET", "/team", { token: companyA.ownerToken });
    const ids = Array.isArray(r.json?.members) ? r.json.members.map((m) => m.id) : [];
    check("owner A can list team and see own staff member", r.status === 200 && ids.includes(staffA.id), `status ${r.status}, ids ${JSON.stringify(ids)}`);
  }
  console.log("Tenant isolation — company B must get 404 on company A's team member:");
  for (const { method, path, body } of [
    { method: "PUT", path: `/team/${staffA.id}`, body: { firstName: "hijacked" } },
    { method: "DELETE", path: `/team/${staffA.id}` },
  ]) {
    const r = await req(method, path, { token: companyB.ownerToken, body });
    check(`${method} ${path} -> 404 for foreign company B`, r.status === 404, `got ${r.status}`);
  }
  {
    const r = await req("GET", "/team", { token: companyB.ownerToken });
    const ids = Array.isArray(r.json?.members) ? r.json.members.map((m) => m.id) : [];
    check("GET /team for company B excludes company A's staff member", r.status === 200 && !ids.includes(staffA.id), `status ${r.status}, ids ${JSON.stringify(ids)}`);
  }
  console.log("Staff access — team is manager-only, staff must get 403:");
  for (const { method, path, body } of [
    { method: "GET", path: "/team" },
    { method: "POST", path: "/team", body: { firstName: "x", lastName: "y", email: `x_${stamp}@example.com`, password: PASSWORD, role: "staff" } },
    { method: "PUT", path: `/team/${staffA.id}`, body: { firstName: "x" } },
    { method: "DELETE", path: `/team/${staffA.id}` },
  ]) {
    const r = await req(method, path, { token: staffA.token, body });
    check(`staff ${method} ${path} -> 403 (manager-only)`, r.status === 403, `got ${r.status}`);
  }

  // ==========================================================================
  // 2. SETTINGS — reads staff-accessible, mutations manager-only
  // ==========================================================================
  console.log("\n=== Settings (read staff / write manager-only) ===");
  {
    const r = await req("GET", "/settings", { token: companyA.ownerToken });
    check("owner A can read own settings", r.status === 200 && r.json?.id === companyA.companyId, `status ${r.status}, id ${r.json?.id}`);
  }
  {
    const r = await req("PUT", "/settings", { token: companyA.ownerToken, body: { name: `Renamed A ${stamp}` } });
    check("owner A can update own settings", r.status === 200, `got ${r.status}`);
  }
  console.log("Tenant isolation — settings are always scoped to the caller's own company:");
  {
    const r = await req("GET", "/settings", { token: companyB.ownerToken });
    check("GET /settings for company B returns B's company, not A's", r.status === 200 && r.json?.id === companyB.companyId && r.json?.id !== companyA.companyId, `status ${r.status}, id ${r.json?.id}`);
  }
  console.log("Staff access — staff may READ settings but NOT mutate them:");
  {
    const r = await req("GET", "/settings", { token: staffA.token });
    check("staff can read settings", r.status === 200, `got ${r.status}`);
  }
  {
    const r = await req("GET", "/settings/payment-config", { token: staffA.token });
    check("staff can read payment-config", r.status === 200, `got ${r.status}`);
  }
  for (const { method, path, body } of [
    { method: "PUT", path: "/settings", body: { name: "by staff" } },
    { method: "PUT", path: "/settings/payment-config", body: { paymentInstructions: "by staff" } },
  ]) {
    const r = await req(method, path, { token: staffA.token, body });
    check(`staff ${method} ${path} -> 403 (manager-only)`, r.status === 403, `got ${r.status}`);
  }

  // ==========================================================================
  // 3. ACTIVITY — staff-accessible
  // ==========================================================================
  console.log("\n=== Activity (staff-accessible) ===");
  {
    const r = await req("GET", "/activity", { token: companyA.ownerToken });
    const logs = Array.isArray(r.json?.logs) ? r.json.logs : [];
    const allOwn = logs.every((l) => l.companyId === companyA.companyId);
    check("owner A can read own activity feed (all rows are A's)", r.status === 200 && logs.length > 0 && allOwn, `status ${r.status}, count ${logs.length}, allOwn ${allOwn}`);
  }
  console.log("Tenant isolation — company B's activity feed must not contain company A's rows:");
  {
    const r = await req("GET", "/activity", { token: companyB.ownerToken });
    const logs = Array.isArray(r.json?.logs) ? r.json.logs : [];
    const leaked = logs.some((l) => l.companyId === companyA.companyId);
    check("GET /activity for company B excludes company A's rows", r.status === 200 && !leaked, `status ${r.status}, leaked ${leaked}`);
  }
  console.log("Staff access — activity is shared, staff may fully use it:");
  {
    const r = await req("GET", "/activity", { token: staffA.token });
    check("staff can read activity feed", r.status === 200, `got ${r.status}`);
  }
  {
    const r = await req("GET", "/activity/unread-count", { token: staffA.token });
    check("staff can read activity unread-count", r.status === 200, `got ${r.status}`);
  }
  {
    const r = await req("POST", "/activity/mark-seen", { token: staffA.token });
    check("staff can mark activity feed as seen", r.status === 200, `got ${r.status}`);
  }

  // ==========================================================================
  // 4. DASHBOARD — staff-accessible
  // ==========================================================================
  console.log("\n=== Dashboard (staff-accessible) ===");
  {
    const r = await req("GET", "/dashboard", { token: companyA.ownerToken });
    check("owner A sees own dashboard counts (>=1 customer)", r.status === 200 && Number(r.json?.totalCustomers) >= 1, `status ${r.status}, totalCustomers ${r.json?.totalCustomers}`);
  }
  console.log("Tenant isolation — company B's dashboard must not count company A's data:");
  {
    const r = await req("GET", "/dashboard", { token: companyB.ownerToken });
    check("GET /dashboard for company B reports 0 customers (A's not counted)", r.status === 200 && Number(r.json?.totalCustomers) === 0, `status ${r.status}, totalCustomers ${r.json?.totalCustomers}`);
  }
  console.log("Staff access — dashboard is shared, staff may use it:");
  {
    const r = await req("GET", "/dashboard", { token: staffA.token });
    check("staff can read dashboard", r.status === 200, `got ${r.status}`);
  }

  // ==========================================================================
  // 5. REPORTING — manager-only (owner/admin)
  // ==========================================================================
  console.log("\n=== Reporting (manager-only) ===");
  {
    const r = await req("GET", "/reporting", { token: companyA.ownerToken });
    check("owner A sees own reporting summary (>=1 customer)", r.status === 200 && Number(r.json?.summary?.totalCustomers) >= 1, `status ${r.status}, totalCustomers ${r.json?.summary?.totalCustomers}`);
  }
  console.log("Tenant isolation — company B's reporting must not count company A's data:");
  {
    const r = await req("GET", "/reporting", { token: companyB.ownerToken });
    check("GET /reporting for company B reports 0 customers (A's not counted)", r.status === 200 && Number(r.json?.summary?.totalCustomers) === 0, `status ${r.status}, totalCustomers ${r.json?.summary?.totalCustomers}`);
  }
  console.log("Staff access — reporting is manager-only, staff must get 403:");
  {
    const r = await req("GET", "/reporting", { token: staffA.token });
    check("staff GET /reporting -> 403 (manager-only)", r.status === 403, `got ${r.status}`);
  }

  // ==========================================================================
  // 6. ADMIN — platform-admin ONLY (separate auth realm)
  // ==========================================================================
  // /admin is gated by requireAdminAuth, which verifies a platform-admin JWT
  // signed with ADMIN_JWT_SECRET. Company user tokens (owner OR staff) are
  // signed with a different secret, so they must be rejected with 401 — a
  // company user must never reach any admin screen.
  console.log("\n=== Admin (platform-admin only) ===");
  const adminEndpoints = [
    "/admin/dashboard",
    "/admin/revenue",
    "/admin/companies",
    "/admin/beta-readiness",
  ];
  console.log("Owner (company user) must NOT reach admin endpoints:");
  for (const path of adminEndpoints) {
    const r = await req("GET", path, { token: companyA.ownerToken });
    check(`owner A GET ${path} -> 401 (not a platform admin)`, r.status === 401, `got ${r.status}`);
  }
  console.log("Staff (company user) must NOT reach admin endpoints:");
  for (const path of adminEndpoints) {
    const r = await req("GET", path, { token: staffA.token });
    check(`staff GET ${path} -> 401 (not a platform admin)`, r.status === 401, `got ${r.status}`);
  }
  console.log("Unauthenticated requests must NOT reach admin endpoints:");
  {
    const r = await req("GET", "/admin/dashboard");
    check("anonymous GET /admin/dashboard -> 401", r.status === 401, `got ${r.status}`);
  }

  // --- Summary --------------------------------------------------------------
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
