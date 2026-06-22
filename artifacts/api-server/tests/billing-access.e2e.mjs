#!/usr/bin/env node
/**
 * End-to-end verification of access control on the company-facing billing
 * surface (`/billing`), which the frontend marks manager-only
 * (App.tsx `ProtectedRoute ... managerOnly`) but which had no DEDICATED
 * automated access-control gate of its own.
 *
 * This is a black-box test: it talks to a RUNNING api-server over HTTP and
 * self-provisions two independent companies (each with an owner + staff) so the
 * run is repeatable and independent of existing data. Every billing action
 * affects the WHOLE company's subscription/plan/payment method, so a regression
 * could let staff change the company's plan, or let one tenant act on another's
 * billing. This suite locks down both halves:
 *
 *   1. Role gating — per the router's requireRole usage, the plan-changing and
 *      payment surfaces are manager-only (owner/admin):
 *        - GET  /billing/usage            (manager-only)
 *        - GET  /billing/status           (manager-only)
 *        - POST /billing/subscribe        (manager-only — starts a plan change)
 *        - POST /billing/portal           (manager-only — opens Stripe portal)
 *        - GET  /billing/connect/status   (manager-only)
 *        - POST /billing/connect/onboard  (manager-only)
 *        - POST /billing/connect/dashboard(manager-only)
 *      Staff must be blocked (403) at the router level on all of them, while the
 *      owner is NOT blocked (403). The shared catalog endpoint
 *      GET /billing/plans stays reachable for staff (it lists public pricing).
 *   2. Tenant scoping — every billing endpoint derives companyId from the
 *      caller's own token (there is no resource id in the path), so each tenant
 *      must only ever see its OWN subscription. Companies A and B register on
 *      DIFFERENT plans, and GET /billing/status must report each company's own
 *      plan, never the other's.
 *
 * Usage:
 *   API_BASE="https://<host>/api" node tests/billing-access.e2e.mjs
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

async function registerCompany(label, plan) {
  const nsPrefix = process.env.TEST_RUN_NS ? `${process.env.TEST_RUN_NS}_` : "";
  const ownerEmail = `${nsPrefix}bill_${label}_owner_${stamp}@example.com`;
  const reg = await req("POST", "/auth/register", {
    body: {
      firstName: "Olive",
      lastName: "Owner",
      email: ownerEmail,
      password: PASSWORD,
      companyName: `Billing Test ${label} ${stamp}`,
      selectedPlan: plan,
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
  return { ownerToken: reg.json.token, plan };
}

async function createStaff(ownerToken, label) {
  const email = `bill_${label}_staff_${stamp}@example.com`;
  const created = await req("POST", "/team", {
    token: ownerToken,
    body: { firstName: "Steve", lastName: "Staff", email, password: PASSWORD, role: "staff" },
  });
  if (created.status !== 201) {
    console.error(`Setup failed: could not create staff for ${label}`, created.status, created.json);
    process.exit(1);
  }
  const login = await req("POST", "/auth/login", { body: { identifier: email, password: PASSWORD } });
  if (login.status !== 200 || !login.json?.token) {
    console.error(`Setup failed: could not log in staff for ${label}`, login.status, login.json);
    process.exit(1);
  }
  return login.json.token;
}

async function main() {
  console.log(`Billing access e2e against: ${BASE}\n`);

  // --- Provision two independent companies on DIFFERENT plans ---------------
  // Distinct plans make the tenant-scoping check observable: each company's
  // /billing/status must report its OWN plan, never the other's.
  const companyA = await registerCompany("A", "growth");
  const companyB = await registerCompany("B", "starter");
  const staffTokenA = await createStaff(companyA.ownerToken, "A");

  // ==========================================================================
  // 1. Manager (owner) retains access to the billing surface
  // ==========================================================================
  console.log("\n=== Manager (owner) access ===");
  {
    const r = await req("GET", "/billing/plans", { token: companyA.ownerToken });
    check(
      "owner A can list plans",
      r.status === 200 && Array.isArray(r.json?.plans),
      `status ${r.status}`,
    );
  }
  {
    const r = await req("GET", "/billing/status", { token: companyA.ownerToken });
    check(
      "owner A can read own billing status (plan = growth)",
      r.status === 200 && r.json?.plan === companyA.plan,
      `status ${r.status}, plan ${r.json?.plan}`,
    );
  }
  console.log("Owner must NOT be router-blocked (403) on any billing action:");
  for (const { method, path, body } of [
    { method: "GET", path: "/billing/usage" },
    { method: "GET", path: "/billing/connect/status" },
    { method: "POST", path: "/billing/subscribe", body: { planId: "growth" } },
    { method: "POST", path: "/billing/portal" },
    { method: "POST", path: "/billing/connect/onboard" },
    { method: "POST", path: "/billing/connect/dashboard" },
  ]) {
    const r = await req(method, path, { token: companyA.ownerToken, body });
    check(`owner ${method} ${path} -> not 403`, r.status !== 403, `got ${r.status}`);
  }

  // ==========================================================================
  // 2. Staff are locked out of the plan-changing / payment surfaces
  // ==========================================================================
  console.log("\n=== Staff access (manager-only endpoints must 403) ===");
  for (const { method, path, body } of [
    { method: "GET", path: "/billing/usage" },
    { method: "GET", path: "/billing/status" },
    { method: "POST", path: "/billing/subscribe", body: { planId: "growth" } },
    { method: "POST", path: "/billing/portal" },
    { method: "GET", path: "/billing/connect/status" },
    { method: "POST", path: "/billing/connect/onboard" },
    { method: "POST", path: "/billing/connect/dashboard" },
  ]) {
    const r = await req(method, path, { token: staffTokenA, body });
    check(`staff ${method} ${path} -> 403 (manager-only)`, r.status === 403, `got ${r.status}`);
  }
  console.log("Shared catalog — staff may still see public plan pricing:");
  {
    const r = await req("GET", "/billing/plans", { token: staffTokenA });
    check("staff GET /billing/plans -> not 403", r.status !== 403, `got ${r.status}`);
  }

  // ==========================================================================
  // 3. Tenant scoping — each company only sees its OWN subscription
  // ==========================================================================
  console.log("\n=== Tenant scoping (status is per-caller, never the other tenant's) ===");
  {
    const a = await req("GET", "/billing/status", { token: companyA.ownerToken });
    const b = await req("GET", "/billing/status", { token: companyB.ownerToken });
    check(
      "company A status reports A's plan (growth), not B's",
      a.status === 200 && a.json?.plan === "growth",
      `status ${a.status}, plan ${a.json?.plan}`,
    );
    check(
      "company B status reports B's plan (starter), not A's",
      b.status === 200 && b.json?.plan === "starter" && b.json?.plan !== a.json?.plan,
      `status ${b.status}, plan ${b.json?.plan}`,
    );
  }
  console.log("Unauthenticated requests must NOT reach billing status:");
  {
    const r = await req("GET", "/billing/status");
    check("anonymous GET /billing/status -> 401", r.status === 401, `got ${r.status}`);
  }

  // --- Summary --------------------------------------------------------------
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
