#!/usr/bin/env node
/**
 * End-to-end verification of access control on the remaining shared, tenant-scoped
 * surfaces that previously had NO automated access-control gate:
 *
 *   - automations        (manager-only, /automations)
 *   - review-requests    (staff-accessible, /review-requests)
 *   - reviews            (manager-only, /reviews)
 *   - communications     (staff-accessible, /communications)
 *   - routes             (manager-only, /routes)
 *   - appointment-photos (staff-accessible, /appointment-photos)
 *
 * This is a black-box test: it talks to a RUNNING api-server over HTTP and
 * self-provisions two independent companies (each with an owner + staff) so the
 * run is repeatable and independent of existing data. Each surface is shared and
 * tenant-scoped, so a regression could either leak another tenant's data or break
 * the access staff are supposed to have. This suite locks down both halves:
 *
 *   1. Tenant isolation — company B must never read, mutate, or delete company
 *      A's records (every cross-tenant attempt must 404, not silently act on
 *      another tenant), and B's list views must not leak A's rows.
 *   2. The intended staff access is preserved per the router's requireRole usage:
 *        - automations / reviews / routes ARE manager-only (owner/admin), so
 *          staff must stay locked out (403) while the owner retains access.
 *        - review-requests / communications / appointment-photos are NOT
 *          role-gated, so staff must keep full access within their own company.
 *
 * Usage:
 *   API_BASE="https://<host>/api" node tests/shared-screen-access.e2e.mjs
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
  const ownerEmail = `${nsPrefix}shared_${label}_owner_${stamp}@example.com`;
  const reg = await req("POST", "/auth/register", {
    body: {
      firstName: "Olive",
      lastName: "Owner",
      email: ownerEmail,
      password: PASSWORD,
      companyName: `Shared Test ${label} ${stamp}`,
      selectedPlan: "pro",
    },
  });
  if (reg.status !== 201 || !reg.json?.token) {
    console.error(`Setup failed: could not register company ${label}`, reg.status, reg.json);
    process.exit(1);
  }
  // Fetch the company so we have its slug for the public review endpoint.
  const settings = await req("GET", "/settings", { token: reg.json.token });
  if (settings.status !== 200 || !settings.json?.slug) {
    console.error(`Setup failed: could not read settings for company ${label}`, settings.status, settings.json);
    process.exit(1);
  }
  return { ownerToken: reg.json.token, slug: settings.json.slug };
}

async function createStaff(ownerToken, label) {
  const email = `shared_${label}_staff_${stamp}@example.com`;
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
    body: { firstName: "Cara", lastName: "Customer", phone: `556${stamp}`.slice(0, 12) + label },
  });
  if (created.status !== 201 || !created.json?.id) {
    console.error(`Setup failed: could not create customer for ${label}`, created.status, created.json);
    process.exit(1);
  }
  return created.json.id;
}

async function createAppointment(ownerToken, customerId) {
  const created = await req("POST", "/appointments", {
    token: ownerToken,
    body: {
      customerId,
      status: "confirmed",
      scheduledStart: new Date(Date.now() + 86_400_000).toISOString(),
    },
  });
  if (created.status !== 201 || !created.json?.id) {
    console.error("Setup failed: could not create appointment", created.status, created.json);
    process.exit(1);
  }
  return created.json.id;
}

async function createAutomation(ownerToken, label) {
  const created = await req("POST", "/automations", {
    token: ownerToken,
    body: {
      name: `Auto ${label} ${stamp}`,
      triggerType: "appointment_completed",
      actionType: "send_review_request",
    },
  });
  if (created.status !== 201 || !created.json?.id) {
    console.error("Setup failed: could not create automation", created.status, created.json);
    process.exit(1);
  }
  return created.json.id;
}

async function createReviewRequest(ownerToken, customerId) {
  const created = await req("POST", "/review-requests", {
    token: ownerToken,
    body: { customerId, channel: "email" },
  });
  if (created.status !== 201 || !created.json?.id) {
    console.error("Setup failed: could not create review request", created.status, created.json);
    process.exit(1);
  }
  return created.json.id;
}

async function seedReview(slug, ownerToken) {
  const submitted = await req("POST", `/public/reviews/${slug}`, {
    body: { reviewerName: `Reviewer ${stamp}`, rating: 5, comment: "Great service" },
  });
  if (submitted.status !== 201) {
    console.error("Setup failed: could not submit public review", submitted.status, submitted.json);
    process.exit(1);
  }
  // The public endpoint doesn't return the id; read it back from the owner's list.
  const list = await req("GET", "/reviews", { token: ownerToken });
  const id = Array.isArray(list.json?.reviews) ? list.json.reviews[0]?.id : null;
  if (list.status !== 200 || !id) {
    console.error("Setup failed: could not read seeded review id", list.status, list.json);
    process.exit(1);
  }
  return id;
}

async function createCommunication(ownerToken, customerId) {
  const created = await req("POST", "/communications", {
    token: ownerToken,
    body: { customerId, channel: "note", subject: `Note ${stamp}`, bodyPreview: "Called customer" },
  });
  if (created.status !== 201) {
    console.error("Setup failed: could not log communication", created.status, created.json);
    process.exit(1);
  }
  // Read it back to capture the event id for leak checks.
  const list = await req("GET", `/communications?customerId=${customerId}`, { token: ownerToken });
  const id = Array.isArray(list.json?.events) ? list.json.events[0]?.id : null;
  if (list.status !== 200 || !id) {
    console.error("Setup failed: could not read logged communication", list.status, list.json);
    process.exit(1);
  }
  return id;
}

async function createRoute(ownerToken, label) {
  const created = await req("POST", "/routes", {
    token: ownerToken,
    body: { name: `Route ${label} ${stamp}`, routeDate: new Date().toISOString() },
  });
  if (created.status !== 201 || !created.json?.id) {
    console.error("Setup failed: could not create route", created.status, created.json);
    process.exit(1);
  }
  return created.json.id;
}

async function createPhoto(ownerToken, appointmentId, label) {
  const created = await req("POST", "/appointment-photos", {
    token: ownerToken,
    body: { appointmentId, objectPath: `/objects/photo-${label}-${stamp}.jpg`, type: "before" },
  });
  if (created.status !== 201 || !created.json?.id) {
    console.error("Setup failed: could not create appointment photo", created.status, created.json);
    process.exit(1);
  }
  return created.json.id;
}

async function main() {
  console.log(`Shared-screen access e2e against: ${BASE}\n`);

  // --- Provision two independent companies (A = victim, B = attacker) --------
  const companyA = await registerCompany("A");
  const companyB = await registerCompany("B");
  const staffA = await createStaff(companyA.ownerToken, "A");

  const customerA = await createCustomer(companyA.ownerToken, "A");
  const appointmentA = await createAppointment(companyA.ownerToken, customerA);

  const automationA = await createAutomation(companyA.ownerToken, "A");
  const reviewRequestA = await createReviewRequest(companyA.ownerToken, customerA);
  const reviewA = await seedReview(companyA.slug, companyA.ownerToken);
  const communicationA = await createCommunication(companyA.ownerToken, customerA);
  const routeA = await createRoute(companyA.ownerToken, "A");
  const photoA = await createPhoto(companyA.ownerToken, appointmentA, "A");

  // ==========================================================================
  // 1. AUTOMATIONS — manager-only (owner/admin)
  // ==========================================================================
  console.log("\n=== Automations (manager-only) ===");
  {
    const r = await req("GET", "/automations", { token: companyA.ownerToken });
    const ids = Array.isArray(r.json?.automations) ? r.json.automations.map((a) => a.id) : [];
    check("owner A can list and see own automation", r.status === 200 && ids.includes(automationA), `status ${r.status}, ids ${JSON.stringify(ids)}`);
  }
  console.log("Tenant isolation — company B must get 404 on company A's automation:");
  for (const { method, path, body } of [
    { method: "PUT", path: `/automations/${automationA}`, body: { name: "hijacked" } },
    { method: "DELETE", path: `/automations/${automationA}` },
    { method: "POST", path: `/automations/${automationA}/toggle` },
    { method: "POST", path: `/automations/${automationA}/test` },
  ]) {
    const r = await req(method, path, { token: companyB.ownerToken, body });
    check(`${method} ${path} -> 404 for foreign company B`, r.status === 404, `got ${r.status}`);
  }
  {
    const r = await req("GET", "/automations", { token: companyB.ownerToken });
    const ids = Array.isArray(r.json?.automations) ? r.json.automations.map((a) => a.id) : [];
    check("GET /automations for company B excludes company A's automation", r.status === 200 && !ids.includes(automationA), `status ${r.status}, ids ${JSON.stringify(ids)}`);
  }
  console.log("Staff access — automations are manager-only, staff must get 403:");
  for (const { method, path, body } of [
    { method: "GET", path: "/automations" },
    { method: "POST", path: "/automations", body: { name: "x", triggerType: "appointment_completed", actionType: "send_review_request" } },
    { method: "PUT", path: `/automations/${automationA}`, body: { name: "x" } },
    { method: "DELETE", path: `/automations/${automationA}` },
  ]) {
    const r = await req(method, path, { token: staffA.token, body });
    check(`staff ${method} ${path} -> 403 (manager-only)`, r.status === 403, `got ${r.status}`);
  }

  // ==========================================================================
  // 2. REVIEW-REQUESTS — staff-accessible
  // ==========================================================================
  console.log("\n=== Review-requests (staff-accessible) ===");
  {
    const r = await req("GET", "/review-requests", { token: companyA.ownerToken });
    const ids = Array.isArray(r.json?.reviewRequests) ? r.json.reviewRequests.map((x) => x.id) : [];
    check("owner A can list and see own review request", r.status === 200 && ids.includes(reviewRequestA), `status ${r.status}, ids ${JSON.stringify(ids)}`);
  }
  console.log("Tenant isolation — company B must not see or write to company A's data:");
  {
    const r = await req("GET", "/review-requests", { token: companyB.ownerToken });
    const ids = Array.isArray(r.json?.reviewRequests) ? r.json.reviewRequests.map((x) => x.id) : [];
    check("GET /review-requests for company B excludes company A's request", r.status === 200 && !ids.includes(reviewRequestA), `status ${r.status}, ids ${JSON.stringify(ids)}`);
  }
  {
    // Company B trying to send a review request to company A's customer must 404.
    const r = await req("POST", "/review-requests", { token: companyB.ownerToken, body: { customerId: customerA, channel: "email" } });
    check("POST /review-requests with company A's customer -> 404 for company B", r.status === 404, `got ${r.status}`);
  }
  console.log("Staff access — review-requests are shared, staff may fully use them:");
  {
    const r = await req("GET", "/review-requests", { token: staffA.token });
    check("staff can list review requests in their own company", r.status === 200, `got ${r.status}`);
  }
  {
    const r = await req("POST", "/review-requests", { token: staffA.token, body: { customerId: customerA, channel: "email" } });
    check("staff can create a review request", r.status === 201, `got ${r.status}`);
  }

  // ==========================================================================
  // 3. REVIEWS — manager-only (owner/admin)
  // ==========================================================================
  console.log("\n=== Reviews (manager-only) ===");
  {
    const r = await req("GET", "/reviews", { token: companyA.ownerToken });
    const ids = Array.isArray(r.json?.reviews) ? r.json.reviews.map((x) => x.id) : [];
    check("owner A can list and see own review", r.status === 200 && ids.includes(reviewA), `status ${r.status}, ids ${JSON.stringify(ids)}`);
  }
  console.log("Tenant isolation — company B must get 404 on company A's review:");
  for (const { method, path, body } of [
    { method: "PUT", path: `/reviews/${reviewA}`, body: { status: "approved" } },
    { method: "DELETE", path: `/reviews/${reviewA}` },
  ]) {
    const r = await req(method, path, { token: companyB.ownerToken, body });
    check(`${method} ${path} -> 404 for foreign company B`, r.status === 404, `got ${r.status}`);
  }
  {
    const r = await req("GET", "/reviews", { token: companyB.ownerToken });
    const ids = Array.isArray(r.json?.reviews) ? r.json.reviews.map((x) => x.id) : [];
    check("GET /reviews for company B excludes company A's review", r.status === 200 && !ids.includes(reviewA), `status ${r.status}, ids ${JSON.stringify(ids)}`);
  }
  console.log("Staff access — reviews are manager-only, staff must get 403:");
  for (const { method, path, body } of [
    { method: "GET", path: "/reviews" },
    { method: "PUT", path: `/reviews/${reviewA}`, body: { status: "approved" } },
    { method: "DELETE", path: `/reviews/${reviewA}` },
  ]) {
    const r = await req(method, path, { token: staffA.token, body });
    check(`staff ${method} ${path} -> 403 (manager-only)`, r.status === 403, `got ${r.status}`);
  }
  {
    const r = await req("PUT", `/reviews/${reviewA}`, { token: companyA.ownerToken, body: { status: "approved" } });
    check("owner A can moderate own review", r.status === 200, `got ${r.status}`);
  }

  // ==========================================================================
  // 4. COMMUNICATIONS — staff-accessible
  // ==========================================================================
  console.log("\n=== Communications (staff-accessible) ===");
  {
    const r = await req("GET", `/communications?customerId=${customerA}`, { token: companyA.ownerToken });
    const ids = Array.isArray(r.json?.events) ? r.json.events.map((e) => e.id) : [];
    check("owner A can list and see own communication event", r.status === 200 && ids.includes(communicationA), `status ${r.status}, ids ${JSON.stringify(ids)}`);
  }
  console.log("Tenant isolation — company B must not see company A's communication events:");
  {
    const r = await req("GET", `/communications?customerId=${customerA}`, { token: companyB.ownerToken });
    const ids = Array.isArray(r.json?.events) ? r.json.events.map((e) => e.id) : [];
    check("GET /communications?customerId=<A's customer> excludes A's events for company B", r.status === 200 && !ids.includes(communicationA), `status ${r.status}, ids ${JSON.stringify(ids)}`);
  }
  {
    const r = await req("GET", "/communications", { token: companyB.ownerToken });
    const ids = Array.isArray(r.json?.events) ? r.json.events.map((e) => e.id) : [];
    check("GET /communications (unfiltered) excludes company A's events for company B", r.status === 200 && !ids.includes(communicationA), `status ${r.status}, ids ${JSON.stringify(ids)}`);
  }
  console.log("Staff access — communications are shared, staff may fully use them:");
  {
    const r = await req("GET", `/communications?customerId=${customerA}`, { token: staffA.token });
    check("staff can list communications in their own company", r.status === 200, `got ${r.status}`);
  }
  {
    const r = await req("POST", "/communications", { token: staffA.token, body: { customerId: customerA, channel: "note", bodyPreview: "by staff" } });
    check("staff can log a communication", r.status === 201, `got ${r.status}`);
  }

  // ==========================================================================
  // 5. ROUTES — manager-only (owner/admin)
  // ==========================================================================
  console.log("\n=== Routes (manager-only) ===");
  {
    const r = await req("GET", "/routes", { token: companyA.ownerToken });
    const ids = Array.isArray(r.json?.routes) ? r.json.routes.map((x) => x.id) : [];
    check("owner A can list and see own route", r.status === 200 && ids.includes(routeA), `status ${r.status}, ids ${JSON.stringify(ids)}`);
  }
  console.log("Tenant isolation — company B must get 404 on company A's route:");
  for (const { method, path, body } of [
    { method: "GET", path: `/routes/${routeA}` },
    { method: "PUT", path: `/routes/${routeA}`, body: { name: "hijacked" } },
    { method: "DELETE", path: `/routes/${routeA}` },
    { method: "POST", path: `/routes/${routeA}/stops`, body: { appointmentId: appointmentA, stopOrder: 1 } },
    { method: "POST", path: `/routes/${routeA}/optimize` },
  ]) {
    const r = await req(method, path, { token: companyB.ownerToken, body });
    check(`${method} ${path} -> 404 for foreign company B`, r.status === 404, `got ${r.status}`);
  }
  {
    const r = await req("GET", "/routes", { token: companyB.ownerToken });
    const ids = Array.isArray(r.json?.routes) ? r.json.routes.map((x) => x.id) : [];
    check("GET /routes for company B excludes company A's route", r.status === 200 && !ids.includes(routeA), `status ${r.status}, ids ${JSON.stringify(ids)}`);
  }
  console.log("Staff access — routes are manager-only, staff must get 403:");
  for (const { method, path, body } of [
    { method: "GET", path: "/routes" },
    { method: "POST", path: "/routes", body: { name: "x", routeDate: new Date().toISOString() } },
    { method: "GET", path: `/routes/${routeA}` },
    { method: "PUT", path: `/routes/${routeA}`, body: { name: "x" } },
    { method: "DELETE", path: `/routes/${routeA}` },
  ]) {
    const r = await req(method, path, { token: staffA.token, body });
    check(`staff ${method} ${path} -> 403 (manager-only)`, r.status === 403, `got ${r.status}`);
  }
  {
    const r = await req("PUT", `/routes/${routeA}`, { token: companyA.ownerToken, body: { name: "renamed by owner" } });
    check("owner A can update own route", r.status === 200, `got ${r.status}`);
  }

  // ==========================================================================
  // 6. APPOINTMENT-PHOTOS — staff-accessible
  // ==========================================================================
  console.log("\n=== Appointment-photos (staff-accessible) ===");
  {
    const r = await req("GET", `/appointment-photos?appointmentId=${appointmentA}`, { token: companyA.ownerToken });
    const ids = Array.isArray(r.json?.photos) ? r.json.photos.map((p) => p.id) : [];
    check("owner A can list and see own appointment photo", r.status === 200 && ids.includes(photoA), `status ${r.status}, ids ${JSON.stringify(ids)}`);
  }
  console.log("Tenant isolation — company B must get 404 on company A's appointment + photo:");
  {
    const r = await req("GET", `/appointment-photos?appointmentId=${appointmentA}`, { token: companyB.ownerToken });
    check("GET /appointment-photos for company A's appointment -> 404 for company B", r.status === 404, `got ${r.status}`);
  }
  {
    const r = await req("POST", "/appointment-photos", { token: companyB.ownerToken, body: { appointmentId: appointmentA, objectPath: "/objects/hijack.jpg", type: "before" } });
    check("POST /appointment-photos on company A's appointment -> 404 for company B", r.status === 404, `got ${r.status}`);
  }
  {
    const r = await req("DELETE", `/appointment-photos/${photoA}`, { token: companyB.ownerToken });
    check("DELETE /appointment-photos/<A's photo> -> 404 for company B", r.status === 404, `got ${r.status}`);
  }
  console.log("Staff access — appointment photos are shared, staff may fully use them:");
  {
    const r = await req("GET", `/appointment-photos?appointmentId=${appointmentA}`, { token: staffA.token });
    check("staff can list appointment photos in their own company", r.status === 200, `got ${r.status}`);
  }
  let staffPhotoId = null;
  {
    const r = await req("POST", "/appointment-photos", { token: staffA.token, body: { appointmentId: appointmentA, objectPath: `/objects/by-staff-${stamp}.jpg`, type: "after" } });
    staffPhotoId = r.json?.id ?? null;
    check("staff can record an appointment photo", r.status === 201 && !!staffPhotoId, `got ${r.status}`);
  }

  // --- Summary --------------------------------------------------------------
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
