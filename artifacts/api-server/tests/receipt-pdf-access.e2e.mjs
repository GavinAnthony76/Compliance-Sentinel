#!/usr/bin/env node
/**
 * End-to-end verification of the portal paid-invoice receipt download:
 * GET /portal/invoices/:id/receipt-pdf
 *
 * This is a black-box test: it talks to a RUNNING api-server over HTTP and
 * self-provisions companies + portal customers, so the run is repeatable and
 * independent of existing data. It locks down the endpoint's access rules:
 *
 *   1. Paid invoice, own customer  -> 200 with a real PDF payload
 *      (application/pdf content type, %PDF magic bytes, receipt filename).
 *   2. Unpaid invoice, own customer -> 400 NotPaid (no receipt before payment).
 *   3. Another company's invoice    -> 404 (tenant isolation; existence is not
 *      even revealed).
 *   4. Another customer's invoice within the same company -> 404.
 *   5. No portal token -> 401 (auth required at all).
 *
 * Usage:
 *   API_BASE="https://<host>/api" node tests/receipt-pdf-access.e2e.mjs
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

// Raw request that keeps the binary body so we can inspect PDF bytes/headers.
async function reqRaw(method, path, { token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers });
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    status: res.status,
    contentType: res.headers.get("content-type") || "",
    disposition: res.headers.get("content-disposition") || "",
    body: buf,
  };
}

async function registerCompany(label) {
  const nsPrefix = process.env.TEST_RUN_NS ? `${process.env.TEST_RUN_NS}_` : "";
  const ownerEmail = `${nsPrefix}rcpt_${label}_owner_${stamp}@example.com`;
  const reg = await req("POST", "/auth/register", {
    body: {
      firstName: "Olive",
      lastName: "Owner",
      email: ownerEmail,
      password: PASSWORD,
      companyName: `Receipt Test ${label} ${stamp}`,
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

async function createCustomer(ownerToken, label, idx) {
  const email = `rcpt_cust_${label}${idx}_${stamp}@example.com`;
  const created = await req("POST", "/customers", {
    token: ownerToken,
    body: { firstName: "Cara", lastName: `Customer${idx}`, email, phone: `555${stamp}${idx}`.slice(0, 15) },
  });
  if (created.status !== 201 || !created.json?.id) {
    console.error(`Setup failed: could not create customer ${label}${idx}`, created.status, created.json);
    process.exit(1);
  }
  return { id: created.json.id, email };
}

// Provision a portal session for a customer via the business "send-invite" flow.
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

async function markInvoicePaid(ownerToken, invoiceId) {
  const r = await req("POST", `/invoices/${invoiceId}/mark-paid`, {
    token: ownerToken,
    body: { paymentMethod: "cash" },
  });
  if (r.status !== 200 || r.json?.status !== "paid") {
    console.error("Setup failed: could not mark invoice paid", r.status, r.json);
    process.exit(1);
  }
}

async function main() {
  console.log(`Receipt-PDF access e2e against: ${BASE}\n`);

  // --- Provision: company A with two portal customers, company B with one ----
  const companyA = await registerCompany("A");
  const custA1 = await createCustomer(companyA.ownerToken, "A", 1);
  const custA2 = await createCustomer(companyA.ownerToken, "A", 2);
  const portalA1 = await provisionPortalCustomer(companyA.ownerToken, custA1.id);
  await provisionPortalCustomer(companyA.ownerToken, custA2.id);

  const paidInvoiceA1 = await createInvoice(companyA.ownerToken, custA1.id);
  await markInvoicePaid(companyA.ownerToken, paidInvoiceA1);
  const unpaidInvoiceA1 = await createInvoice(companyA.ownerToken, custA1.id);
  const paidInvoiceA2 = await createInvoice(companyA.ownerToken, custA2.id);
  await markInvoicePaid(companyA.ownerToken, paidInvoiceA2);

  const companyB = await registerCompany("B");
  const custB1 = await createCustomer(companyB.ownerToken, "B", 1);
  const portalB1 = await provisionPortalCustomer(companyB.ownerToken, custB1.id);

  // ==========================================================================
  // 1. Happy path — a paid invoice returns a real PDF receipt.
  // ==========================================================================
  console.log("Paid invoice — customer downloads their own receipt:");
  {
    const r = await reqRaw("GET", `/portal/invoices/${paidInvoiceA1}/receipt-pdf`, {
      token: portalA1.portalToken,
    });
    check("GET receipt-pdf (paid, own) -> 200", r.status === 200, `got ${r.status} ${r.body.slice(0, 200)}`);
    check(
      "response content-type is application/pdf",
      r.contentType.includes("application/pdf"),
      `got "${r.contentType}"`,
    );
    check(
      "response body starts with %PDF magic bytes",
      r.body.slice(0, 4).toString() === "%PDF",
      `got first bytes "${r.body.slice(0, 8).toString("hex")}"`,
    );
    check(
      "content-disposition names a receipt attachment",
      /attachment/.test(r.disposition) && /receipt-/.test(r.disposition),
      `got "${r.disposition}"`,
    );
    check("PDF body is non-trivial (> 500 bytes)", r.body.length > 500, `got ${r.body.length} bytes`);
  }

  // ==========================================================================
  // 2. Unpaid invoice — no receipt before payment.
  // ==========================================================================
  console.log("\nUnpaid invoice — receipt must be refused with 400 NotPaid:");
  {
    const r = await req("GET", `/portal/invoices/${unpaidInvoiceA1}/receipt-pdf`, {
      token: portalA1.portalToken,
    });
    check(
      "GET receipt-pdf (unpaid, own) -> 400 NotPaid",
      r.status === 400 && r.json?.error === "NotPaid",
      `got ${r.status} ${JSON.stringify(r.json)}`,
    );
  }

  // ==========================================================================
  // 3. Tenant isolation — another COMPANY's paid invoice must 404.
  // ==========================================================================
  console.log("\nCross-company — company B's customer requesting company A's receipt must 404:");
  {
    const r = await req("GET", `/portal/invoices/${paidInvoiceA1}/receipt-pdf`, {
      token: portalB1.portalToken,
    });
    check("GET receipt-pdf across companies -> 404", r.status === 404, `got ${r.status} ${JSON.stringify(r.json)}`);
  }

  // ==========================================================================
  // 4. Cross-customer within the same company must also 404.
  // ==========================================================================
  console.log("\nCross-customer (same company) — another customer's paid receipt must 404:");
  {
    const r = await req("GET", `/portal/invoices/${paidInvoiceA2}/receipt-pdf`, {
      token: portalA1.portalToken,
    });
    check(
      "GET receipt-pdf for another customer's invoice -> 404",
      r.status === 404,
      `got ${r.status} ${JSON.stringify(r.json)}`,
    );
  }

  // ==========================================================================
  // 5. No auth — the endpoint must require a portal session.
  // ==========================================================================
  console.log("\nUnauthenticated — no portal token must 401:");
  {
    const r = await req("GET", `/portal/invoices/${paidInvoiceA1}/receipt-pdf`);
    check("GET receipt-pdf without token -> 401", r.status === 401, `got ${r.status} ${JSON.stringify(r.json)}`);
  }

  console.log(`\n${passes} passed, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Unexpected error in receipt-pdf access suite:", err);
  process.exit(1);
});
