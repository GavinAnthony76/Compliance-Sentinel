#!/usr/bin/env node
/**
 * End-to-end verification of access control on the invoicing + billing surfaces.
 *
 * This is a black-box test: it talks to a RUNNING api-server over HTTP and
 * self-provisions two independent companies (each with an owner + staff) so the
 * run is repeatable and independent of existing data. It locks down three things
 * the lead-access suites do NOT cover:
 *
 *   1. Tenant isolation on invoices — company B's manager must never be able to
 *      read, mutate, send, mark-paid, PDF, or autopay-charge company A's invoice
 *      (every cross-tenant attempt must 404, not silently act on another tenant).
 *   2. Role gating on invoice writes — staff are blocked (403) from reading and
 *      mutating invoices at the router level, before any row lookup runs.
 *   3. Role gating on billing actions — staff are blocked (403) from billing
 *      status/usage/subscribe/portal/connect, while managers retain access and
 *      the shared /billing/plans endpoint stays reachable for everyone.
 *
 * Usage:
 *   API_BASE="https://<host>/api" node tests/invoice-billing-access.e2e.mjs
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
    /* non-JSON response (e.g. a streamed PDF) is fine */
  }
  return { status: res.status, json };
}

async function registerCompany(label) {
  const nsPrefix = process.env.TEST_RUN_NS ? `${process.env.TEST_RUN_NS}_` : "";
  const ownerEmail = `${nsPrefix}inv_${label}_owner_${stamp}@example.com`;
  const reg = await req("POST", "/auth/register", {
    body: {
      firstName: "Olive",
      lastName: "Owner",
      email: ownerEmail,
      password: PASSWORD,
      companyName: `Invoice Test ${label} ${stamp}`,
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
  const email = `inv_${label}_staff_${stamp}@example.com`;
  const created = await req("POST", "/team", {
    token: ownerToken,
    body: { firstName: "Steve", lastName: "Staff", email, password: PASSWORD, role: "staff" },
  });
  if (created.status !== 201) {
    console.error(`Setup failed: could not create staff for ${label}`, created.status, created.json);
    process.exit(1);
  }
  const login = await req("POST", "/auth/login", { body: { email, password: PASSWORD } });
  if (login.status !== 200 || !login.json?.token) {
    console.error(`Setup failed: could not log in staff for ${label}`, login.status, login.json);
    process.exit(1);
  }
  return login.json.token;
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

async function createInvoice(ownerToken, customerId) {
  const created = await req("POST", "/invoices", {
    token: ownerToken,
    body: {
      customerId,
      status: "draft",
      lineItems: [{ description: "Lawn mowing", quantity: 1, unitPrice: 100 }],
    },
  });
  if (created.status !== 201 || !created.json?.id) {
    console.error("Setup failed: could not create invoice", created.status, created.json);
    process.exit(1);
  }
  return created.json.id;
}

async function main() {
  console.log(`Invoice + billing access e2e against: ${BASE}\n`);

  // --- Provision two independent companies (A = victim, B = attacker) --------
  const companyA = await registerCompany("A");
  const companyB = await registerCompany("B");
  const staffTokenA = await createStaff(companyA.ownerToken, "A");

  const customerA = await createCustomer(companyA.ownerToken, "A");
  const invoiceA = await createInvoice(companyA.ownerToken, customerA);

  // Sanity: company A's owner can read their own invoice.
  {
    const r = await req("GET", `/invoices/${invoiceA}`, { token: companyA.ownerToken });
    check("owner A can read own invoice", r.status === 200 && r.json?.id === invoiceA, `got ${r.status}`);
  }

  // --- 1. Tenant isolation: company B must NOT touch company A's invoice -----
  console.log("\nTenant isolation — company B must get 404 on company A's invoice:");
  const crossTenant = [
    { method: "GET", path: `/invoices/${invoiceA}` },
    { method: "PUT", path: `/invoices/${invoiceA}`, body: { notes: "hijacked" } },
    { method: "DELETE", path: `/invoices/${invoiceA}` },
    { method: "POST", path: `/invoices/${invoiceA}/send` },
    { method: "POST", path: `/invoices/${invoiceA}/mark-paid`, body: { paymentMethod: "cash" } },
    { method: "GET", path: `/invoices/${invoiceA}/pdf` },
    { method: "POST", path: `/autopay/invoices/${invoiceA}/charge` },
  ];
  for (const { method, path, body } of crossTenant) {
    const r = await req(method, path, { token: companyB.ownerToken, body });
    check(`${method} ${path} -> 404 for foreign company B`, r.status === 404, `got ${r.status}`);
  }
  {
    // Company B's invoice list must not leak company A's invoice.
    const r = await req("GET", "/invoices", { token: companyB.ownerToken });
    const ids = Array.isArray(r.json?.invoices) ? r.json.invoices.map((i) => i.id) : [];
    check(
      "GET /invoices for company B excludes company A's invoice",
      r.status === 200 && !ids.includes(invoiceA),
      `status ${r.status}, ids ${JSON.stringify(ids)}`,
    );
  }

  // --- 2. Role gating: staff blocked from invoice read + writes -------------
  console.log("\nRole gating — staff must get 403 on invoice endpoints:");
  const staffInvoice = [
    { method: "GET", path: "/invoices" },
    { method: "GET", path: `/invoices/${invoiceA}` },
    { method: "GET", path: `/invoices/${invoiceA}/pdf` },
    {
      method: "POST",
      path: "/invoices",
      body: { customerId: customerA, lineItems: [{ description: "x", quantity: 1, unitPrice: 1 }] },
    },
    { method: "PUT", path: `/invoices/${invoiceA}`, body: { notes: "staff edit" } },
    { method: "DELETE", path: `/invoices/${invoiceA}` },
    { method: "POST", path: `/invoices/${invoiceA}/send` },
    { method: "POST", path: `/invoices/${invoiceA}/mark-paid`, body: { paymentMethod: "cash" } },
  ];
  for (const { method, path, body } of staffInvoice) {
    const r = await req(method, path, { token: staffTokenA, body });
    check(`${method} ${path} -> 403 for staff`, r.status === 403, `got ${r.status}`);
  }

  // --- 3. Role gating: staff blocked from billing actions -------------------
  console.log("\nRole gating — staff must get 403 on billing endpoints:");
  const staffBilling = [
    { method: "GET", path: "/billing/usage" },
    { method: "GET", path: "/billing/status" },
    { method: "GET", path: "/billing/connect/status" },
    { method: "POST", path: "/billing/subscribe", body: { plan: "growth" } },
    { method: "POST", path: "/billing/portal" },
    { method: "POST", path: "/billing/connect/onboard" },
  ];
  for (const { method, path, body } of staffBilling) {
    const r = await req(method, path, { token: staffTokenA, body });
    check(`${method} ${path} -> 403 for staff`, r.status === 403, `got ${r.status}`);
  }
  {
    // Shared read endpoint — staff must NOT be locked out of plan listing.
    const r = await req("GET", "/billing/plans", { token: staffTokenA });
    check("GET /billing/plans -> not 403 for staff", r.status !== 403, `got ${r.status}`);
  }

  // --- 4. Managers retain billing read access -------------------------------
  console.log("\nManager (owner) must retain access to billing reads:");
  for (const path of ["/billing/usage", "/billing/status", "/billing/connect/status"]) {
    const r = await req("GET", path, { token: companyA.ownerToken });
    check(`GET ${path} -> not 403 for owner`, r.status !== 403, `got ${r.status}`);
  }

  // --- Summary --------------------------------------------------------------
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
