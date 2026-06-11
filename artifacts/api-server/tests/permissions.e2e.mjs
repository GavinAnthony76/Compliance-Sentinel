#!/usr/bin/env node
/**
 * End-to-end verification of staff vs. manager (owner/admin) role permissions.
 *
 * This is a black-box test: it talks to a RUNNING api-server over HTTP and
 * asserts that the backend `requireRole` enforcement stays in sync with the
 * frontend `managerOnly` gating added for role-based access.
 *
 * It self-provisions a fresh company (owner) plus a staff member so the run is
 * repeatable and independent of existing data.
 *
 * Usage:
 *   API_BASE="https://<host>/api" node tests/permissions.e2e.mjs
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
const nsPrefix = process.env.TEST_RUN_NS ? `${process.env.TEST_RUN_NS}_` : "";
const ownerEmail = `${nsPrefix}perm_owner_${stamp}@example.com`;
const staffEmail = `perm_staff_${stamp}@example.com`;

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

// Manager-only routers that enforce requireRole("owner","admin") on all methods.
// Staff must receive 403; a manager must NOT receive 403.
const ROLE_GATED_GET = [
  "/invoices",
  "/recurring-plans",
  "/routes",
  "/reviews",
  "/automations",
  "/team",
  // Read endpoints behind manager-only pages — must reject staff at the role
  // layer (403) before the plan-feature layer, mirroring the frontend gating.
  "/follow-ups",
  "/reporting",
];

// Endpoints shared by all authenticated users — staff must retain access.
// /leads is included: staff can list the pipeline (scoped to leads assigned to
// them by the row-level guard); mutating lead actions stay manager-only below.
const STAFF_ALLOWED_GET = ["/customers", "/appointments", "/dashboard", "/leads"];

// Write endpoints (create/update/delete/convert) on manager-only routers.
// Staff must receive 403 from the router-level requireRole BEFORE any body
// validation or row lookup runs; a manager must NOT receive 403 (they may get
// 201/400/404 depending on payload, all of which are acceptable here).
const ROLE_GATED_WRITE = [
  {
    method: "POST",
    path: "/leads",
    body: { firstName: "Lead", lastName: "Test", source: "manual", status: "new" },
  },
  // NOTE: PUT /leads/:id is intentionally NOT here — staff may update leads
  // assigned to them, so it is no longer router-level role-gated. Row-level
  // ownership (canAccessLead) is covered by tests/lead-ownership.test.mjs.
  { method: "DELETE", path: "/leads/999999999" },
  {
    method: "POST",
    path: "/leads/999999999/convert-to-customer",
  },
  {
    method: "POST",
    path: "/leads/999999999/create-estimate",
  },
  {
    method: "POST",
    path: "/follow-ups",
    body: {
      name: "Perm test campaign",
      triggerType: "lead_created",
      delayHours: 0,
      channel: "email",
      subject: "Hi",
      messageTemplate: "Hello {{firstName}}",
    },
  },
  { method: "PUT", path: "/follow-ups/999999999", body: { name: "Renamed" } },
  { method: "DELETE", path: "/follow-ups/999999999" },
];

async function main() {
  console.log(`Permissions e2e against: ${BASE}\n`);

  // --- Provision owner (manager) + staff in the same company ----------------
  const reg = await req("POST", "/auth/register", {
    body: {
      firstName: "Olive",
      lastName: "Owner",
      email: ownerEmail,
      password: PASSWORD,
      companyName: `Perm Test Co ${stamp}`,
      selectedPlan: "pro",
    },
  });
  if (reg.status !== 201 || !reg.json?.token) {
    console.error("Setup failed: could not register owner", reg.status, reg.json);
    process.exit(1);
  }
  const ownerToken = reg.json.token;

  const staffCreate = await req("POST", "/team", {
    token: ownerToken,
    body: {
      firstName: "Steve",
      lastName: "Staff",
      email: staffEmail,
      password: PASSWORD,
      role: "staff",
    },
  });
  if (staffCreate.status !== 201) {
    console.error("Setup failed: could not create staff", staffCreate.status, staffCreate.json);
    process.exit(1);
  }

  const staffLogin = await req("POST", "/auth/login", {
    body: { email: staffEmail, password: PASSWORD },
  });
  if (staffLogin.status !== 200 || !staffLogin.json?.token) {
    console.error("Setup failed: could not log in staff", staffLogin.status, staffLogin.json);
    process.exit(1);
  }
  const staffToken = staffLogin.json.token;
  check(
    "staff account has role 'staff'",
    staffLogin.json?.user?.role === "staff",
    `got '${staffLogin.json?.user?.role}'`,
  );

  // --- Staff is BLOCKED (403) from every role-gated endpoint ----------------
  console.log("\nStaff must be FORBIDDEN (403) on manager-only endpoints:");
  for (const path of ROLE_GATED_GET) {
    const r = await req("GET", path, { token: staffToken });
    check(`GET ${path} -> 403 for staff`, r.status === 403, `got ${r.status}`);
  }
  // Billing management action is gated at the route level.
  {
    const r = await req("POST", "/billing/subscribe", {
      token: staffToken,
      body: { plan: "growth" },
    });
    check("POST /billing/subscribe -> 403 for staff", r.status === 403, `got ${r.status}`);
  }

  // --- Staff is BLOCKED (403) from WRITING to lead-pipeline data ------------
  console.log("\nStaff must be FORBIDDEN (403) on manager-only write endpoints:");
  for (const { method, path, body } of ROLE_GATED_WRITE) {
    const r = await req(method, path, { token: staffToken, body });
    check(`${method} ${path} -> 403 for staff`, r.status === 403, `got ${r.status}`);
  }

  // --- Manager (owner) RETAINS full access ----------------------------------
  console.log("\nManager (owner) must retain access on the same endpoints:");
  for (const path of ROLE_GATED_GET) {
    const r = await req("GET", path, { token: ownerToken });
    check(`GET ${path} -> not 403 for owner`, r.status !== 403, `got ${r.status}`);
  }

  console.log("\nManager (owner) must NOT be blocked on the write endpoints:");
  for (const { method, path, body } of ROLE_GATED_WRITE) {
    const r = await req(method, path, { token: ownerToken, body });
    check(`${method} ${path} -> not 403 for owner`, r.status !== 403, `got ${r.status}`);
  }

  // --- Staff RETAINS access to shared endpoints (not globally locked out) ---
  console.log("\nStaff must retain access to shared endpoints:");
  for (const path of STAFF_ALLOWED_GET) {
    const r = await req("GET", path, { token: staffToken });
    check(`GET ${path} -> not 403 for staff`, r.status !== 403, `got ${r.status}`);
  }

  // --- Summary --------------------------------------------------------------
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
