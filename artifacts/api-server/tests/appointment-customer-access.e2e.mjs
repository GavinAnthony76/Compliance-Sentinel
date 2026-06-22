#!/usr/bin/env node
/**
 * End-to-end verification of access control on the appointments + customers
 * surfaces.
 *
 * This is a black-box test: it talks to a RUNNING api-server over HTTP and
 * self-provisions two independent companies (each with an owner + staff) so the
 * run is repeatable and independent of existing data. Appointments and
 * customers are shared, tenant-scoped endpoints (reachable by staff), so a
 * regression could either leak another tenant's data or block staff who should
 * have access. This suite locks down both halves:
 *
 *   1. Tenant isolation — company B must never read, mutate, or delete company
 *      A's appointment or customer (every cross-tenant attempt must 404, not
 *      silently act on another tenant), and B's list views must not leak A's
 *      rows.
 *   2. Staff access is preserved — staff are SUPPOSED to use these shared
 *      endpoints:
 *        - Appointments: staff can list, and can read / update / complete the
 *          appointments ASSIGNED to them, while an appointment that is NOT
 *          assigned to them stays 403 (they keep exactly the scoped access they
 *          should have, no more, no less).
 *        - Customers: staff have full access (list, read, create, update) — the
 *          customer endpoints are intentionally not role-gated, so staff must
 *          not be locked out.
 *
 * Usage:
 *   API_BASE="https://<host>/api" node tests/appointment-customer-access.e2e.mjs
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
  const ownerEmail = `${nsPrefix}appt_${label}_owner_${stamp}@example.com`;
  const reg = await req("POST", "/auth/register", {
    body: {
      firstName: "Olive",
      lastName: "Owner",
      email: ownerEmail,
      password: PASSWORD,
      companyName: `Appt Test ${label} ${stamp}`,
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
  const email = `appt_${label}_staff_${stamp}@example.com`;
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
    body: { firstName: "Cara", lastName: "Customer", phone: `555${stamp}`.slice(0, 12) + label },
  });
  if (created.status !== 201 || !created.json?.id) {
    console.error(`Setup failed: could not create customer for ${label}`, created.status, created.json);
    process.exit(1);
  }
  return created.json.id;
}

async function createAppointment(ownerToken, customerId, assignedUserId) {
  const created = await req("POST", "/appointments", {
    token: ownerToken,
    body: {
      customerId,
      assignedUserId: assignedUserId ?? null,
      status: "pending",
      scheduledStart: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    },
  });
  if (created.status !== 201 || !created.json?.id) {
    console.error("Setup failed: could not create appointment", created.status, created.json);
    process.exit(1);
  }
  return created.json.id;
}

async function main() {
  console.log(`Appointment + customer access e2e against: ${BASE}\n`);

  // --- Provision two independent companies (A = victim, B = attacker) --------
  const companyA = await registerCompany("A");
  const companyB = await registerCompany("B");
  const staffA = await createStaff(companyA.ownerToken, "A");

  const customerA = await createCustomer(companyA.ownerToken, "A");
  // One appointment assigned to staff A, one left unassigned.
  const assignedApptA = await createAppointment(companyA.ownerToken, customerA, staffA.id);
  const unassignedApptA = await createAppointment(companyA.ownerToken, customerA, null);

  // Sanity: company A's owner can read their own appointment + customer.
  {
    const r = await req("GET", `/appointments/${assignedApptA}`, { token: companyA.ownerToken });
    check("owner A can read own appointment", r.status === 200, `got ${r.status}`);
  }
  {
    const r = await req("GET", `/customers/${customerA}`, { token: companyA.ownerToken });
    check("owner A can read own customer", r.status === 200, `got ${r.status}`);
  }

  // --- 1a. Tenant isolation: company B must NOT touch company A's appointment -
  console.log("\nTenant isolation — company B must get 404 on company A's appointment:");
  const crossTenantAppt = [
    { method: "GET", path: `/appointments/${assignedApptA}` },
    { method: "PUT", path: `/appointments/${assignedApptA}`, body: { notes: "hijacked" } },
    { method: "POST", path: `/appointments/${assignedApptA}/complete`, body: {} },
    { method: "DELETE", path: `/appointments/${assignedApptA}` },
  ];
  for (const { method, path, body } of crossTenantAppt) {
    const r = await req(method, path, { token: companyB.ownerToken, body });
    check(`${method} ${path} -> 404 for foreign company B`, r.status === 404, `got ${r.status}`);
  }
  {
    const r = await req("GET", "/appointments", { token: companyB.ownerToken });
    const ids = Array.isArray(r.json?.appointments) ? r.json.appointments.map((a) => a.id) : [];
    check(
      "GET /appointments for company B excludes company A's appointments",
      r.status === 200 && !ids.includes(assignedApptA) && !ids.includes(unassignedApptA),
      `status ${r.status}, ids ${JSON.stringify(ids)}`,
    );
  }

  // --- 1b. Tenant isolation: company B must NOT touch company A's customer ----
  console.log("\nTenant isolation — company B must get 404 on company A's customer:");
  const crossTenantCustomer = [
    { method: "GET", path: `/customers/${customerA}` },
    { method: "PUT", path: `/customers/${customerA}`, body: { notes: "hijacked" } },
    { method: "DELETE", path: `/customers/${customerA}` },
  ];
  for (const { method, path, body } of crossTenantCustomer) {
    const r = await req(method, path, { token: companyB.ownerToken, body });
    check(`${method} ${path} -> 404 for foreign company B`, r.status === 404, `got ${r.status}`);
  }
  {
    const r = await req("GET", "/customers", { token: companyB.ownerToken });
    const ids = Array.isArray(r.json?.customers) ? r.json.customers.map((c) => c.id) : [];
    check(
      "GET /customers for company B excludes company A's customer",
      r.status === 200 && !ids.includes(customerA),
      `status ${r.status}, ids ${JSON.stringify(ids)}`,
    );
  }

  // --- 2a. Staff keep the scoped access they should have on appointments -----
  console.log("\nStaff access — appointments are a shared, per-assignment scoped surface:");
  {
    const r = await req("GET", "/appointments", { token: staffA.token });
    const ids = Array.isArray(r.json?.appointments) ? r.json.appointments.map((a) => a.id) : [];
    check(
      "staff can list appointments and see their assigned one",
      r.status === 200 && ids.includes(assignedApptA),
      `status ${r.status}, ids ${JSON.stringify(ids)}`,
    );
    check(
      "staff list excludes appointments not assigned to them",
      r.status === 200 && !ids.includes(unassignedApptA),
      `status ${r.status}, ids ${JSON.stringify(ids)}`,
    );
  }
  {
    const r = await req("GET", `/appointments/${assignedApptA}`, { token: staffA.token });
    check("staff can read their assigned appointment", r.status === 200, `got ${r.status}`);
  }
  {
    const r = await req("PUT", `/appointments/${assignedApptA}`, {
      token: staffA.token,
      body: { status: "confirmed" },
    });
    check("staff can update status on their assigned appointment", r.status === 200, `got ${r.status}`);
  }
  {
    const r = await req("POST", `/appointments/${assignedApptA}/complete`, {
      token: staffA.token,
      body: { completionNotes: "done" },
    });
    check("staff can complete their assigned appointment", r.status === 200, `got ${r.status}`);
  }
  // Negative half: an appointment NOT assigned to them must stay 403.
  for (const { method, path, body } of [
    { method: "GET", path: `/appointments/${unassignedApptA}` },
    { method: "PUT", path: `/appointments/${unassignedApptA}`, body: { status: "confirmed" } },
    { method: "POST", path: `/appointments/${unassignedApptA}/complete`, body: {} },
  ]) {
    const r = await req(method, path, { token: staffA.token, body });
    check(`${method} ${path} -> 403 for unassigned staff`, r.status === 403, `got ${r.status}`);
  }

  // --- 2b. Staff retain full access on customers (not role-gated) ------------
  console.log("\nStaff access — customers are a shared surface staff may fully use:");
  {
    const r = await req("GET", "/customers", { token: staffA.token });
    const ids = Array.isArray(r.json?.customers) ? r.json.customers.map((c) => c.id) : [];
    check(
      "staff can list customers in their own company",
      r.status === 200 && ids.includes(customerA),
      `status ${r.status}, ids ${JSON.stringify(ids)}`,
    );
  }
  {
    const r = await req("GET", `/customers/${customerA}`, { token: staffA.token });
    check("staff can read a customer in their own company", r.status === 200, `got ${r.status}`);
  }
  let staffCreatedCustomer = null;
  {
    const r = await req("POST", "/customers", {
      token: staffA.token,
      body: { firstName: "New", lastName: "ByStaff", phone: `556${stamp}`.slice(0, 12) },
    });
    staffCreatedCustomer = r.json?.id ?? null;
    check("staff can create a customer", r.status === 201 && !!staffCreatedCustomer, `got ${r.status}`);
  }
  {
    const r = await req("PUT", `/customers/${customerA}`, {
      token: staffA.token,
      body: { notes: "touched by staff" },
    });
    check("staff can update a customer in their own company", r.status === 200, `got ${r.status}`);
  }

  // --- Summary --------------------------------------------------------------
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
