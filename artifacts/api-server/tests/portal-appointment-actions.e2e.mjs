#!/usr/bin/env node
/**
 * End-to-end verification of tenant/customer isolation on the customer
 * portal's WRITE endpoints (booking and cancellation):
 *
 *   POST /portal/appointments             — book a new visit request
 *   POST /portal/appointments/:id/cancel  — cancel a pending/confirmed visit
 *
 * Access rules locked down:
 *   1. Booking with a service from ANOTHER company -> 404 (tenant isolation).
 *   2. Booking with own company's service -> 201, origin "portal_request".
 *   3. Cancel own portal_request visit -> 200 (status becomes "cancelled").
 *   4. Cancel another customer's visit (same company) -> 404.
 *   5. Cancel another company's visit -> 404.
 *   6. Cancel a COMPANY-scheduled visit (origin "company") -> 403, and the
 *      visit remains untouched.
 *   7. No portal token -> 401 for both endpoints.
 *
 * Black-box: talks to a RUNNING api-server over HTTP and self-provisions
 * companies + portal customers, so the run is repeatable.
 *
 * Usage:
 *   API_BASE="https://<host>/api" node tests/portal-appointment-actions.e2e.mjs
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
  const ownerEmail = `${nsPrefix}pact_${label}_owner_${stamp}@example.com`;
  const reg = await req("POST", "/auth/register", {
    body: {
      firstName: "Olive",
      lastName: "Owner",
      email: ownerEmail,
      password: PASSWORD,
      companyName: `PortalAction Test ${label} ${stamp}`,
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
  const email = `pact_cust_${label}${idx}_${stamp}@example.com`;
  const created = await req("POST", "/customers", {
    token: ownerToken,
    body: { firstName: "Cara", lastName: `Customer${idx}`, email, phone: `558${stamp}${idx}`.slice(0, 15) },
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

async function createService(ownerToken, label) {
  const created = await req("POST", "/services", {
    token: ownerToken,
    body: { name: `Mowing ${label} ${stamp}`, basePrice: 45, isActive: true },
  });
  if (created.status !== 201 || !created.json?.id) {
    console.error(`Setup failed: could not create service ${label}`, created.status, created.json);
    process.exit(1);
  }
  return created.json.id;
}

async function createCompanyAppointment(ownerToken, customerId) {
  // Company-scheduled visit: created via the staff/owner API, so its origin
  // defaults to "company" (NOT "portal_request").
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

async function bookPortalAppointment(portalToken, serviceId) {
  const r = await req("POST", "/portal/appointments", {
    token: portalToken,
    body: {
      serviceId,
      scheduledStart: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      notes: `portal booking ${stamp}`,
    },
  });
  if (r.status !== 201 || !r.json?.id) {
    console.error("Setup failed: could not book portal appointment", r.status, r.json);
    process.exit(1);
  }
  return r.json;
}

async function main() {
  console.log(`Portal appointment write-action e2e against: ${BASE}\n`);

  // --- Provision: company A with two portal customers, company B with one ----
  const companyA = await registerCompany("A");
  const custA1 = await createCustomer(companyA.ownerToken, "A", 1);
  const custA2 = await createCustomer(companyA.ownerToken, "A", 2);
  const portalA1 = await provisionPortalCustomer(companyA.ownerToken, custA1.id);
  const portalA2 = await provisionPortalCustomer(companyA.ownerToken, custA2.id);

  const companyB = await registerCompany("B");
  const custB1 = await createCustomer(companyB.ownerToken, "B", 1);
  const portalB1 = await provisionPortalCustomer(companyB.ownerToken, custB1.id);

  const serviceA = await createService(companyA.ownerToken, "A");
  const serviceB = await createService(companyB.ownerToken, "B");

  // ==========================================================================
  // 1. POST /portal/appointments — booking isolation
  // ==========================================================================
  console.log("Booking — POST /portal/appointments:");
  {
    const r = await req("POST", "/portal/appointments", {
      token: portalA1.portalToken,
      body: { serviceId: serviceB, scheduledStart: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() },
    });
    check("booking with ANOTHER company's serviceId -> 404", r.status === 404, `got ${r.status} ${JSON.stringify(r.json)}`);
  }
  {
    const r = await req("POST", "/portal/appointments", {
      body: { serviceId: serviceA, scheduledStart: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() },
    });
    check("booking without token -> 401", r.status === 401, `got ${r.status}`);
  }
  const bookedA1 = await bookPortalAppointment(portalA1.portalToken, serviceA);
  check("booking with own company's service -> 201", Boolean(bookedA1.id), JSON.stringify(bookedA1));
  check(
    "booked visit carries origin 'portal_request'",
    bookedA1.origin === "portal_request",
    `origin=${bookedA1.origin}`,
  );

  // Additional portal_request visits for cross-customer / cross-company cancel checks.
  const bookedA2 = await bookPortalAppointment(portalA2.portalToken, serviceA);
  const bookedB1 = await bookPortalAppointment(portalB1.portalToken, serviceB);
  // Company-scheduled visit for customer A1 (origin "company").
  const companyApptA1 = await createCompanyAppointment(companyA.ownerToken, custA1.id);

  // ==========================================================================
  // 2. POST /portal/appointments/:id/cancel — cancellation isolation
  // ==========================================================================
  console.log("\nCancellation — POST /portal/appointments/:id/cancel:");
  {
    const r = await req("POST", `/portal/appointments/${bookedA2.id}/cancel`, { token: portalA1.portalToken });
    check("cancel ANOTHER customer's visit (same company) -> 404", r.status === 404, `got ${r.status}`);
  }
  {
    const r = await req("POST", `/portal/appointments/${bookedB1.id}/cancel`, { token: portalA1.portalToken });
    check("cancel ANOTHER company's visit -> 404", r.status === 404, `got ${r.status}`);
  }
  {
    const r = await req("POST", `/portal/appointments/${companyApptA1}/cancel`, { token: portalA1.portalToken });
    check("cancel a COMPANY-scheduled visit -> 403", r.status === 403, `got ${r.status} ${JSON.stringify(r.json)}`);
  }
  {
    // The company visit must be untouched after the rejected cancel.
    const r = await req("GET", "/portal/appointments", { token: portalA1.portalToken });
    const appt = Array.isArray(r.json) ? r.json.find((a) => a.id === companyApptA1) : null;
    check(
      "company-scheduled visit remains uncancelled",
      appt && appt.status !== "cancelled",
      `status=${appt?.status}`,
    );
  }
  {
    const r = await req("POST", `/portal/appointments/${bookedA1.id}/cancel`);
    check("cancel without token -> 401", r.status === 401, `got ${r.status}`);
  }
  {
    const r = await req("POST", `/portal/appointments/${bookedA1.id}/cancel`, { token: portalA1.portalToken });
    check("cancel OWN portal_request visit -> 200", r.status === 200, `got ${r.status} ${JSON.stringify(r.json)}`);
    check("cancelled visit status is 'cancelled'", r.json?.status === "cancelled", `status=${r.json?.status}`);
  }
  {
    // Cancelling twice must be rejected (status no longer pending/confirmed).
    const r = await req("POST", `/portal/appointments/${bookedA1.id}/cancel`, { token: portalA1.portalToken });
    check("cancel an already-cancelled visit -> 400", r.status === 400, `got ${r.status}`);
  }
  {
    // Cross-tenant/cross-customer cancels must not have mutated the victims.
    const rA2 = await req("GET", "/portal/appointments", { token: portalA2.portalToken });
    const apptA2 = Array.isArray(rA2.json) ? rA2.json.find((a) => a.id === bookedA2.id) : null;
    check("other customer's visit remains uncancelled", apptA2 && apptA2.status !== "cancelled", `status=${apptA2?.status}`);
    const rB1 = await req("GET", "/portal/appointments", { token: portalB1.portalToken });
    const apptB1 = Array.isArray(rB1.json) ? rB1.json.find((a) => a.id === bookedB1.id) : null;
    check("other company's visit remains uncancelled", apptB1 && apptB1.status !== "cancelled", `status=${apptB1?.status}`);
  }

  console.log(`\n${passes} passed, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Unexpected error in portal appointment actions suite:", err);
  process.exit(1);
});
