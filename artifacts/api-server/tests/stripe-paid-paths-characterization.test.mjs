#!/usr/bin/env node
/**
 * REVIEW-B — characterization tests for the Stripe paid-transition paths:
 * portal Checkout webhook (routes/billing.ts), portal confirm-payment
 * (routes/customer-portal.ts) and autopay (routes/autopay.ts).
 *
 * These tests PIN CURRENT BEHAVIOR, including the gaps recorded in
 * docs/claude-handoff/reviews/REVIEW-B-stripe-paid-paths.md. Cases marked
 * "FINDING" are not endorsements: they document today's behavior so each
 * approved correction lands as a deliberate, reviewed change to this file.
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

console.log("REVIEW-B Stripe paid-path characterization\n");

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

// ---------------------------------------------------------------------------
// Baseline protections that already hold.
// ---------------------------------------------------------------------------
console.log("Already protected:");
{
  const company = seedCompany();
  const invoice = seedInvoice(company.id, seedCustomer(company.id).id);
  const res = makeRes();
  await billingWebhook({ headers: {}, rawBody: "{}", body: null }, res);
  check("webhook without a Stripe signature -> 400 (no forged paid events)", res.statusCode === 400, String(res.statusCode));
  check("...and the invoice is untouched", invoice.status === "sent", invoice.status);
}
{
  const company = seedCompany();
  const invoice = seedInvoice(company.id, seedCustomer(company.id).id);
  resetEmails();
  await billingWebhook(webhookReq(portalPaidEvent(invoice, company)), makeRes());
  await billingWebhook(webhookReq(portalPaidEvent(invoice, company)), makeRes());
  await settle();
  check("webhook replay marks paid once and sends one receipt", invoice.status === "paid" && receipts().length === 1, `${invoice.status} ${receipts().length}`);
  check("webhook records card method + the PaymentIntent id", invoice.paymentMethod === "card" && invoice.stripePaymentIntentId === `pi_portal_${invoice.id}`);
}
{
  const company = seedCompany();
  const invoice = seedInvoice(company.id, seedCustomer(company.id).id, { stripePaymentIntentId: "cs_unpaid" });
  stripeSessionResult = { payment_status: "unpaid" };
  const res = makeRes();
  await confirmPayment({ portal: { customerId: invoice.customerId, companyId: company.id }, params: { id: String(invoice.id) } }, res);
  stripeSessionResult = { payment_status: "paid" };
  check("confirm-payment refuses an unpaid Checkout session (402)", res.statusCode === 402 && invoice.status === "sent", `${res.statusCode} ${invoice.status}`);
}

// ---------------------------------------------------------------------------
// B1 — paid amount / currency are never compared with the invoice.
// ---------------------------------------------------------------------------
console.log("\nAmount / currency verification:");
{
  const company = seedCompany();
  const invoice = seedInvoice(company.id, seedCustomer(company.id).id);
  await billingWebhook(webhookReq(portalPaidEvent(invoice, company, { amount_total: 100, currency: "eur" })), makeRes());
  check("FINDING B1: webhook marks a $100.00 invoice paid for a 1.00 EUR session", invoice.status === "paid", invoice.status);
}
{
  const company = seedCompany();
  const invoice = seedInvoice(company.id, seedCustomer(company.id).id, { stripePaymentIntentId: "cs_short" });
  stripeSessionResult = { payment_status: "paid", amount_total: 100, currency: "usd" };
  await confirmPayment({ portal: { customerId: invoice.customerId, companyId: company.id }, params: { id: String(invoice.id) } }, makeRes());
  stripeSessionResult = { payment_status: "paid" };
  check("FINDING B1: confirm-payment marks paid without comparing amount_total to the invoice total", invoice.status === "paid", invoice.status);
  check("FINDING B2: confirm-payment records no payment method", invoice.paymentMethod == null, invoice.paymentMethod);
}

// ---------------------------------------------------------------------------
// B3 — webhook update is scoped by invoice id only.
// ---------------------------------------------------------------------------
console.log("\nTenant scoping:");
{
  const companyA = seedCompany();
  const companyB = seedCompany({ slug: "other-co" });
  const invoiceA = seedInvoice(companyA.id, seedCustomer(companyA.id).id);
  await billingWebhook(webhookReq(portalPaidEvent(invoiceA, companyB)), makeRes());
  check("FINDING B3: webhook marks the invoice paid even when metadata.companyId names another company", invoiceA.status === "paid", invoiceA.status);
}

// ---------------------------------------------------------------------------
// B4 — portal webhook vs. a live autopay claim.
// ---------------------------------------------------------------------------
console.log("\nPortal webhook vs. in-flight autopay charge:");
{
  const company = seedCompany();
  const invoice = seedInvoice(company.id, seedCustomer(company.id).id);
  const req = { user: { companyId: company.id, userId: 1 }, params: { id: String(invoice.id) }, body: {} };
  let release;
  const gate = new Promise((r) => (release = r));
  const original = fakeStripe.paymentIntents.create;
  let autopayCharged = false;
  fakeStripe.paymentIntents.create = async () => {
    await gate;
    autopayCharged = true;
    return { id: "pi_autopay_race", status: "succeeded" };
  };
  const charging = autopayCharge(req, makeRes());
  await settle();
  await billingWebhook(webhookReq(portalPaidEvent(invoice, company)), makeRes());
  check("FINDING B4: the portal webhook overwrites the live 'processing' claim", invoice.status === "paid" && invoice.stripePaymentIntentId === `pi_portal_${invoice.id}`, `${invoice.status} ${invoice.stripePaymentIntentId}`);
  release();
  await charging;
  fakeStripe.paymentIntents.create = original;
  check("FINDING B4: ...the autopay card charge still succeeds (customer charged twice)", autopayCharged);
  check("FINDING B4: ...and the second charge is recorded nowhere on the invoice", invoice.stripePaymentIntentId !== "pi_autopay_race");
}

// ---------------------------------------------------------------------------
// B7 / B8 — webhook acknowledges events it did not process.
// ---------------------------------------------------------------------------
console.log("\nWebhook acknowledgement on failure:");
{
  const company = seedCompany();
  const invoice = seedInvoice(company.id, seedCustomer(company.id).id);
  stripeInitFails = true;
  const res = makeRes();
  await billingWebhook(webhookReq(portalPaidEvent(invoice, company)), res);
  stripeInitFails = false;
  check("FINDING B7: Stripe client init failure still answers 2xx, so Stripe never retries", res.statusCode < 300 && res.body?.received === true, `${res.statusCode} ${JSON.stringify(res.body)}`);
  check("FINDING B7: ...and the paid event is lost", invoice.status === "sent", invoice.status);
}
{
  const company = seedCompany();
  const invoice = seedInvoice(company.id, seedCustomer(company.id).id);
  failNextUpdate = true;
  const res = makeRes();
  await billingWebhook(webhookReq(portalPaidEvent(invoice, company)), res);
  failNextUpdate = false;
  check("FINDING B8: a DB error while recording the payment still answers 2xx", res.statusCode < 300 && res.body?.success === true, `${res.statusCode} ${JSON.stringify(res.body)}`);
  check("FINDING B8: ...and the paid event is lost", invoice.status === "sent", invoice.status);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
