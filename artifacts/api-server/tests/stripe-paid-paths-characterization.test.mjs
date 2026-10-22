#!/usr/bin/env node
/**
 * REVIEW-B — characterization tests for the Stripe paid-transition paths:
 * portal Checkout webhook (routes/billing.ts), portal confirm-payment
 * (routes/customer-portal.ts) and autopay (routes/autopay.ts).
 *
 * Originally pinned the gaps recorded in
 * docs/claude-handoff/reviews/REVIEW-B-stripe-paid-paths.md; now asserts the
 * approved corrections: retryable webhook failures (B7/B8), no overlapping
 * portal + autopay charges incl. previously opened Checkout sessions (B4),
 * durable reconciliation flags for additional / mismatched payments, verified
 * amount/currency/company/invoice (B1/B3), consistent method + PaymentIntent
 * recording and retryable lookups in confirm-payment (B2/B5).
 *
 * Same in-memory harness as payment-receipt-email.test.mjs: real route
 * handlers, mocked `resend`, `@workspace/db` + `drizzle-orm` and Stripe.
 * No network or database is touched; no money moves.
 *
 * Exit code 0 = all checks passed, 1 = at least one check failed.
 */

import { register } from "node:module";
import { mock } from "node:test";

register("./ts-resolve.loader.mjs", import.meta.url);

// --- Environment ------------------------------------------------------------
// Real Resend path (creds present) so sendEmail reaches the mocked `resend`
// package below. NODE_ENV must NOT be "test" or sendEmail short-circuits before
// the mock and we couldn't observe the payloads.
process.env.RESEND_API_KEY = "re_test_dummy";
process.env.RESEND_FROM_EMAIL = "noreply@greensynk.test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "receipt-test-secret";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_dummy";
delete process.env.NODE_ENV;
// Never let any code path reach real Twilio, even in SMS mock-mode logging.
delete process.env.TWILIO_ACCOUNT_SID;
delete process.env.TWILIO_AUTH_TOKEN;
delete process.env.TWILIO_PHONE_NUMBER;

// --- Email capture (mocked `resend` package) --------------------------------
const sentEmails = [];
mock.module("resend", {
  namedExports: {
    Resend: class {
      constructor() {
        this.emails = {
          send: async (payload) => {
            sentEmails.push(payload);
            return { error: null };
          },
        };
      }
    },
  },
});

const RECEIPT_SUBJECT_PREFIX = "Payment Received for Invoice";
function receipts() {
  return sentEmails.filter((e) => String(e.subject).startsWith(RECEIPT_SUBJECT_PREFIX));
}
function resetEmails() {
  sentEmails.length = 0;
}

// --- In-memory database (mocked @workspace/db + drizzle-orm) -----------------
// Rows live in plain arrays; column references are {__col} markers; the drizzle
// operators become row predicates. Crucially, UPDATE ... WHERE ... RETURNING
// evaluates the predicate per-row BEFORE assigning, and returns only the rows
// it actually changed — the exact semantics the transition guards depend on.
let failNextUpdate = false;
const store = {
  companies: [],
  customers: [],
  invoices: [],
  invoiceLineItems: [],
  users: [],
  appointments: [],
  services: [],
  properties: [],
  recurringPlans: [],
  estimates: [],
  appointmentPhotos: [],
  activityLogs: [],
};

function makeTable(storeKey) {
  return new Proxy(
    { __store: storeKey },
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (typeof prop !== "string") return undefined;
        return { __col: prop };
      },
    },
  );
}

function project(fields, row) {
  return Object.fromEntries(Object.entries(fields).map(([k, c]) => [k, row[c.__col]]));
}

