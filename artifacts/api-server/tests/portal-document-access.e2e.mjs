#!/usr/bin/env node
/**
 * End-to-end verification of tenant/customer isolation on the remaining
 * customer-portal document/detail endpoints (the PDF downloads already have
 * their own suites — invoice-pdf-access / receipt-pdf-access):
 *
 *   GET /portal/invoices                 — list is scoped to own invoices only
 *   GET /portal/invoices/:id             — detail JSON (line items, payment config)
 *   GET /portal/estimates                — list is scoped to own estimates only
 *   GET /portal/appointments             — list is scoped to own appointments only
 *   GET /portal/appointments/:id/photos  — before/after photo metadata
 *   GET /portal/photos/:id/image         — photo binary serving
 *
 * Access rules locked down per endpoint:
 *   1. Own resource -> 200 with only the customer's own data.
 *   2. Another company's resource -> 404 (tenant isolation; existence hidden).
 *   3. Another customer's resource within the same company -> 404.
 *   4. No portal token -> 401.
 *   5. Photos: "general" (internal) photos are never listed and 403 on
 *      direct image fetch even for the owning customer.
 *
 * Black-box: talks to a RUNNING api-server over HTTP and self-provisions
 * companies + portal customers, so the run is repeatable.
 *
 * Usage:
 *   API_BASE="https://<host>/api" node tests/portal-document-access.e2e.mjs
 *
 * Exit code 0 = all checks passed, 1 = at least one check failed.
 */

