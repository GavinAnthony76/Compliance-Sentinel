#!/usr/bin/env node
/**
 * End-to-end verification that money-movement paths can't be triggered by the
 * wrong people or the wrong plan.
 *
 * This is a black-box test: it talks to a RUNNING api-server over HTTP and
 * self-provisions companies (each on a chosen plan) plus portal customers, so
 * the run is repeatable and independent of existing data. The invoice/billing
 * and portal-auth suites lock down tenant isolation and auth-domain separation;
 * this suite exercises the actual charging surfaces with fully provisioned
 * companies. It locks down:
 *
 *   1. Autopay feature gate — autopay routes (charge, toggle, setup-intent,
 *      save payment method, reminders) all return 403 for a Starter or Growth
 *      company, because autopay is a Pro-only feature enforced at the router
 *      level (before any row lookup). A Pro company clears the gate (it gets a
 *      business-logic response, never 403), proving the block is the feature
 *      gate and not a blanket denial.
 *   2. Portal online-payment guards — a portal customer paying their OWN invoice
 *      is rejected with 403 when the company does not accept card payments, and
 *      again with 403 when card is accepted but the company has no connected
 *      Stripe account. Money never moves until both conditions hold.
 *   3. Portal cross-customer protection — a portal customer can never pay another
 *      customer's invoice (404), within the same company or across companies.
 *
 * Usage:
 *   API_BASE="https://<host>/api" node tests/payment-access.e2e.mjs
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

async function registerCompany(label, plan) {
  const ownerEmail = `pay_${label}_owner_${stamp}@example.com`;
  const reg = await req("POST", "/auth/register", {
    body: {
      firstName: "Olive",
      lastName: "Owner",
      email: ownerEmail,
      password: PASSWORD,
      companyName: `Pay Test ${label} ${stamp}`,
      selectedPlan: plan,
    },
  });
  if (reg.status !== 201 || !reg.json?.token) {
    console.error(`Setup failed: could not register company ${label} (${plan})`, reg.status, reg.json);
    process.exit(1);
  }
  return { ownerToken: reg.json.token };
}

async function createCustomer(ownerToken, label, idx) {
  const email = `pay_cust_${label}${idx}_${stamp}@example.com`;
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

// Provision a portal session for a customer via the business "send-invite" flow
// (which returns the invite URL containing the single-use token + slug), then
// set the password — yielding a portal session token.
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
  console.log(`Payment access e2e against: ${BASE}\n`);

  // ==========================================================================
  // 1. Autopay feature gate — Pro-only. Starter/Growth companies are blocked.
  // ==========================================================================
  console.log("Autopay feature gate — Starter/Growth companies must get 403:");

  // Build the full list of autopay write/read surfaces for a given company.
  const autopayRoutes = (customerId, invoiceId) => [
    { method: "GET", path: `/autopay/customers/${customerId}/setup-intent` },
    { method: "POST", path: `/autopay/customers/${customerId}/payment-method`, body: { paymentMethodId: "pm_fake" } },
    { method: "DELETE", path: `/autopay/customers/${customerId}/payment-method` },
    { method: "PATCH", path: `/autopay/customers/${customerId}/autopay`, body: { enabled: true } },
    { method: "POST", path: `/autopay/invoices/${invoiceId}/charge` },
    { method: "POST", path: `/autopay/invoices/send-reminders` },
  ];

  // --- Growth company: autopay is Pro-only, so every route is gated ----------
  {
    const growth = await registerCompany("growth", "growth");
    const cust = await createCustomer(growth.ownerToken, "growth", 1);
    const invoice = await createInvoice(growth.ownerToken, cust.id);
    for (const { method, path, body } of autopayRoutes(cust.id, invoice)) {
      const r = await req(method, path, { token: growth.ownerToken, body });
      check(`${method} ${path} -> 403 for Growth company`, r.status === 403, `got ${r.status} ${JSON.stringify(r.json)}`);
    }
  }

  // --- Starter company: same gate, spot-check the charge + toggle paths ------
  {
    const starter = await registerCompany("starter", "starter");
    const cust = await createCustomer(starter.ownerToken, "starter", 1);
    const invoice = await createInvoice(starter.ownerToken, cust.id);
    const spot = [
      { method: "POST", path: `/autopay/invoices/${invoice}/charge` },
      { method: "PATCH", path: `/autopay/customers/${cust.id}/autopay`, body: { enabled: true } },
    ];
    for (const { method, path, body } of spot) {
      const r = await req(method, path, { token: starter.ownerToken, body });
      check(`${method} ${path} -> 403 for Starter company`, r.status === 403, `got ${r.status} ${JSON.stringify(r.json)}`);
    }
  }

  // --- Pro company: clears the gate (gets business logic, never 403) ---------
  console.log("\nAutopay feature gate — Pro company must clear the gate (not 403):");
  let proCompany;
  {
    proCompany = await registerCompany("pro", "pro");
    const cust = await createCustomer(proCompany.ownerToken, "pro", 1);
    const invoice = await createInvoice(proCompany.ownerToken, cust.id);
    // No saved payment method -> the handler reaches its own 400 NoPaymentMethod,
    // which proves the Pro plan passed requireFeature("autopay").
    const r = await req("POST", `/autopay/invoices/${invoice}/charge`, { token: proCompany.ownerToken });
    check(
      "POST /autopay/invoices/:id/charge -> not 403 for Pro (gate cleared)",
      r.status !== 403,
      `got ${r.status} ${JSON.stringify(r.json)}`,
    );
    check(
      "POST /autopay/invoices/:id/charge -> 400 NoPaymentMethod for Pro w/o card",
      r.status === 400 && r.json?.error === "NoPaymentMethod",
      `got ${r.status} ${JSON.stringify(r.json)}`,
    );
  }

  // ==========================================================================
  // 2. Portal online-payment guards — card must be accepted AND a Stripe
  //    Connect account must be present before any charge can be initiated.
  // ==========================================================================
  console.log("\nPortal online-payment guards (Pro company, fully provisioned customers):");

  // Pro company A with two portal customers so we can also test cross-customer.
  const companyA = await registerCompany("portalA", "pro");
  const custA1 = await createCustomer(companyA.ownerToken, "portalA", 1);
  const custA2 = await createCustomer(companyA.ownerToken, "portalA", 2);
  const portalA1 = await provisionPortalCustomer(companyA.ownerToken, custA1.id);
  await provisionPortalCustomer(companyA.ownerToken, custA2.id);
  const invoiceA1 = await createInvoice(companyA.ownerToken, custA1.id);
  const invoiceA2 = await createInvoice(companyA.ownerToken, custA2.id);

  // --- Card payments NOT enabled (default accepted methods = cash/check) -----
  {
    const r = await req("POST", `/portal/invoices/${invoiceA1}/pay`, { token: portalA1.portalToken });
    check(
      "portal pay own invoice -> 403 when card payments not enabled",
      r.status === 403 && r.json?.error === "PaymentMethodNotEnabled",
      `got ${r.status} ${JSON.stringify(r.json)}`,
    );
  }

  // --- Enable card, but the company still has no connected Stripe account ----
  {
    const cfg = await req("PUT", "/settings/payment-config", {
      token: companyA.ownerToken,
      body: { acceptedPaymentMethods: ["cash", "check", "card"] },
    });
    if (cfg.status !== 200) {
      console.error("Setup failed: could not enable card payments", cfg.status, cfg.json);
      process.exit(1);
    }
    const r = await req("POST", `/portal/invoices/${invoiceA1}/pay`, { token: portalA1.portalToken });
    check(
      "portal pay own invoice -> 403 when no Stripe Connect account",
      r.status === 403 && r.json?.error === "ConnectRequired",
      `got ${r.status} ${JSON.stringify(r.json)}`,
    );
  }

  // ==========================================================================
  // 3. Portal cross-customer protection — never pay someone else's invoice.
  // ==========================================================================
  console.log("\nPortal cross-customer protection — paying another customer's invoice must 404:");

  // Same company: A1 must not pay A2's invoice (even with card now enabled).
  {
    const r = await req("POST", `/portal/invoices/${invoiceA2}/pay`, { token: portalA1.portalToken });
    check("portal pay another customer's invoice (same company) -> 404", r.status === 404, `got ${r.status}`);
  }

  // Cross company: company B's portal customer must not pay company A's invoice.
  {
    const companyB = await registerCompany("portalB", "pro");
    const custB1 = await createCustomer(companyB.ownerToken, "portalB", 1);
    const portalB1 = await provisionPortalCustomer(companyB.ownerToken, custB1.id);
    const r = await req("POST", `/portal/invoices/${invoiceA1}/pay`, { token: portalB1.portalToken });
    check("portal pay across companies -> 404", r.status === 404, `got ${r.status}`);
  }

  // --- Summary --------------------------------------------------------------
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