const fakeDb = {
  select(fields) {
    return {
      from(table) {
        let pred = null;
        const run = () =>
          store[table.__store]
            .filter((r) => !pred || pred(r))
            .map((r) => (fields ? project(fields, r) : { ...r }));
        const builder = {
          where(p) {
            pred = p;
            return builder;
          },
          limit: async (n) => run().slice(0, n),
          orderBy: async () => run(),
          then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
        };
        return builder;
      },
    };
  },
  update(table) {
    if (failNextUpdate) {
      failNextUpdate = false;
      throw new Error("db write failed (test)");
    }
    return {
      set(vals) {
        return {
          where(pred) {
            const exec = (sel) => {
              const updated = [];
              for (const row of store[table.__store]) {
                if (!pred || pred(row)) {
                  Object.assign(row, vals);
                  updated.push(row);
                }
              }
              return updated.map((r) => (sel ? project(sel, r) : { ...r }));
            };
            return {
              returning: (sel) => Promise.resolve(exec(sel)),
              then: (resolve, reject) => Promise.resolve(exec()).then(resolve, reject),
            };
          },
        };
      },
    };
  },
};

fakeDb.insert = (table) => ({
  values: async (vals) => {
    for (const v of Array.isArray(vals) ? vals : [vals]) store[table.__store].push({ id: nextId++, ...v });
  },
});

const dbNamedExports = {
  db: fakeDb,
  companiesTable: makeTable("companies"),
  customersTable: makeTable("customers"),
  invoicesTable: makeTable("invoices"),
  invoiceLineItemsTable: makeTable("invoiceLineItems"),
  usersTable: makeTable("users"),
  appointmentsTable: makeTable("appointments"),
  servicesTable: makeTable("services"),
  propertiesTable: makeTable("properties"),
  recurringPlansTable: makeTable("recurringPlans"),
  estimatesTable: makeTable("estimates"),
  appointmentPhotosTable: makeTable("appointmentPhotos"),
  activityLogsTable: makeTable("activityLogs"),
};
mock.module("@workspace/db", { namedExports: dbNamedExports });

const drizzleNamedExports = {
  eq: (col, val) => (row) => row[col.__col] === val,
  ne: (col, val) => (row) => row[col.__col] !== val,
  and: (...preds) => (row) => preds.every((p) => !p || p(row)),
  or: (...preds) => (row) => preds.some((p) => p && p(row)),
  lt: (col, val) => (row) => row[col.__col] < val,
  isNull: (col) => (row) => row[col.__col] == null,
  inArray: (col, arr) => (row) => arr.includes(row[col.__col]),
  desc: (col) => col,
  // Tagged-template use must yield a row predicate: the portal claim-ownership
  // guards compare `date_trunc('milliseconds', col) = token`. Model that as a
  // ms-equality between the referenced column and the bound value.
  sql: Object.assign((strings, ...vals) => {
    if (Array.isArray(strings)) {
      const col = vals.find((v) => v && v.__col);
      const bound = vals.find((v) => !(v && v.__col));
      if (col) {
        const toMs = (v) => (v instanceof Date ? v.getTime() : v);
        return (row) => toMs(row[col.__col]) === toMs(bound);
      }
    }
    return () => true;
  }, { raw: () => ({}) }),
};
mock.module("drizzle-orm", { namedExports: drizzleNamedExports });

// --- Stub the handlers' other collaborators ----------------------------------
const passthrough = (_req, _res, next) => next();

// Controlled per-scenario Stripe stub. constructEvent trusts the raw body here —
// signature verification is Stripe SDK behavior, not what this suite guards.
// Fault-injection switches for this suite.
let stripeInitFails = false;
const expiredSessions = [];
let expireFails = false;
let stripeSessionResult = { payment_status: "paid" };
let stripePaymentIntentResult = { id: "pi_test", status: "succeeded" };
const fakeStripe = {
  webhooks: {
    constructEvent: (body) => JSON.parse(typeof body === "string" ? body : body.toString()),
  },
  checkout: {
    sessions: {
      retrieve: async () => stripeSessionResult,
      create: async () => ({ id: "cs_test", url: "https://stripe.test/checkout" }),
      expire: async (id) => {
        expiredSessions.push(id);
        if (expireFails) throw new Error("session already completed (test)");
        return { id, status: "expired" };
      },
    },
  },
  paymentIntents: { create: async () => stripePaymentIntentResult },
  subscriptions: { retrieve: async () => ({ status: "active", current_period_end: 0, trial_end: null, metadata: {} }) },
};

