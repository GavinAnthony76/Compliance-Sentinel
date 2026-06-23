#!/usr/bin/env node
/**
 * End-to-end verification of access control on the estimates + recurring-plans
 * surfaces.
 *
 * This is a black-box test: it talks to a RUNNING api-server over HTTP and
 * self-provisions two independent companies (each with an owner + staff) so the
 * run is repeatable and independent of existing data. Estimates and recurring
 * plans are shared, tenant-scoped endpoints, so a regression could either leak
 * another tenant's data or break the access staff are supposed to have. This
 * suite locks down both halves:
 *
 *   1. Tenant isolation — company B must never read, mutate, or delete company
 *      A's estimate or recurring plan (every cross-tenant attempt must 404, not
 *      silently act on another tenant), and B's list views must not leak A's
 *      rows.
 *   2. The intended staff access is preserved:
 *        - Estimates are NOT role-gated, so staff must keep full access (list,
 *          read, create, update) within their own company.
 *        - Recurring plans ARE manager-only (owner/admin), so staff must stay
 *          locked out (403), while the owner retains full access.
 *
 * Usage:
 *   API_BASE="https://<host>/api" node tests/estimate-recurring-plan-access.e2e.mjs
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
  const ownerEmail = `${nsPrefix}estrec_${label}_owner_${stamp}@example.com`;
  const reg = await req("POST", "/auth/register", {
    body: {
      firstName: "Olive",
      lastName: "Owner",
      email: ownerEmail,
      password: PASSWORD,
      companyName: `EstRec Test ${label} ${stamp}`,
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
  return { ownerToken: reg.json.token };
}

async function createStaff(ownerToken, label) {
  const email = `estrec_${label}_staff_${stamp}@example.com`;
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

async function createEstimate(ownerToken, customerId, label) {
  const created = await req("POST", "/estimates", {
    token: ownerToken,
    body: {
      customerId,
      notes: `Estimate ${label} ${stamp}`,
      lineItems: [{ description: "Lawn mowing", quantity: 1, unitPrice: 99.99 }],
    },
  });
  if (created.status !== 201 || !created.json?.id) {
    console.error("Setup failed: could not create estimate", created.status, created.json);
    process.exit(1);
  }
  return created.json.id;
}

async function createRecurringPlan(ownerToken, customerId, label) {
  const created = await req("POST", "/recurring-plans", {
    token: ownerToken,
    body: {
      customerId,
      frequencyType: "weekly",
      intervalValue: 1,
      price: 75,
    },
  });
  if (created.status !== 201 || !created.json?.id) {
    console.error("Setup failed: could not create recurring plan", created.status, created.json);
    process.exit(1);
  }
  return created.json.id;
}

async function main() {
  console.log(`Estimate + recurring-plan access e2e against: ${BASE}\n`);

  // --- Provision two independent companies (A = victim, B = attacker) --------
  const companyA = await registerCompany("A");
  const companyB = await registerCompany("B");
  const staffA = await createStaff(companyA.ownerToken, "A");

  const customerA = await createCustomer(companyA.ownerToken, "A");
  const estimateA = await createEstimate(companyA.ownerToken, customerA, "A");
  const planA = await createRecurringPlan(companyA.ownerToken, customerA, "A");

  // Sanity: company A's owner can read their own estimate + recurring plan.
  {
    const r = await req("GET", `/estimates/${estimateA}`, { token: companyA.ownerToken });
    check("owner A can read own estimate", r.status === 200, `got ${r.status}`);
  }
  {
    const r = await req("GET", "/recurring-plans", { token: companyA.ownerToken });
    const ids = Array.isArray(r.json?.plans) ? r.json.plans.map((p) => p.id) : [];
    check(
      "owner A can list and see own recurring plan",
      r.status === 200 && ids.includes(planA),
      `status ${r.status}, ids ${JSON.stringify(ids)}`,
    );
  }

  // --- 1a. Tenant isolation: company B must NOT touch company A's estimate ---
  console.log("\nTenant isolation — company B must get 404 on company A's estimate:");
  const crossTenantEstimate = [
    { method: "GET", path: `/estimates/${estimateA}` },
    { method: "PUT", path: `/estimates/${estimateA}`, body: { notes: "hijacked" } },
    { method: "DELETE", path: `/estimates/${estimateA}` },
  ];
  for (const { method, path, body } of crossTenantEstimate) {
    const r = await req(method, path, { token: companyB.ownerToken, body });
    check(`${method} ${path} -> 404 for foreign company B`, r.status === 404, `got ${r.status}`);
  }
  {
    const r = await req("GET", "/estimates", { token: companyB.ownerToken });
    const ids = Array.isArray(r.json?.estimates) ? r.json.estimates.map((e) => e.id) : [];
    check(
      "GET /estimates for company B excludes company A's estimate",
      r.status === 200 && !ids.includes(estimateA),
      `status ${r.status}, ids ${JSON.stringify(ids)}`,
    );
  }

  // --- 1b. Tenant isolation: company B must NOT touch company A's plan -------
  console.log("\nTenant isolation — company B must get 404 on company A's recurring plan:");
  const crossTenantPlan = [
    { method: "PUT", path: `/recurring-plans/${planA}`, body: { isActive: false } },
    { method: "DELETE", path: `/recurring-plans/${planA}` },
  ];
  for (const { method, path, body } of crossTenantPlan) {
    const r = await req(method, path, { token: companyB.ownerToken, body });
    check(`${method} ${path} -> 404 for foreign company B`, r.status === 404, `got ${r.status}`);
  }
  {
    const r = await req("GET", "/recurring-plans", { token: companyB.ownerToken });
    const ids = Array.isArray(r.json?.plans) ? r.json.plans.map((p) => p.id) : [];
    check(
      "GET /recurring-plans for company B excludes company A's plan",
      r.status === 200 && !ids.includes(planA),
      `status ${r.status}, ids ${JSON.stringify(ids)}`,
    );
  }

  // --- 2a. Staff retain full access on estimates (not role-gated) ------------
  console.log("\nStaff access — estimates are a shared surface staff may fully use:");
  {
    const r = await req("GET", "/estimates", { token: staffA.token });
    const ids = Array.isArray(r.json?.estimates) ? r.json.estimates.map((e) => e.id) : [];
    check(
      "staff can list estimates in their own company",
      r.status === 200 && ids.includes(estimateA),
      `status ${r.status}, ids ${JSON.stringify(ids)}`,
    );
  }
  {
    const r = await req("GET", `/estimates/${estimateA}`, { token: staffA.token });
    check("staff can read an estimate in their own company", r.status === 200, `got ${r.status}`);
  }
  let staffCreatedEstimate = null;
  {
    const r = await req("POST", "/estimates", {
      token: staffA.token,
      body: {
        customerId: customerA,
        notes: "ByStaff",
        lineItems: [{ description: "Edging", quantity: 1, unitPrice: 25 }],
      },
    });
    staffCreatedEstimate = r.json?.id ?? null;
    check("staff can create an estimate", r.status === 201 && !!staffCreatedEstimate, `got ${r.status}`);
  }
  {
    const r = await req("PUT", `/estimates/${estimateA}`, {
      token: staffA.token,
      body: { notes: "touched by staff" },
    });
    check("staff can update an estimate in their own company", r.status === 200, `got ${r.status}`);
  }

  // --- 2b. Recurring plans are manager-only — staff must stay locked out -----
  console.log("\nStaff access — recurring plans are manager-only, staff must get 403:");
  const staffPlanAttempts = [
    { method: "GET", path: "/recurring-plans" },
    { method: "POST", path: "/recurring-plans", body: { customerId: customerA, frequencyType: "weekly" } },
    { method: "PUT", path: `/recurring-plans/${planA}`, body: { isActive: false } },
    { method: "DELETE", path: `/recurring-plans/${planA}` },
  ];
  for (const { method, path, body } of staffPlanAttempts) {
    const r = await req(method, path, { token: staffA.token, body });
    check(`staff ${method} ${path} -> 403 (manager-only)`, r.status === 403, `got ${r.status}`);
  }
  // And the owner keeps full access to recurring plans.
  {
    const r = await req("PUT", `/recurring-plans/${planA}`, {
      token: companyA.ownerToken,
      body: { price: 80 },
    });
    check("owner can update a recurring plan in their own company", r.status === 200, `got ${r.status}`);
  }

  // --- Summary --------------------------------------------------------------
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
