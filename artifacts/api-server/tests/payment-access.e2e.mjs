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
  const nsPrefix = process.env.TEST_RUN_NS ? `${process.env.TEST_RUN_NS}_` : "";
  const ownerEmail = `${nsPrefix}pay_${label}_owner_${stamp}@example.com`;
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
  // 1b. Autopay opt-in consent — a Pro company has cleared the feature gate,
  //     but money still must not move (and autopay must not even be enable-able)
  //     for a customer who never consented, i.e. has no saved payment method.
  //     This guards the consent logic INSIDE the handlers, independent of the
  //     plan/connect/cross-customer gates above.
  // ==========================================================================
  console.log("\nAutopay opt-in consent (Pro company, customer without a saved card):");
  {
    const cust = await createCustomer(proCompany.ownerToken, "consent", 1);

    // Enabling autopay for a customer with no saved card must be refused — you
    // can't opt a customer into auto-charging when there's nothing to charge.
    const toggle = await req("PATCH", `/autopay/customers/${cust.id}/autopay`, {
      token: proCompany.ownerToken,
      body: { enabled: true },
    });
    check(
      "PATCH autopay enabled:true w/o saved card -> 400 NoPaymentMethod",
      toggle.status === 400 && toggle.json?.error === "NoPaymentMethod",
      `got ${toggle.status} ${JSON.stringify(toggle.json)}`,
    );

    // Charging that same customer's invoice must also be refused, not silently
    // succeed — the charge handler requires a saved payment method.
    const invoice = await createInvoice(proCompany.ownerToken, cust.id);
    const charge = await req("POST", `/autopay/invoices/${invoice}/charge`, {
      token: proCompany.ownerToken,
    });
    check(
      "POST charge for customer w/o saved card -> 400 NoPaymentMethod (no charge)",
      charge.status === 400 && charge.json?.error === "NoPaymentMethod",
      `got ${charge.status} ${JSON.stringify(charge.json)}`,
    );
  }

  // ==========================================================================
  // 1c. Autopay positive path — a customer who DID opt in (has a saved card)
  //     can have autopay enabled AND their invoice charged successfully, with
  //     the invoice flipping to "paid". This is the complement to 1b: it proves
  //     that the consent gate, while blocking customers without a card, does NOT
  //     break legitimate autopay for consenting customers. Without it, a future
  //     change could silently stop charging opted-in customers and no test would
  //     catch it.
  //
  //     This path actually moves money through Stripe, so it requires Stripe
  //     TEST keys in the environment (STRIPE_SECRET_KEY starting with sk_test_)
  //     — that lets us mint a test card and charge it without touching real
  //     money. When test keys aren't configured (live keys, connector-only, or
  //     no Stripe at all), this section SKIPS rather than fails, keeping the
  //     staff-access validation gate green everywhere.
  //
  //     Note: the autopay charge handler bills the platform Stripe account
  //     directly (no Connect transfer), so a connected account is NOT required
  //     here — only a test secret key.
  // ==========================================================================
  console.log("\nAutopay positive path (Pro company, customer WITH a saved card):");
  {
    const secretKey = process.env.STRIPE_SECRET_KEY || "";
    const testMode = secretKey.startsWith("sk_test_");

    if (!testMode) {
      console.log(
        "  SKIP  autopay positive path — Stripe test keys not configured " +
          "(STRIPE_SECRET_KEY is not an sk_test_ key); cannot mint a test card.",
      );
    } else {
      let stripe = null;
      try {
        const Stripe = (await import("stripe")).default;
        stripe = new Stripe(secretKey);
      } catch (err) {
        console.log(`  SKIP  autopay positive path — could not load Stripe SDK: ${err.message}`);
      }

      if (stripe) {
        const cust = await createCustomer(proCompany.ownerToken, "optin", 1);

        // 1) Server-side half of "save a card": create the Stripe customer and a
        //    SetupIntent. A 503 here means billing is unavailable in this env, so
        //    we skip the rest rather than fail.
        const si = await req("GET", `/autopay/customers/${cust.id}/setup-intent`, {
          token: proCompany.ownerToken,
        });
        const stripeCustomerId = si.json?.stripeCustomerId;

        if (si.status === 503 || !stripeCustomerId) {
          console.log(
            `  SKIP  autopay positive path — setup-intent unavailable (got ${si.status} ${JSON.stringify(si.json)}).`,
          );
        } else {
          check(
            "GET setup-intent -> 200 with stripeCustomerId",
            si.status === 200 && !!si.json?.clientSecret,
            `got ${si.status} ${JSON.stringify(si.json)}`,
          );

          // 2) Mint a real test payment method (test card 4242) and hand it to
          //    the API to attach + save as the customer's default card — this is
          //    the consenting customer's saved card.
          let paymentMethodId = null;
          try {
            const pm = await stripe.paymentMethods.create({
              type: "card",
              card: { token: "tok_visa" },
            });
            paymentMethodId = pm.id;
          } catch (err) {
            check("mint Stripe test payment method", false, err.message);
          }

          if (paymentMethodId) {
            const save = await req("POST", `/autopay/customers/${cust.id}/payment-method`, {
              token: proCompany.ownerToken,
              body: { paymentMethodId },
            });
            check(
              "POST save payment-method -> 200 success",
              save.status === 200 && save.json?.success === true,
              `got ${save.status} ${JSON.stringify(save.json)}`,
            );

            // 3) Enabling autopay now SUCCEEDS (the consenting customer has a card).
            const toggle = await req("PATCH", `/autopay/customers/${cust.id}/autopay`, {
              token: proCompany.ownerToken,
              body: { enabled: true },
            });
            check(
              "PATCH autopay enabled:true w/ saved card -> 200 success",
              toggle.status === 200 && toggle.json?.success === true && toggle.json?.autopayEnabled === true,
              `got ${toggle.status} ${JSON.stringify(toggle.json)}`,
            );

            // 4) Charging their invoice SUCCEEDS and flips it to paid.
            const invoice = await createInvoice(proCompany.ownerToken, cust.id);
            const chargeOk = await req("POST", `/autopay/invoices/${invoice}/charge`, {
              token: proCompany.ownerToken,
            });
            check(
              "POST charge w/ saved card -> success, invoice paid",
              chargeOk.status === 200 && chargeOk.json?.success === true && chargeOk.json?.status === "paid",
              `got ${chargeOk.status} ${JSON.stringify(chargeOk.json)}`,
            );
          }

          // Best-effort cleanup of the Stripe test customer we created.
          try {
            await stripe.customers.del(stripeCustomerId);
          } catch {
            /* best-effort */
          }
        }
      }
    }
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

  // ==========================================================================
  // 4. Double-charge protection — a paid invoice can never be charged again.
  //    Both the autopay charge handler and the portal pay handler must
  //    short-circuit with 400 AlreadyPaid once an invoice is settled, so a
  //    regression can't re-run a Stripe charge on an already-paid invoice.
  // ==========================================================================
  console.log("\nDouble-charge protection — a paid invoice must return 400 AlreadyPaid:");

  {
    // Reuse Pro company A + its portal customer A1, then create a fresh invoice,
    // mark it paid out-of-band (cash), and confirm both charging surfaces refuse.
    const paidInvoice = await createInvoice(companyA.ownerToken, custA1.id);
    await markInvoicePaid(companyA.ownerToken, paidInvoice);

    const autopay = await req("POST", `/autopay/invoices/${paidInvoice}/charge`, {
      token: companyA.ownerToken,
    });
    check(
      "autopay charge a paid invoice -> 400 AlreadyPaid",
      autopay.status === 400 && autopay.json?.error === "AlreadyPaid",
      `got ${autopay.status} ${JSON.stringify(autopay.json)}`,
    );

    const portalPay = await req("POST", `/portal/invoices/${paidInvoice}/pay`, {
      token: portalA1.portalToken,
    });
    check(
      "portal pay a paid invoice -> 400 AlreadyPaid",
      portalPay.status === 400 && portalPay.json?.error === "AlreadyPaid",
      `got ${portalPay.status} ${JSON.stringify(portalPay.json)}`,
    );
  }

  // ==========================================================================
  // 5. Concurrent double-charge protection — two near-simultaneous pay/charge
  //    requests on the SAME still-unpaid invoice must not both initiate a
  //    charge. The "status === paid" guards are read-then-act checks, so the
  //    charge handlers add a transactional claim (autopay) / idempotency key
  //    (portal) before touching Stripe. This check fires the requests in
  //    parallel and verifies the invariant holds: at most one request can
  //    proceed to charge, none returns a server error, and the invoice is never
  //    left wrongly paid or stuck in the transient "processing" claim state.
  //
  //    NOTE: in this black-box run Stripe itself is never reachable (the test
  //    customer has no saved card and the company has no Connect account), so
  //    both requests short-circuit at their pre-charge guard. That is exactly
  //    the point: the concurrency hardening must never turn a safe rejection
  //    into a crash, a double success, or a wedged invoice.
  // ==========================================================================
  console.log("\nConcurrent double-charge protection — parallel pay/charge on one unpaid invoice:");

  const getInvoiceStatus = async (ownerToken, invoiceId) => {
    const r = await req("GET", `/invoices/${invoiceId}`, { token: ownerToken });
    return r.json?.status;
  };

  // --- Autopay charge: fire 4 concurrent charges on a fresh unpaid invoice ---
  {
    const concInvoice = await createInvoice(companyA.ownerToken, custA1.id);
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        req("POST", `/autopay/invoices/${concInvoice}/charge`, { token: companyA.ownerToken }),
      ),
    );
    const successes = results.filter((r) => r.status >= 200 && r.status < 300).length;
    const serverErrors = results.filter((r) => r.status >= 500).length;
    const allExpected = results.every((r) =>
      (r.status === 400 && r.json?.error === "NoPaymentMethod") ||
      (r.status === 409 && r.json?.error === "ChargeInProgress"),
    );
    check(
      "concurrent autopay charges -> at most one charge initiated",
      successes <= 1,
      `got ${successes} successes: ${JSON.stringify(results.map((r) => r.status))}`,
    );
    check(
      "concurrent autopay charges -> no server errors",
      serverErrors === 0,
      `statuses: ${JSON.stringify(results.map((r) => r.status))}`,
    );
    check(
      "concurrent autopay charges -> every response is a safe rejection (400/409)",
      allExpected,
      `got ${JSON.stringify(results.map((r) => ({ s: r.status, e: r.json?.error })))}`,
    );
    const finalStatus = await getInvoiceStatus(companyA.ownerToken, concInvoice);
    check(
      "concurrent autopay charges -> invoice not left paid and not stuck in 'processing'",
      finalStatus !== "paid" && finalStatus !== "processing",
      `final status: ${finalStatus}`,
    );
  }

  // --- Portal pay: fire 4 concurrent pay requests on a fresh unpaid invoice --
  // companyA accepts card but has no Connect account, so each request stops at
  // the ConnectRequired guard before any Checkout session is created.
  {
    const concInvoice = await createInvoice(companyA.ownerToken, custA1.id);
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        req("POST", `/portal/invoices/${concInvoice}/pay`, { token: portalA1.portalToken }),
      ),
    );
    const successes = results.filter((r) => r.status >= 200 && r.status < 300).length;
    const serverErrors = results.filter((r) => r.status >= 500).length;
    check(
      "concurrent portal pays -> at most one charge initiated",
      successes <= 1,
      `got ${successes} successes: ${JSON.stringify(results.map((r) => r.status))}`,
    );
    check(
      "concurrent portal pays -> no server errors",
      serverErrors === 0,
      `statuses: ${JSON.stringify(results.map((r) => r.status))}`,
    );
    const finalStatus = await getInvoiceStatus(companyA.ownerToken, concInvoice);
    check(
      "concurrent portal pays -> invoice not left paid and not stuck in 'processing'",
      finalStatus !== "paid" && finalStatus !== "processing",
      `final status: ${finalStatus}`,
    );
  }

  // --- Summary --------------------------------------------------------------
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