// Every relative production module this suite mocks, keyed by the exact
// specifier passed to mock.module. Keeping the namedExports in ONE map lets
// the preflight below verify each mock still covers everything production
// code imports from it.
const relativeMocks = {
  "../src/lib/auth.ts": {
    requireAuth: passthrough,
    requireRole: () => passthrough,
    hashPassword: async () => "hashed",
    verifyPassword: async () => true,
    verifyUserToken: async () => null,
  },
  "../src/lib/subscription.ts": { requireActiveSubscription: passthrough },
  "../src/lib/features.ts": {
    requireWithinPlanLimit: () => passthrough,
    requireFeature: () => passthrough,
    hasFeature: async () => true,
    getRequiredPlanForFeature: () => "pro",
    getPlanUsageSummary: async () => ({}),
    getDowngradeViolations: async () => [],
  },
  "../src/lib/activity.ts": { logActivity: async () => {} },
  "../src/lib/automations.ts": { fireAutomations: () => {} },
  "../src/lib/invoice-email.ts": { dispatchInvoiceEmail: async () => true },
  "../src/lib/invoice-pdf.ts": { buildInvoicePdf: async () => Buffer.from("PDF") },
  "../src/lib/invoice-number.ts": { insertInvoiceWithNumber: async () => null },
  "../src/lib/sms-consent.ts": { sendSMSWithConsent: async () => {} },
  "../src/lib/objectStorage.ts": { ObjectStorageService: class {} },
  "../src/lib/plan-catalog.ts": { getCatalog: async () => [] },
  "../src/lib/stripe.ts": {
    getUncachableStripeClient: async () => {
      if (stripeInitFails) throw new Error("stripe client unavailable (test)");
      return fakeStripe;
    },
    getStripePublishableKey: async () => "pk_test_dummy",
    getStripePriceId: async () => "price_dummy",
  },
};
for (const [specifier, namedExports] of Object.entries(relativeMocks)) {
  mock.module(specifier, { namedExports });
}

// --- Preflight: mock surface must cover production imports -------------------
// If any production module reachable from the routes below has grown a new
// named import from @workspace/db, drizzle-orm, or any of the mocked relative
// libs above, fail NOW with an actionable "add X to the mock" message instead
// of an opaque import-time SyntaxError.
const { assertMockCovers, assertRelativeMockCovers } = await import("./mock-surface-check.mjs");
const routeEntryFiles = [
  "../src/routes/invoices.ts",
  "../src/routes/autopay.ts",
  "../src/routes/billing.ts",
  "../src/routes/customer-portal.ts",
];
const mockedRelativeModules = Object.keys(relativeMocks);
for (const [packageName, providedNames] of [
  ["@workspace/db", Object.keys(dbNamedExports)],
  ["drizzle-orm", Object.keys(drizzleNamedExports)],
]) {
  assertMockCovers({
    testFile: import.meta.url,
    packageName,
    providedNames,
    entryFiles: routeEntryFiles,
    skipModules: mockedRelativeModules,
  });
}
for (const [modulePath, exportsObject] of Object.entries(relativeMocks)) {
  assertRelativeMockCovers({
    testFile: import.meta.url,
    modulePath,
    providedNames: Object.keys(exportsObject),
    entryFiles: routeEntryFiles,
    skipModules: mockedRelativeModules,
  });
}

// --- Import the REAL route modules (mocks above intercept their imports) -----
const invoicesRouter = (await import("../src/routes/invoices.ts")).default;
const autopayRouter = (await import("../src/routes/autopay.ts")).default;
const billingRouter = (await import("../src/routes/billing.ts")).default;
const customerPortalRouter = (await import("../src/routes/customer-portal.ts")).default;

// Pull a route's FINAL handler off the express router (router-level auth
// middleware is mocked to passthrough anyway; req.user / req.portal are seeded
// directly on the fake request).
function routeHandler(router, method, path) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

