#!/usr/bin/env node
/**
 * End-to-end verification of customer portal authentication + data isolation.
 *
 * This is a black-box test: it talks to a RUNNING api-server over HTTP and
 * self-provisions companies + customers so the run is repeatable and independent
 * of existing data. The customer portal is a separate auth surface (its own JWT
 * secret + requirePortalAuth middleware) and it is NOT covered by the staff/role
 * lead-access suites. This locks down:
 *
 *   1. Portal session boundaries — a portal token only ever reads its OWN
 *      customer's data; another customer's invoice is invisible (404) and not
 *      payable, even within the same company.
 *   2. Cross-company isolation — a portal token scoped to company A cannot reach
 *      company B's invoices.
 *   3. Auth-domain separation — a business (staff/owner) JWT is rejected on
 *      portal routes, and a portal JWT is rejected on business routes; both
 *      surfaces 401 rather than honoring the wrong token.
 *   4. Credential checks — login fails on a wrong password and unauthenticated
 *      portal requests are rejected.
 *
 * Usage:
 *   API_BASE="https://<host>/api" node tests/portal-auth.e2e.mjs
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
  const ownerEmail = `${nsPrefix}portal_${label}_owner_${stamp}@example.com`;
  const reg = await req("POST", "/auth/register", {
    body: {
      firstName: "Olive",
      lastName: "Owner",
      email: ownerEmail,
      password: PASSWORD,
      companyName: `Portal Test ${label} ${stamp}`,
      selectedPlan: "pro",
    },
  });
  if (reg.status !== 201 || !reg.json?.token) {
    console.error(`Setup failed: could not register company ${label}`, reg.status, reg.json);
    process.exit(1);
  }
  return { ownerToken: reg.json.token };
}

async function createCustomer(ownerToken, label, idx) {
  const email = `portal_cust_${label}${idx}_${stamp}@example.com`;
  const created = await req("POST", "/customers", {
    token: ownerToken,
    body: { firstName: "Cara", lastName: `Customer${idx}`, email, phone: `555${stamp}${label}${idx}`.slice(0, 15) },
  });
  if (created.status !== 201 || !created.json?.id) {
    console.error(`Setup failed: could not create customer ${label}${idx}`, created.status, created.json);
    process.exit(1);
  }
  return { id: created.json.id, email };
}

// Provision a portal password for a customer via the business "send-invite"
// flow (which returns the invite URL containing the single-use token + slug),
// then set the password — yielding a portal session token.
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

async function createInvoice(ownerToken, customerId) {
  const created = await req("POST", "/invoices", {
    token: ownerToken,
    body: {
      customerId,
      status: "sent",
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
  console.log(`Portal auth e2e against: ${BASE}\n`);

  // --- Provision company A with two portal customers ------------------------
  const companyA = await registerCompany("A");
  const custA1 = await createCustomer(companyA.ownerToken, "A", 1);
  const custA2 = await createCustomer(companyA.ownerToken, "A", 2);
  const portalA1 = await provisionPortalCustomer(companyA.ownerToken, custA1.id);
  await provisionPortalCustomer(companyA.ownerToken, custA2.id);
  const invoiceA1 = await createInvoice(companyA.ownerToken, custA1.id);
  const invoiceA2 = await createInvoice(companyA.ownerToken, custA2.id);

  // --- Provision an independent company B with one portal customer ----------
  const companyB = await registerCompany("B");
  const custB1 = await createCustomer(companyB.ownerToken, "B", 1);
  const portalB1 = await provisionPortalCustomer(companyB.ownerToken, custB1.id);

  // --- Login flow + credential checks ---------------------------------------
  console.log("Portal login credential checks:");
  {
    const ok = await req("POST", "/portal/auth/login", {
      body: { identifier: custA1.email, password: PORTAL_PASSWORD, companySlug: portalA1.slug },
    });
    check("portal login with correct password -> 200 + token", ok.status === 200 && !!ok.json?.token, `got ${ok.status}`);
  }
  {
    const bad = await req("POST", "/portal/auth/login", {
      body: { identifier: custA1.email, password: "WrongPass999!", companySlug: portalA1.slug },
    });
    check("portal login with wrong password -> 401", bad.status === 401, `got ${bad.status}`);
  }

  // --- Authenticated portal customer can read OWN data ----------------------
  console.log("\nPortal customer A1 can read own data:");
  {
    const me = await req("GET", "/portal/auth/me", { token: portalA1.portalToken });
    check("GET /portal/auth/me -> 200 for own portal token", me.status === 200 && me.json?.customer?.id === custA1.id, `got ${me.status}, id ${me.json?.customer?.id}`);
  }
  {
    const list = await req("GET", "/portal/invoices", { token: portalA1.portalToken });
    const ids = Array.isArray(list.json) ? list.json.map((i) => i.id) : [];
    check(
      "GET /portal/invoices returns A1's invoice and not A2's",
      list.status === 200 && ids.includes(invoiceA1) && !ids.includes(invoiceA2),
      `status ${list.status}, ids ${JSON.stringify(ids)}`,
    );
  }
  {
    const own = await req("GET", `/portal/invoices/${invoiceA1}`, { token: portalA1.portalToken });
    check("GET /portal/invoices/:ownId -> 200", own.status === 200 && own.json?.id === invoiceA1, `got ${own.status}`);
  }

  // --- Portal customer CANNOT reach another customer's invoice --------------
  console.log("\nPortal customer A1 must NOT reach customer A2's invoice (same company):");
  {
    const r = await req("GET", `/portal/invoices/${invoiceA2}`, { token: portalA1.portalToken });
    check("GET /portal/invoices/:foreignCustomerId -> 404", r.status === 404, `got ${r.status}`);
  }
  {
    const r = await req("POST", `/portal/invoices/${invoiceA2}/pay`, { token: portalA1.portalToken });
    check("POST /portal/invoices/:foreignCustomerId/pay -> 404", r.status === 404, `got ${r.status}`);
  }

  // --- Cross-company isolation ----------------------------------------------
  console.log("\nCross-company — company B's portal token must NOT reach company A's invoice:");
  {
    const r = await req("GET", `/portal/invoices/${invoiceA1}`, { token: portalB1.portalToken });
    check("GET /portal/invoices/:companyAId -> 404 for company B portal token", r.status === 404, `got ${r.status}`);
  }

  // --- Auth-domain separation -----------------------------------------------
  console.log("\nAuth-domain separation — business and portal tokens are not interchangeable:");
  {
    // A business (owner) JWT must be rejected on portal routes.
    const r = await req("GET", "/portal/auth/me", { token: companyA.ownerToken });
    check("business owner JWT -> 401 on /portal/auth/me", r.status === 401, `got ${r.status}`);
  }
  {
    // A portal JWT must be rejected on business routes.
    const r = await req("GET", "/invoices", { token: portalA1.portalToken });
    check("portal JWT -> 401 on business /invoices", r.status === 401, `got ${r.status}`);
  }
  {
    // Unauthenticated portal request is rejected.
    const r = await req("GET", "/portal/invoices");
    check("unauthenticated GET /portal/invoices -> 401", r.status === 401, `got ${r.status}`);
  }

  // --- Summary --------------------------------------------------------------
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
