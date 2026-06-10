#!/usr/bin/env node
/**
 * End-to-end verification of access control on the properties + services
 * surfaces.
 *
 * This is a black-box test: it talks to a RUNNING api-server over HTTP and
 * self-provisions two independent companies (each with an owner + staff) so the
 * run is repeatable and independent of existing data. Properties and services
 * are shared, tenant-scoped endpoints (reachable by staff), so a regression
 * could either leak another tenant's data or block staff who should have
 * access. This suite locks down both halves:
 *
 *   1. Tenant isolation — company B must never read, mutate, or delete company
 *      A's property or service (every cross-tenant attempt must 404, not
 *      silently act on another tenant), and B's list views must not leak A's
 *      rows.
 *   2. Staff access is preserved — staff are SUPPOSED to use these shared
 *      endpoints. Properties and services are intentionally not role-gated, so
 *      staff must keep full access (list, read, create, update) within their own
 *      company.
 *
 * Usage:
 *   API_BASE="https://<host>/api" node tests/property-service-access.e2e.mjs
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
  const ownerEmail = `propsvc_${label}_owner_${stamp}@example.com`;
  const reg = await req("POST", "/auth/register", {
    body: {
      firstName: "Olive",
      lastName: "Owner",
      email: ownerEmail,
      password: PASSWORD,
      companyName: `PropSvc Test ${label} ${stamp}`,
      selectedPlan: "pro",
    },
  });
  if (reg.status !== 201 || !reg.json?.token) {
    console.error(`Setup failed: could not register company ${label}`, reg.status, reg.json);
    process.exit(1);
  }
  return { ownerToken: reg.json.token };
}

async function createStaff(ownerToken, label) {
  const email = `propsvc_${label}_staff_${stamp}@example.com`;
  const created = await req("POST", "/team", {
    token: ownerToken,
    body: { firstName: "Steve", lastName: "Staff", email, password: PASSWORD, role: "staff" },
  });
  if (created.status !== 201 || !created.json?.id) {
    console.error(`Setup failed: could not create staff for ${label}`, created.status, created.json);
    process.exit(1);
  }
  const login = await req("POST", "/auth/login", { body: { email, password: PASSWORD } });
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

async function createProperty(ownerToken, customerId, label) {
  const created = await req("POST", "/properties", {
    token: ownerToken,
    body: {
      customerId,
      propertyName: `Yard ${label}`,
      addressLine1: `${stamp} Maple St`,
      city: "Greenville",
      state: "CA",
      zip: "90210",
    },
  });
  if (created.status !== 201 || !created.json?.id) {
    console.error("Setup failed: could not create property", created.status, created.json);
    process.exit(1);
  }
  return created.json.id;
}

async function createService(ownerToken, label) {
  const created = await req("POST", "/services", {
    token: ownerToken,
    body: {
      name: `Mowing ${label} ${stamp}`,
      description: "Weekly lawn mowing",
      durationMinutes: 60,
      basePrice: 49.99,
    },
  });
  if (created.status !== 201 || !created.json?.id) {
    console.error("Setup failed: could not create service", created.status, created.json);
    process.exit(1);
  }
  return created.json.id;
}

async function main() {
  console.log(`Property + service access e2e against: ${BASE}\n`);

  // --- Provision two independent companies (A = victim, B = attacker) --------
  const companyA = await registerCompany("A");
  const companyB = await registerCompany("B");
  const staffA = await createStaff(companyA.ownerToken, "A");

  const customerA = await createCustomer(companyA.ownerToken, "A");
  const propertyA = await createProperty(companyA.ownerToken, customerA, "A");
  const serviceA = await createService(companyA.ownerToken, "A");

  // Sanity: company A's owner can read their own property + service.
  {
    const r = await req("GET", `/properties/${propertyA}`, { token: companyA.ownerToken });
    check("owner A can read own property", r.status === 200, `got ${r.status}`);
  }
  {
    const r = await req("GET", "/services", { token: companyA.ownerToken });
    const ids = Array.isArray(r.json?.services) ? r.json.services.map((s) => s.id) : [];
    check(
      "owner A can list and see own service",
      r.status === 200 && ids.includes(serviceA),
      `status ${r.status}, ids ${JSON.stringify(ids)}`,
    );
  }

  // --- 1a. Tenant isolation: company B must NOT touch company A's property ---
  console.log("\nTenant isolation — company B must get 404 on company A's property:");
  const crossTenantProperty = [
    { method: "GET", path: `/properties/${propertyA}` },
    { method: "PUT", path: `/properties/${propertyA}`, body: { propertyNotes: "hijacked" } },
    { method: "DELETE", path: `/properties/${propertyA}` },
  ];
  for (const { method, path, body } of crossTenantProperty) {
    const r = await req(method, path, { token: companyB.ownerToken, body });
    check(`${method} ${path} -> 404 for foreign company B`, r.status === 404, `got ${r.status}`);
  }
  {
    const r = await req("GET", "/properties", { token: companyB.ownerToken });
    const ids = Array.isArray(r.json?.properties) ? r.json.properties.map((p) => p.id) : [];
    check(
      "GET /properties for company B excludes company A's property",
      r.status === 200 && !ids.includes(propertyA),
      `status ${r.status}, ids ${JSON.stringify(ids)}`,
    );
  }

  // --- 1b. Tenant isolation: company B must NOT touch company A's service ----
  console.log("\nTenant isolation — company B must get 404 on company A's service:");
  const crossTenantService = [
    { method: "PUT", path: `/services/${serviceA}`, body: { name: `hijacked ${stamp}` } },
    { method: "DELETE", path: `/services/${serviceA}` },
  ];
  for (const { method, path, body } of crossTenantService) {
    const r = await req(method, path, { token: companyB.ownerToken, body });
    check(`${method} ${path} -> 404 for foreign company B`, r.status === 404, `got ${r.status}`);
  }
  {
    const r = await req("GET", "/services", { token: companyB.ownerToken });
    const ids = Array.isArray(r.json?.services) ? r.json.services.map((s) => s.id) : [];
    check(
      "GET /services for company B excludes company A's service",
      r.status === 200 && !ids.includes(serviceA),
      `status ${r.status}, ids ${JSON.stringify(ids)}`,
    );
  }

  // --- 2a. Staff retain full access on properties (not role-gated) -----------
  console.log("\nStaff access — properties are a shared surface staff may fully use:");
  {
    const r = await req("GET", "/properties", { token: staffA.token });
    const ids = Array.isArray(r.json?.properties) ? r.json.properties.map((p) => p.id) : [];
    check(
      "staff can list properties in their own company",
      r.status === 200 && ids.includes(propertyA),
      `status ${r.status}, ids ${JSON.stringify(ids)}`,
    );
  }
  {
    const r = await req("GET", `/properties/${propertyA}`, { token: staffA.token });
    check("staff can read a property in their own company", r.status === 200, `got ${r.status}`);
  }
  let staffCreatedProperty = null;
  {
    const r = await req("POST", "/properties", {
      token: staffA.token,
      body: { customerId: customerA, propertyName: "ByStaff", addressLine1: `${stamp} Oak Ave` },
    });
    staffCreatedProperty = r.json?.id ?? null;
    check("staff can create a property", r.status === 201 && !!staffCreatedProperty, `got ${r.status}`);
  }
  {
    const r = await req("PUT", `/properties/${propertyA}`, {
      token: staffA.token,
      body: { propertyNotes: "touched by staff" },
    });
    check("staff can update a property in their own company", r.status === 200, `got ${r.status}`);
  }

  // --- 2b. Staff retain full access on services (not role-gated) -------------
  console.log("\nStaff access — services are a shared surface staff may fully use:");
  {
    const r = await req("GET", "/services", { token: staffA.token });
    const ids = Array.isArray(r.json?.services) ? r.json.services.map((s) => s.id) : [];
    check(
      "staff can list services in their own company",
      r.status === 200 && ids.includes(serviceA),
      `status ${r.status}, ids ${JSON.stringify(ids)}`,
    );
  }
  let staffCreatedService = null;
  {
    const r = await req("POST", "/services", {
      token: staffA.token,
      body: { name: `Edging ByStaff ${stamp}`, basePrice: 19.99 },
    });
    staffCreatedService = r.json?.id ?? null;
    check("staff can create a service", r.status === 201 && !!staffCreatedService, `got ${r.status}`);
  }
  {
    const r = await req("PUT", `/services/${serviceA}`, {
      token: staffA.token,
      body: { description: "touched by staff" },
    });
    check("staff can update a service in their own company", r.status === 200, `got ${r.status}`);
  }

  // --- Summary --------------------------------------------------------------
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