const markPaid = routeHandler(invoicesRouter, "post", "/:id/mark-paid");
const autopayCharge = routeHandler(autopayRouter, "post", "/invoices/:id/charge");
const billingWebhook = routeHandler(billingRouter, "post", "/webhook");
const confirmPayment = routeHandler(customerPortalRouter, "post", "/invoices/:id/confirm-payment");
const portalPay = routeHandler(customerPortalRouter, "post", "/invoices/:id/pay");

function makeRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
    setHeader() {},
    send(payload) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

// dispatchPaymentReceiptEmail is fire-and-forget (never awaited by the routes),
// so flush the microtask/macrotask queue before counting captured emails.
async function settle() {
  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

// --- Seed helpers -------------------------------------------------------------
let nextId = 1;
function seedCompany(overrides = {}) {
  const company = {
    id: nextId++,
    name: "Acme Lawn Co",
    slug: "acme-lawn",
    email: "owner@acme.test",
    stripeConnectAccountId: "acct_test",
    ...overrides,
  };
  store.companies.push(company);
  return company;
}
function seedCustomer(companyId, overrides = {}) {
  const customer = {
    id: nextId++,
    companyId,
    firstName: "Casey",
    lastName: "Customer",
    email: "casey@customer.test",
    stripeCustomerId: "cus_test",
    stripePaymentMethodId: "pm_test",
    ...overrides,
  };
  store.customers.push(customer);
  return customer;
}
function seedInvoice(companyId, customerId, overrides = {}) {
  const invoice = {
    id: nextId++,
    companyId,
    customerId,
    invoiceNumber: `INV-${nextId}`,
    status: "sent",
    subtotal: "100.00",
    tax: "0.00",
    total: "100.00",
    paidAt: null,
    stripePaymentIntentId: null,
    paymentMethod: null,
    dueDate: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  store.invoices.push(invoice);
  return invoice;
}

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



console.log("REVIEW-B Stripe paid-path behavior (corrected)\n");

const flags = (invoiceId) => store.activityLogs.filter((a) => a.action === "invoice.payment_flagged" && a.entityId === invoiceId);
const webhookReq = (event) => ({ headers: { "stripe-signature": "t=1,v1=stub" }, rawBody: JSON.stringify(event), body: null });
const portalPaidEvent = (invoice, company, overrides = {}) => ({
  type: "checkout.session.completed",
  data: {
    object: {
      id: `cs_${invoice.id}`,
      payment_status: "paid",
      payment_intent: `pi_portal_${invoice.id}`,
      amount_total: 10000,
      currency: "usd",
      metadata: { source: "customer_portal", invoiceId: String(invoice.id), companyId: String(company.id) },
      ...overrides,
    },
  },
});
const paidSession = (invoice, company, overrides = {}) => ({
  id: `cs_${invoice.id}`,
  status: "complete",
  payment_status: "paid",
  payment_intent: `pi_portal_${invoice.id}`,
  amount_total: 10000,
  currency: "usd",
  metadata: { invoiceId: String(invoice.id), companyId: String(company.id) },
  ...overrides,
});
const portalReq = (invoice) => ({ portal: { customerId: invoice.customerId, companyId: invoice.companyId }, params: { id: String(invoice.id) } });
const autopayReq = (invoice) => ({ user: { companyId: invoice.companyId, userId: 1 }, params: { id: String(invoice.id) }, body: {} });
// Portal checkout requires a card-accepting Pro company with a ready Connect account.
fakeStripe.v2 = { core: { accounts: { retrieve: async () => ({ configuration: { merchant: { capabilities: { card_payments: { status: "active" } } } } }) } } };
const portalCompany = () => seedCompany({ subscriptionPlan: "pro", acceptedPaymentMethods: JSON.stringify(["card"]), stripeConnectAccountId: "acct_test" });

// ---------------------------------------------------------------------------
console.log("Already protected:");
{
  const company = seedCompany();
  const invoice = seedInvoice(company.id, seedCustomer(company.id).id);
  const res = makeRes();
  await billingWebhook({ headers: {}, rawBody: "{}", body: null }, res);
  check("webhook without a Stripe signature -> 400 (no forged paid events)", res.statusCode === 400 && invoice.status === "sent", `${res.statusCode} ${invoice.status}`);
}
{
  const company = seedCompany();
  const invoice = seedInvoice(company.id, seedCustomer(company.id).id);
  resetEmails();
  await billingWebhook(webhookReq(portalPaidEvent(invoice, company)), makeRes());
  await billingWebhook(webhookReq(portalPaidEvent(invoice, company)), makeRes());
  await settle();
  check("webhook replay marks paid once, one receipt, and flags nothing", invoice.status === "paid" && receipts().length === 1 && flags(invoice.id).length === 0, `${invoice.status} ${receipts().length} ${flags(invoice.id).length}`);
  check("webhook records card method + the PaymentIntent id", invoice.paymentMethod === "card" && invoice.stripePaymentIntentId === `pi_portal_${invoice.id}`);
}

// ---------------------------------------------------------------------------
console.log("\nB7/B8 — failures are retryable, never acknowledged:");
{
  const company = seedCompany();
  const invoice = seedInvoice(company.id, seedCustomer(company.id).id);
  stripeInitFails = true;
  const res = makeRes();
  await billingWebhook(webhookReq(portalPaidEvent(invoice, company)), res);
  stripeInitFails = false;
  check("Stripe client init failure -> 503 so Stripe retries", res.statusCode === 503, `${res.statusCode} ${JSON.stringify(res.body)}`);
  await billingWebhook(webhookReq(portalPaidEvent(invoice, company)), makeRes());
  check("...and the retried event records the payment", invoice.status === "paid", invoice.status);
}
{
  const company = seedCompany();
  const invoice = seedInvoice(company.id, seedCustomer(company.id).id);
  failNextUpdate = true;
  const res = makeRes();
  await billingWebhook(webhookReq(portalPaidEvent(invoice, company)), res);
  failNextUpdate = false;
  check("a DB error while recording the payment -> 500 so Stripe retries", res.statusCode === 500, `${res.statusCode} ${JSON.stringify(res.body)}`);
  await billingWebhook(webhookReq(portalPaidEvent(invoice, company)), makeRes());
  check("...and the retried event records the payment", invoice.status === "paid", invoice.status);
}

// ---------------------------------------------------------------------------
console.log("\nB1/B3 — amount, currency, company and invoice are verified:");
for (const [label, overrides, reason] of [
  ["a $1.00 session for a $100.00 invoice", { amount_total: 100 }, "amount_mismatch"],
  ["an EUR session", { currency: "eur" }, "currency_mismatch"],
]) {
  const company = seedCompany();
  const invoice = seedInvoice(company.id, seedCustomer(company.id).id);
  const res = makeRes();
  await billingWebhook(webhookReq(portalPaidEvent(invoice, company, overrides)), res);
  check(`webhook: ${label} is NOT marked paid`, invoice.status === "sent", invoice.status);
  check(`webhook: ${label} is durably flagged (${reason}) and acknowledged`, flags(invoice.id)[0]?.metadataJson?.reason === reason && res.statusCode === 200, JSON.stringify(flags(invoice.id)));
}
{
  const companyA = seedCompany();
  const companyB = seedCompany({ slug: "other-co" });
  const invoiceA = seedInvoice(companyA.id, seedCustomer(companyA.id).id);
  await billingWebhook(webhookReq(portalPaidEvent(invoiceA, companyB)), makeRes());
  check("webhook naming another company is NOT applied and is flagged (company_mismatch)", invoiceA.status === "sent" && flags(invoiceA.id)[0]?.metadataJson?.reason === "company_mismatch", `${invoiceA.status} ${JSON.stringify(flags(invoiceA.id))}`);
}
{
  const company = seedCompany();
  const invoice = seedInvoice(company.id, seedCustomer(company.id).id, { stripePaymentIntentId: "cs_short" });
  stripeSessionResult = paidSession(invoice, company, { id: "cs_short", amount_total: 100 });
  const res = makeRes();
  await confirmPayment(portalReq(invoice), res);
  check("confirm-payment refuses an amount mismatch (409, not paid)", res.statusCode === 409 && invoice.status === "sent", `${res.statusCode} ${invoice.status}`);
}

// ---------------------------------------------------------------------------
console.log("\nB2/B5 — confirm-payment records consistently and fails retryably:");
{
  const company = seedCompany();
  const invoice = seedInvoice(company.id, seedCustomer(company.id).id, { stripePaymentIntentId: "cs_ok" });
  stripeSessionResult = paidSession(invoice, company, { id: "cs_ok" });
  await confirmPayment(portalReq(invoice), makeRes());
  check("confirm-payment records card + the PaymentIntent (not the session id)", invoice.status === "paid" && invoice.paymentMethod === "card" && invoice.stripePaymentIntentId === `pi_portal_${invoice.id}`, `${invoice.paymentMethod} ${invoice.stripePaymentIntentId}`);
}
{
  const company = seedCompany();
  const invoice = seedInvoice(company.id, seedCustomer(company.id).id, { stripePaymentIntentId: "cs_err" });
  const original = fakeStripe.checkout.sessions.retrieve;
  fakeStripe.checkout.sessions.retrieve = async () => {
    throw new Error("stripe timeout (test)");
  };
  const res = makeRes();
  await confirmPayment(portalReq(invoice), res);
  fakeStripe.checkout.sessions.retrieve = original;
  check("a Stripe lookup error -> 503 (retryable), not a 500", res.statusCode === 503 && invoice.status === "sent", `${res.statusCode}`);
}

// ---------------------------------------------------------------------------
console.log("\nB4 — portal and autopay can never both charge:");
{
  // Portal webhook arriving while autopay holds the claim: retry, don't take the row.
  const company = seedCompany();
  const invoice = seedInvoice(company.id, seedCustomer(company.id).id);
  let release;
  const gate = new Promise((r) => (release = r));
  const original = fakeStripe.paymentIntents.create;
  fakeStripe.paymentIntents.create = async () => {
    await gate;
    return { id: "pi_autopay_race", status: "succeeded" };
  };
  const charging = autopayCharge(autopayReq(invoice), makeRes());
  await settle();
  const res = makeRes();
  await billingWebhook(webhookReq(portalPaidEvent(invoice, company)), res);
  check("a portal webhook during a live autopay claim -> 503 retry; the claim is untouched", res.statusCode === 503 && invoice.status === "processing", `${res.statusCode} ${invoice.status}`);
  release();
  await charging;
  fakeStripe.paymentIntents.create = original;
  check("the autopay charge is recorded on the invoice", invoice.status === "paid" && invoice.stripePaymentIntentId === "pi_autopay_race");
  await billingWebhook(webhookReq(portalPaidEvent(invoice, company)), makeRes());
  const f = flags(invoice.id);
  check(
    "Stripe's retry of the portal payment is durably flagged as an additional payment (no refund, not discarded)",
    f.length === 1 && f[0].metadataJson.reason === "additional_payment" && f[0].metadataJson.paymentIntentId === `pi_portal_${invoice.id}` && f[0].metadataJson.recordedPaymentIntentId === "pi_autopay_race",
    JSON.stringify(f),
  );
}
{
  // Autopay on an invoice with a previously opened (still open) portal session: expire it first.
  const company = seedCompany();
  const invoice = seedInvoice(company.id, seedCustomer(company.id).id, { stripePaymentIntentId: "cs_open_before" });
  stripeSessionResult = { id: "cs_open_before", status: "open" };
  expiredSessions.length = 0;
  const res = makeRes();
  await autopayCharge(autopayReq(invoice), res);
  check("autopay expires the previously opened portal checkout before charging", expiredSessions.includes("cs_open_before") && res.body?.success === true && invoice.status === "paid", `${JSON.stringify(expiredSessions)} ${JSON.stringify(res.body)}`);
}
for (const [label, session, failExpire] of [
  ["completed", { id: "cs_done", status: "complete" }, false],
  ["un-expirable", { id: "cs_racing", status: "open" }, true],
]) {
  // ...and refuses to charge when that session already completed (or can't be closed).
  const company = seedCompany();
  const invoice = seedInvoice(company.id, seedCustomer(company.id).id, { stripePaymentIntentId: session.id });
  stripeSessionResult = session;
  expireFails = failExpire;
  let charged = false;
  const original = fakeStripe.paymentIntents.create;
  fakeStripe.paymentIntents.create = async () => {
    charged = true;
    return { id: "pi_should_not", status: "succeeded" };
  };
  const res = makeRes();
  await autopayCharge(autopayReq(invoice), res);
  fakeStripe.paymentIntents.create = original;
  expireFails = false;
  check(`autopay with a ${label} portal session does NOT charge (409) and releases the claim`, !charged && res.statusCode === 409 && invoice.status === "sent", `${charged} ${res.statusCode} ${invoice.status}`);
}
{
  // Portal pay while autopay holds the claim.
  const company = portalCompany();
  const invoice = seedInvoice(company.id, seedCustomer(company.id).id, { status: "processing" });
  const res = makeRes();
  await portalPay(portalReq(invoice), res);
  check("portal pay on a processing invoice -> 409, no checkout opened", res.statusCode === 409 && res.body?.error === "ChargeInProgress", `${res.statusCode} ${JSON.stringify(res.body)}`);
}
{
  // Portal pay reuses the recorded open session instead of opening a second one.
  const company = portalCompany();
  const invoice = seedInvoice(company.id, seedCustomer(company.id).id, { stripePaymentIntentId: "cs_existing" });
  stripeSessionResult = { id: "cs_existing", status: "open", amount_total: 10000, url: "https://stripe.test/existing" };
  let created = 0;
  const original = fakeStripe.checkout.sessions.create;
  fakeStripe.checkout.sessions.create = async () => {
    created++;
    return { id: "cs_new", url: "https://stripe.test/new" };
  };
  const res = makeRes();
  await portalPay(portalReq(invoice), res);
  fakeStripe.checkout.sessions.create = original;
  check("portal pay reuses the recorded open session (no second open checkout)", created === 0 && res.body?.url === "https://stripe.test/existing", `${created} ${JSON.stringify(res.body)}`);
}
{
  // Portal pay that loses the race to an autopay claim expires its own session.
  const company = portalCompany();
  const invoice = seedInvoice(company.id, seedCustomer(company.id).id);
  const original = fakeStripe.checkout.sessions.create;
  fakeStripe.checkout.sessions.create = async () => {
    Object.assign(invoice, { status: "processing", updatedAt: new Date(Date.now() + 1000) }); // autopay claims meanwhile
    return { id: "cs_lost_race", url: "https://stripe.test/lost" };
  };
  expiredSessions.length = 0;
  const res = makeRes();
  await portalPay(portalReq(invoice), res);
  fakeStripe.checkout.sessions.create = original;
  check("an unrecordable new session is expired and never handed to the customer", expiredSessions.includes("cs_lost_race") && res.statusCode === 409 && !res.body?.url, `${JSON.stringify(expiredSessions)} ${res.statusCode}`);
}
{
  // Autopay charge succeeding on an invoice paid meanwhile by other means.
  const company = seedCompany();
  const invoice = seedInvoice(company.id, seedCustomer(company.id).id);
  const original = fakeStripe.paymentIntents.create;
  fakeStripe.paymentIntents.create = async () => {
    Object.assign(invoice, { status: "paid", paymentMethod: "cash" }); // manual payment lands mid-charge
    return { id: "pi_extra", status: "succeeded" };
  };
  await autopayCharge(autopayReq(invoice), makeRes());
  fakeStripe.paymentIntents.create = original;
  const f = flags(invoice.id);
  check("a successful autopay charge on an already-paid invoice is flagged, not dropped", f.length === 1 && f[0].metadataJson.reason === "additional_payment" && f[0].metadataJson.paymentIntentId === "pi_extra", JSON.stringify(f));
  check("...and the recorded payment is left as it was", invoice.paymentMethod === "cash", invoice.paymentMethod);
}

stripeSessionResult = { payment_status: "paid" };
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