const BASE =
  process.env.API_BASE ||
  (process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}/api`
    : "http://localhost:5000/api");

const PASSWORD = "TestPass123!";
const PORTAL_PASSWORD = "PortalPass123!";
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
  const ownerEmail = `${nsPrefix}pdoc_${label}_owner_${stamp}@example.com`;
  const reg = await req("POST", "/auth/register", {
    body: {
      firstName: "Olive",
      lastName: "Owner",
      email: ownerEmail,
      password: PASSWORD,
      companyName: `PortalDoc Test ${label} ${stamp}`,
      selectedPlan: "pro",
    },
  });
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

async function createCustomer(ownerToken, label, idx) {
  const email = `pdoc_cust_${label}${idx}_${stamp}@example.com`;
  const created = await req("POST", "/customers", {
    token: ownerToken,
    body: { firstName: "Cara", lastName: `Customer${idx}`, email, phone: `557${stamp}${idx}`.slice(0, 15) },
  });
  if (created.status !== 201 || !created.json?.id) {
    console.error(`Setup failed: could not create customer ${label}${idx}`, created.status, created.json);
    process.exit(1);
  }
  return { id: created.json.id, email };
}

async function provisionPortalCustomer(ownerToken, customerId) {
  const invite = await req("POST", "/portal/auth/send-invite", {
    token: ownerToken,
    body: { customerId },
  });
  if (invite.status !== 200 || !invite.json?.portalUrl) {
    console.error("Setup failed: could not send portal invite", invite.status, invite.json);
    process.exit(1);
  }
  const url = new URL(invite.json.portalUrl);
  const token = url.searchParams.get("token");
  const slug = url.searchParams.get("slug");
  if (!token || !slug) {
    console.error("Setup failed: invite URL missing token/slug", invite.json.portalUrl);
    process.exit(1);
  }
  const setPw = await req("POST", "/portal/auth/set-password", {
    body: { token, password: PORTAL_PASSWORD, companySlug: slug },
  });
  if (setPw.status !== 200 || !setPw.json?.token) {
    console.error("Setup failed: could not set portal password", setPw.status, setPw.json);
    process.exit(1);
  }
  return { portalToken: setPw.json.token, slug };
}

async function createInvoice(ownerToken, customerId, description) {
  const created = await req("POST", "/invoices", {
    token: ownerToken,
    body: {
      customerId,
      status: "sent",
      lineItems: [{ description, quantity: 1, unitPrice: 100 }],
    },
  });
  if (created.status !== 201 || !created.json?.id) {
    console.error("Setup failed: could not create invoice", created.status, created.json);
    process.exit(1);
  }
  return created.json.id;
}

async function createEstimate(ownerToken, customerId, label) {
  const created = await req("POST", "/estimates", {
    token: ownerToken,
    body: {
      customerId,
      notes: `Portal doc estimate ${label} ${stamp}`,
      lineItems: [{ description: "Hedge trimming", quantity: 1, unitPrice: 55 }],
    },
  });
  if (created.status !== 201 || !created.json?.id) {
    console.error("Setup failed: could not create estimate", created.status, created.json);
    process.exit(1);
  }
  return created.json.id;
}

async function createAppointment(ownerToken, customerId) {
  const created = await req("POST", "/appointments", {
    token: ownerToken,
    body: {
      customerId,
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

async function createPhoto(ownerToken, appointmentId, type) {
  const created = await req("POST", "/appointment-photos", {
    token: ownerToken,
    body: {
      appointmentId,
      objectPath: `/objects/uploads/pdoc-${type}-${appointmentId}-${stamp}.jpg`,
      type,
      originalFileName: `pdoc-${type}.jpg`,
      mimeType: "image/jpeg",
    },
  });
  if (created.status !== 201 || !created.json?.id) {
    console.error("Setup failed: could not create appointment photo", created.status, created.json);
    process.exit(1);
  }
  return created.json.id;
}

async function main() {
  console.log(`Portal document/detail access e2e against: ${BASE}\n`);

  // --- Provision: company A with two portal customers, company B with one ----
  const companyA = await registerCompany("A");
  const custA1 = await createCustomer(companyA.ownerToken, "A", 1);
  const custA2 = await createCustomer(companyA.ownerToken, "A", 2);
  const portalA1 = await provisionPortalCustomer(companyA.ownerToken, custA1.id);
  await provisionPortalCustomer(companyA.ownerToken, custA2.id);

  const companyB = await registerCompany("B");
  const custB1 = await createCustomer(companyB.ownerToken, "B", 1);
  const portalB1 = await provisionPortalCustomer(companyB.ownerToken, custB1.id);

  const invoiceA1 = await createInvoice(companyA.ownerToken, custA1.id, "Lawn mowing A1");
  const invoiceA2 = await createInvoice(companyA.ownerToken, custA2.id, "Lawn mowing A2");
  const estimateA1 = await createEstimate(companyA.ownerToken, custA1.id, "A1");
  const estimateA2 = await createEstimate(companyA.ownerToken, custA2.id, "A2");
  const apptA1 = await createAppointment(companyA.ownerToken, custA1.id);
  const apptA2 = await createAppointment(companyA.ownerToken, custA2.id);
  const photoBeforeA1 = await createPhoto(companyA.ownerToken, apptA1, "before");
  const photoGeneralA1 = await createPhoto(companyA.ownerToken, apptA1, "general");
  const photoBeforeA2 = await createPhoto(companyA.ownerToken, apptA2, "before");

  // ==========================================================================
  // 1. GET /portal/invoices/:id — full detail JSON
  // ==========================================================================
  console.log("Invoice detail JSON — GET /portal/invoices/:id:");
  {
    const r = await req("GET", `/portal/invoices/${invoiceA1}`, { token: portalA1.portalToken });
    check("own invoice detail -> 200", r.status === 200, `got ${r.status} ${JSON.stringify(r.json)}`);
    check(
      "detail includes own line items",
      Array.isArray(r.json?.lineItems) && r.json.lineItems.some((li) => li.description === "Lawn mowing A1"),
      JSON.stringify(r.json?.lineItems),
    );
  }
  {
    const r = await req("GET", `/portal/invoices/${invoiceA2}`, { token: portalA1.portalToken });
    check("another customer's invoice detail -> 404", r.status === 404, `got ${r.status}`);
  }
  {
    const r = await req("GET", `/portal/invoices/${invoiceA1}`, { token: portalB1.portalToken });
    check("another company's invoice detail -> 404", r.status === 404, `got ${r.status}`);
  }
  {
    const r = await req("GET", `/portal/invoices/${invoiceA1}`);
    check("invoice detail without token -> 401", r.status === 401, `got ${r.status}`);
  }

  // ==========================================================================
  // 2. GET /portal/invoices — list scoped to the logged-in customer
  // ==========================================================================
  console.log("\nInvoice list — GET /portal/invoices:");
  {
    const r = await req("GET", "/portal/invoices", { token: portalA1.portalToken });
    const ids = Array.isArray(r.json) ? r.json.map((i) => i.id) : [];
    check("list -> 200", r.status === 200, `got ${r.status}`);
    check("list includes own invoice", ids.includes(invoiceA1), JSON.stringify(ids));
    check("list excludes another customer's invoice", !ids.includes(invoiceA2), JSON.stringify(ids));
  }
  {
    const r = await req("GET", "/portal/invoices", { token: portalB1.portalToken });
    const ids = Array.isArray(r.json) ? r.json.map((i) => i.id) : [];
    check(
      "company B customer's list excludes company A invoices",
      !ids.includes(invoiceA1) && !ids.includes(invoiceA2),
      JSON.stringify(ids),
    );
  }
  {
    const r = await req("GET", "/portal/invoices");
    check("invoice list without token -> 401", r.status === 401, `got ${r.status}`);
  }

  // ==========================================================================
  // 3. GET /portal/estimates — list scoped to the logged-in customer
  // ==========================================================================
  console.log("\nEstimate list — GET /portal/estimates:");
  {
    const r = await req("GET", "/portal/estimates", { token: portalA1.portalToken });
    const ids = Array.isArray(r.json) ? r.json.map((e) => e.id) : [];
    check("list -> 200", r.status === 200, `got ${r.status}`);
    check("list includes own estimate", ids.includes(estimateA1), JSON.stringify(ids));
    check("list excludes another customer's estimate", !ids.includes(estimateA2), JSON.stringify(ids));
  }
  {
    const r = await req("GET", "/portal/estimates", { token: portalB1.portalToken });
    const ids = Array.isArray(r.json) ? r.json.map((e) => e.id) : [];
    check(
      "company B customer's list excludes company A estimates",
      !ids.includes(estimateA1) && !ids.includes(estimateA2),
      JSON.stringify(ids),
    );
  }
  {
    const r = await req("GET", "/portal/estimates");
    check("estimate list without token -> 401", r.status === 401, `got ${r.status}`);
  }

  // ==========================================================================
  // 4. GET /portal/appointments — list scoped to the logged-in customer
  // ==========================================================================
  console.log("\nAppointment list — GET /portal/appointments:");
  {
    const r = await req("GET", "/portal/appointments", { token: portalA1.portalToken });
    const ids = Array.isArray(r.json) ? r.json.map((a) => a.id) : [];
    check("list -> 200", r.status === 200, `got ${r.status}`);
    check("list includes own appointment", ids.includes(apptA1), JSON.stringify(ids));
    check("list excludes another customer's appointment", !ids.includes(apptA2), JSON.stringify(ids));
  }
  {
    const r = await req("GET", "/portal/appointments", { token: portalB1.portalToken });
    const ids = Array.isArray(r.json) ? r.json.map((a) => a.id) : [];
    check(
      "company B customer's list excludes company A appointments",
      !ids.includes(apptA1) && !ids.includes(apptA2),
      JSON.stringify(ids),
    );
  }
  {
    const r = await req("GET", "/portal/appointments");
    check("appointment list without token -> 401", r.status === 401, `got ${r.status}`);
  }

  // ==========================================================================
  // 5. GET /portal/appointments/:id/photos — photo metadata ownership
  // ==========================================================================
  console.log("\nAppointment photos — GET /portal/appointments/:id/photos:");
  {
    const r = await req("GET", `/portal/appointments/${apptA1}/photos`, { token: portalA1.portalToken });
    const photos = Array.isArray(r.json?.photos) ? r.json.photos : [];
    const ids = photos.map((p) => p.id);
    check("own appointment photos -> 200", r.status === 200, `got ${r.status} ${JSON.stringify(r.json)}`);
    check("own before photo is listed", ids.includes(photoBeforeA1), JSON.stringify(ids));
    check(
      "internal 'general' photo is NOT listed",
      !ids.includes(photoGeneralA1),
      JSON.stringify(photos),
    );
  }
  {
    const r = await req("GET", `/portal/appointments/${apptA2}/photos`, { token: portalA1.portalToken });
    check("another customer's appointment photos -> 404", r.status === 404, `got ${r.status}`);
  }
  {
    const r = await req("GET", `/portal/appointments/${apptA1}/photos`, { token: portalB1.portalToken });
    check("another company's appointment photos -> 404", r.status === 404, `got ${r.status}`);
  }
  {
    const r = await req("GET", `/portal/appointments/${apptA1}/photos`);
    check("appointment photos without token -> 401", r.status === 401, `got ${r.status}`);
  }

  // ==========================================================================
  // 6. GET /portal/photos/:id/image — photo binary ownership
  // ==========================================================================
  console.log("\nPhoto image — GET /portal/photos/:id/image:");
  {
    // The happy path may still fail at the storage layer in a test environment
    // (no real object uploaded), so we assert only that the ACCESS checks pass:
    // the owner must never be rejected with 401/403/404.
    const r = await req("GET", `/portal/photos/${photoBeforeA1}/image`, { token: portalA1.portalToken });
    check(
      "own before photo passes ownership checks (not 401/403/404)",
      ![401, 403, 404].includes(r.status),
      `got ${r.status} ${JSON.stringify(r.json)}`,
    );
  }
  {
    const r = await req("GET", `/portal/photos/${photoGeneralA1}/image`, { token: portalA1.portalToken });
    check("internal 'general' photo -> 403 even for the owner", r.status === 403, `got ${r.status}`);
  }
  {
    const r = await req("GET", `/portal/photos/${photoBeforeA2}/image`, { token: portalA1.portalToken });
    check("another customer's photo (same company) -> 404", r.status === 404, `got ${r.status}`);
  }
  {
    const r = await req("GET", `/portal/photos/${photoBeforeA1}/image`, { token: portalB1.portalToken });
    check("another company's photo -> 404", r.status === 404, `got ${r.status}`);
  }
  {
    const r = await req("GET", `/portal/photos/${photoBeforeA1}/image`);
    check("photo image without token -> 401", r.status === 401, `got ${r.status}`);
  }

  console.log(`\n${passes} passed, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Unexpected error in portal-document access suite:", err);
  process.exit(1);
});
