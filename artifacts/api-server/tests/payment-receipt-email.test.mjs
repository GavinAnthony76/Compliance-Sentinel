#!/usr/bin/env node
/**
 * Automated tests confirming customers get a payment receipt email after every
 * payment — across ALL FOUR paid paths — and never a duplicate.
 *
 * The four paths that flip an invoice to "paid" (and must each fire
 * dispatchPaymentReceiptEmail exactly once, on the genuine transition only):
 *
 *   1. Manual mark-paid            POST /invoices/:id/mark-paid   (routes/invoices.ts)
 *   2. Stripe portal webhook       POST /billing/webhook          (routes/billing.ts,
 *                                  checkout.session.completed w/ source=customer_portal)
 *   3. Portal confirm-payment      POST /portal/invoices/:id/confirm-payment
 *                                                                 (routes/customer-portal.ts)
 *   4. Autopay charge              POST /autopay/invoices/:id/charge (routes/autopay.ts)
 *
 * Every path guards notifications with a transition-guarded conditional UPDATE
 * (`WHERE status != 'paid' ... RETURNING`): only the request that actually
 * flips status -> paid notifies. This suite imports the REAL route handlers and
 * the REAL notifications module, and locks in:
 *
 *   - A genuine status -> paid transition sends the customer receipt exactly once.
 *   - Replays / concurrent duplicates (webhook redelivery, double mark-paid,
 *     double charge, confirm-payment after webhook) send NO duplicate receipt.
 *   - No receipt is sent when the customer has no email on file.
 *   - Non-success outcomes (unpaid Stripe session, requires_action intent,
 *     charge already in progress) send nothing.
 *
 * Like billing-status-email.test.mjs, the handlers' I/O boundaries are mocked
 * via node:test module mocking (--experimental-test-module-mocks):
 *   - `resend` captures outgoing emails (nothing hits the network),
 *   - `@workspace/db` + `drizzle-orm` are replaced with a tiny in-memory store
 *     that faithfully implements the conditional-UPDATE + RETURNING semantics
 *     the transition guards rely on,
 *   - the Stripe client is a stub whose responses each scenario controls.
 * No production code is changed and no network/DB is touched.
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
    getUncachableStripeClient: async () => fakeStripe,
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

console.log("Payment receipt email tests (all four paid paths)\n");

// ============================================================================
// Path 1: manual mark-paid (POST /invoices/:id/mark-paid)
// ============================================================================
console.log("Path 1 — manual mark-paid:");
{
  const company = seedCompany();
  const customer = seedCustomer(company.id);
  const invoice = seedInvoice(company.id, customer.id);

  resetEmails();
  const req = { user: { companyId: company.id, userId: 1 }, params: { id: String(invoice.id) }, body: {} };
  const res = makeRes();
  await markPaid(req, res);
  await settle();
  check("genuine transition sends exactly one receipt", receipts().length === 1, `sent ${receipts().length}`);
  check("receipt goes to the customer's email", receipts()[0]?.to === customer.email, receipts()[0]?.to);
  check("receipt PDF is attached", receipts()[0]?.attachments?.[0]?.filename === `receipt-${invoice.invoiceNumber}.pdf`);
  check("invoice is marked paid", invoice.status === "paid", invoice.status);

  // Replay: marking an already-paid invoice paid again must NOT re-send.
  resetEmails();
  const res2 = makeRes();
  await markPaid({ ...req }, res2);
  await settle();
  check("replayed mark-paid sends NO duplicate receipt", receipts().length === 0, `sent ${receipts().length}`);
  check("replayed mark-paid still responds 200", res2.statusCode === 200, String(res2.statusCode));
}
{
  // Two "concurrent" mark-paid requests: the transition guard lets only one notify.
  const company = seedCompany();
  const customer = seedCustomer(company.id);
  const invoice = seedInvoice(company.id, customer.id);
  resetEmails();
  const mk = () => markPaid({ user: { companyId: company.id, userId: 1 }, params: { id: String(invoice.id) }, body: {} }, makeRes());
  await Promise.all([mk(), mk()]);
  await settle();
  check("two concurrent mark-paid calls send exactly one receipt", receipts().length === 1, `sent ${receipts().length}`);
}
{
  // Customer without an email on file: transition happens, but no receipt.
  const company = seedCompany();
  const customer = seedCustomer(company.id, { email: null });
  const invoice = seedInvoice(company.id, customer.id);
  resetEmails();
  await markPaid({ user: { companyId: company.id, userId: 1 }, params: { id: String(invoice.id) }, body: {} }, makeRes());
  await settle();
  check("no receipt when the customer has no email on file", receipts().length === 0, `sent ${receipts().length}`);
  check("invoice still transitions to paid without an email", invoice.status === "paid", invoice.status);
}

// ============================================================================
// Path 2: Stripe portal webhook (POST /billing/webhook, checkout.session.completed)
// ============================================================================
console.log("\nPath 2 — Stripe portal checkout webhook:");
{
  const company = seedCompany();
  const customer = seedCustomer(company.id);
  const invoice = seedInvoice(company.id, customer.id);

  const event = {
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_webhook_test",
        payment_status: "paid",
        payment_intent: "pi_webhook_test",
        metadata: { source: "customer_portal", invoiceId: String(invoice.id), companyId: String(company.id) },
      },
    },
  };
  const makeReq = () => ({ headers: { "stripe-signature": "t=1,v1=stub" }, rawBody: JSON.stringify(event), body: null });

  resetEmails();
  const res = makeRes();
  await billingWebhook(makeReq(), res);
  await settle();
  check("webhook payment sends exactly one receipt", receipts().length === 1, `sent ${receipts().length}`);
  check("webhook receipt goes to the customer", receipts()[0]?.to === customer.email, receipts()[0]?.to);
  check("webhook marks the invoice paid", invoice.status === "paid", invoice.status);
  check("webhook acknowledges the event", res.body?.success === true || res.body?.received === true, JSON.stringify(res.body));

  // Stripe redelivers the SAME event (replay): guard must suppress the receipt.
  resetEmails();
  await billingWebhook(makeReq(), makeRes());
  await settle();
  check("replayed webhook event sends NO duplicate receipt", receipts().length === 0, `sent ${receipts().length}`);
}

// ============================================================================
// Path 3: portal confirm-payment (POST /portal/invoices/:id/confirm-payment)
// ============================================================================
console.log("\nPath 3 — portal confirm-payment fallback:");
{
  const company = seedCompany();
  const customer = seedCustomer(company.id);
  const invoice = seedInvoice(company.id, customer.id, { stripePaymentIntentId: "cs_confirm_test" });

  const makeReq = () => ({ portal: { customerId: customer.id, companyId: company.id }, params: { id: String(invoice.id) } });

  // Stripe says the session is NOT paid yet: no transition, no receipt.
  stripeSessionResult = { payment_status: "unpaid" };
  resetEmails();
  const resUnpaid = makeRes();
  await confirmPayment(makeReq(), resUnpaid);
  await settle();
  check("unpaid session sends NO receipt", receipts().length === 0, `sent ${receipts().length}`);
  check("unpaid session responds 402", resUnpaid.statusCode === 402, String(resUnpaid.statusCode));

  // Session verified paid: genuine transition, exactly one receipt.
  stripeSessionResult = { payment_status: "paid" };
  resetEmails();
  const res = makeRes();
  await confirmPayment(makeReq(), res);
  await settle();
  check("confirmed payment sends exactly one receipt", receipts().length === 1, `sent ${receipts().length}`);
  check("confirm receipt goes to the customer", receipts()[0]?.to === customer.email, receipts()[0]?.to);
  check("confirm marks the invoice paid", invoice.status === "paid", invoice.status);
  check("confirm responds confirmed", res.body?.confirmed === true, JSON.stringify(res.body));

  // The webhook/fallback race: confirm-payment called again after the invoice
  // is already paid must NOT re-send.
  resetEmails();
  const res2 = makeRes();
  await confirmPayment(makeReq(), res2);
  await settle();
  check("confirm replay sends NO duplicate receipt", receipts().length === 0, `sent ${receipts().length}`);
  check("confirm replay still responds confirmed", res2.body?.confirmed === true, JSON.stringify(res2.body));
}

// ============================================================================
// Path 4: autopay charge (POST /autopay/invoices/:id/charge)
// ============================================================================
console.log("\nPath 4 — autopay charge:");
{
  const company = seedCompany();
  const customer = seedCustomer(company.id);
  const invoice = seedInvoice(company.id, customer.id);
  const makeReq = () => ({ user: { companyId: company.id, userId: 1 }, params: { id: String(invoice.id) }, body: {} });

  stripePaymentIntentResult = { id: "pi_autopay_test", status: "succeeded" };
  resetEmails();
  const res = makeRes();
  await autopayCharge(makeReq(), res);
  await settle();
  check("successful charge sends exactly one receipt", receipts().length === 1, `sent ${receipts().length}`);
  check("charge receipt goes to the customer", receipts()[0]?.to === customer.email, receipts()[0]?.to);
  check("charge marks the invoice paid", invoice.status === "paid", invoice.status);
  check("charge responds success", res.body?.success === true && res.body?.status === "paid", JSON.stringify(res.body));

  // Charging an already-paid invoice again: rejected, no receipt.
  resetEmails();
  const res2 = makeRes();
  await autopayCharge(makeReq(), res2);
  await settle();
  check("re-charging a paid invoice sends NO duplicate receipt", receipts().length === 0, `sent ${receipts().length}`);
  check("re-charge is rejected with AlreadyPaid", res2.statusCode === 400 && res2.body?.error === "AlreadyPaid", JSON.stringify(res2.body));
}
{
  // Concurrent-charge claim: a second request that finds the invoice already
  // claimed as "processing" must bail out with 409 and send nothing.
  const company = seedCompany();
  const customer = seedCustomer(company.id);
  const invoice = seedInvoice(company.id, customer.id, { status: "processing" });
  resetEmails();
  const res = makeRes();
  await autopayCharge({ user: { companyId: company.id, userId: 1 }, params: { id: String(invoice.id) }, body: {} }, res);
  await settle();
  check("a charge already in progress sends NO receipt", receipts().length === 0, `sent ${receipts().length}`);
  check("the losing concurrent charge gets 409 ChargeInProgress", res.statusCode === 409 && res.body?.error === "ChargeInProgress", JSON.stringify(res.body));
}
{
  // Non-settled PaymentIntent (requires_action): claim reverted, no receipt.
  const company = seedCompany();
  const customer = seedCustomer(company.id);
  const invoice = seedInvoice(company.id, customer.id);
  stripePaymentIntentResult = { id: "pi_requires_action", status: "requires_action" };
  resetEmails();
  const res = makeRes();
  await autopayCharge({ user: { companyId: company.id, userId: 1 }, params: { id: String(invoice.id) }, body: {} }, res);
  await settle();
  check("a requires_action charge sends NO receipt", receipts().length === 0, `sent ${receipts().length}`);
  check("the claim is reverted so the invoice can be retried", invoice.status === "sent", invoice.status);
  stripePaymentIntentResult = { id: "pi_test", status: "succeeded" };
}

// ============================================================================
// dispatchPaymentReceiptEmail itself: the shared no-email / missing-row guards.
// ============================================================================
console.log("\ndispatchPaymentReceiptEmail guards:");
{
  const { dispatchPaymentReceiptEmail } = await import("../src/lib/notifications.ts");

  const company = seedCompany();
  const customer = seedCustomer(company.id, { email: null });
  const invoice = seedInvoice(company.id, customer.id, { status: "paid", paidAt: new Date() });

  resetEmails();
  await dispatchPaymentReceiptEmail(invoice.id, company.id);
  check("dispatch sends nothing for a customer without an email", receipts().length === 0, `sent ${receipts().length}`);

  resetEmails();
  await dispatchPaymentReceiptEmail(999999, company.id);
  check("dispatch sends nothing for a missing invoice", receipts().length === 0, `sent ${receipts().length}`);

  // And the positive control: with an email on file it sends exactly one.
  const emailCustomer = seedCustomer(company.id);
  const paidInvoice = seedInvoice(company.id, emailCustomer.id, { status: "paid", paidAt: new Date() });
  resetEmails();
  await dispatchPaymentReceiptEmail(paidInvoice.id, company.id);
  check("dispatch sends exactly one receipt when the customer has an email", receipts().length === 1, `sent ${receipts().length}`);
  check("that receipt is addressed to the customer", receipts()[0]?.to === emailCustomer.email, receipts()[0]?.to);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
