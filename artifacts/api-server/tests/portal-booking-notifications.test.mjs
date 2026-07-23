#!/usr/bin/env node
/**
 * Automated tests confirming the COMPANY gets notified when a customer books
 * or cancels through the customer portal — and the customer gets a booking
 * confirmation.
 *
 * Paths under test (routes/customer-portal.ts):
 *   1. POST /portal/appointments          — sendBookingRequestNotification (to company)
 *                                           + sendBookingConfirmationEmail (to customer)
 *   2. POST /portal/appointments/:id/cancel — sendPortalCancellationNotification (to company)
 *
 * Locked-in behavior:
 *   - Company notification goes to resolveCompanyNotificationEmail's result:
 *     company.email when set, else the owner user's email, else nothing.
 *   - Customer confirmation goes to the customer's email; skipped when absent.
 *   - Failed/blocked bookings and cancellations send NOTHING.
 *   - Both notification blocks are AWAITED before the route responds
 *     (autoscale safety: post-response async work can be CPU-throttled away
 *     and silently dropped). Emails here are counted immediately after the
 *     handler resolves — no settle() queue-flush — so any regression back to
 *     fire-and-forget fails these checks.
 *
 * Like payment-receipt-email.test.mjs, I/O boundaries are mocked via
 * node:test module mocking (--experimental-test-module-mocks): `resend`
 * captures emails, @workspace/db + drizzle-orm are an in-memory store. The
 * REAL customer-portal router and REAL notifications module run.
 *
 * Exit code 0 = all checks passed, 1 = at least one check failed.
 */

import { register } from "node:module";
import { mock } from "node:test";

register("./ts-resolve.loader.mjs", import.meta.url);

// --- Environment ------------------------------------------------------------
// Real Resend path (creds present) so sendEmail reaches the mocked `resend`
// package below. NODE_ENV must NOT be "test" or sendEmail short-circuits.
process.env.RESEND_API_KEY = "re_test_dummy";
process.env.RESEND_FROM_EMAIL = "noreply@greensynk.test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "portal-booking-test-secret";
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

const BOOKING_REQUEST_PREFIX = "New booking request from";
const BOOKING_CONFIRMATION_PREFIX = "We received your booking request";
const CANCELLATION_PREFIX = "Booking cancelled by";
const bookingRequests = () => sentEmails.filter((e) => String(e.subject).startsWith(BOOKING_REQUEST_PREFIX));
const bookingConfirmations = () => sentEmails.filter((e) => String(e.subject).startsWith(BOOKING_CONFIRMATION_PREFIX));
const cancellations = () => sentEmails.filter((e) => String(e.subject).startsWith(CANCELLATION_PREFIX));
function resetEmails() {
  sentEmails.length = 0;
}

// --- In-memory database (mocked @workspace/db + drizzle-orm) -----------------
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

let nextId = 1;

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
  insert(table) {
    return {
      values(vals) {
        const rows = (Array.isArray(vals) ? vals : [vals]).map((v) => ({ id: nextId++, ...v }));
        store[table.__store].push(...rows);
        return {
          returning: async () => rows.map((r) => ({ ...r })),
          then: (resolve, reject) => Promise.resolve(rows.map((r) => ({ ...r }))).then(resolve, reject),
        };
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
  sql: Object.assign(() => ({}), { raw: () => ({}) }),
};
mock.module("drizzle-orm", { namedExports: drizzleNamedExports });

// --- Stub the router's other collaborators -----------------------------------
const passthrough = (_req, _res, next) => next();
const relativeMocks = {
  "../src/lib/auth.ts": {
    requireAuth: passthrough,
    requireRole: () => passthrough,
    hashPassword: async () => "hashed",
    verifyPassword: async () => true,
  },
  "../src/lib/features.ts": {
    requireWithinPlanLimit: () => passthrough,
    requireFeature: () => passthrough,
    hasFeature: async () => true,
    getRequiredPlanForFeature: () => "pro",
    getPlanUsageSummary: async () => ({}),
    getDowngradeViolations: async () => [],
  },
  "../src/lib/sms-consent.ts": { sendSMSWithConsent: async () => {} },
  "../src/lib/objectStorage.ts": { ObjectStorageService: class {} },
  "../src/lib/invoice-pdf.ts": { buildInvoicePdf: async () => Buffer.from("PDF") },
  "../src/lib/stripe.ts": {
    getUncachableStripeClient: async () => ({}),
    getStripePublishableKey: async () => "pk_test_dummy",
    getStripePriceId: async () => "price_dummy",
  },
};
for (const [specifier, namedExports] of Object.entries(relativeMocks)) {
  mock.module(specifier, { namedExports });
}

// --- Preflight: mock surface must cover production imports -------------------
const { assertMockCovers, assertRelativeMockCovers } = await import("./mock-surface-check.mjs");
const routeEntryFiles = ["../src/routes/customer-portal.ts"];
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

// --- Import the REAL customer-portal router ----------------------------------
const customerPortalRouter = (await import("../src/routes/customer-portal.ts")).default;

function routeHandler(router, method, path) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

const bookAppointment = routeHandler(customerPortalRouter, "post", "/appointments");
const cancelAppointment = routeHandler(customerPortalRouter, "post", "/appointments/:id/cancel");

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

// --- Seed helpers -------------------------------------------------------------
function seedCompany(overrides = {}) {
  const company = {
    id: nextId++,
    name: "Acme Lawn Co",
    slug: "acme-lawn",
    email: "office@acme.test",
    phone: "555-0100",
    logoUrl: null,
    primaryColor: null,
    ...overrides,
  };
  store.companies.push(company);
  return company;
}
function seedOwner(companyId, overrides = {}) {
  const owner = { id: nextId++, companyId, role: "owner", email: "owner@acme.test", ...overrides };
  store.users.push(owner);
  return owner;
}
function seedCustomer(companyId, overrides = {}) {
  const customer = {
    id: nextId++,
    companyId,
    firstName: "Casey",
    lastName: "Customer",
    email: "casey@customer.test",
    phone: "555-0111",
    addressLine1: "123 Green St",
    ...overrides,
  };
  store.customers.push(customer);
  return customer;
}
function seedService(companyId, overrides = {}) {
  const service = {
    id: nextId++,
    companyId,
    name: "Weekly Mowing",
    isActive: true,
    basePrice: "45.00",
    ...overrides,
  };
  store.services.push(service);
  return service;
}
function seedAppointment(companyId, customerId, serviceId, overrides = {}) {
  const appointment = {
    id: nextId++,
    companyId,
    customerId,
    serviceId,
    status: "pending",
    origin: "portal_request",
    scheduledStart: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    price: null,
    ...overrides,
  };
  store.appointments.push(appointment);
  return appointment;
}

const futureDate = () => new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
const bookReq = (customer, service, body = {}) => ({
  portal: { customerId: customer.id, companyId: customer.companyId },
  body: { serviceId: service.id, scheduledStart: futureDate(), ...body },
});

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

console.log("Portal booking/cancellation notification tests\n");

// ============================================================================
// Booking: POST /portal/appointments
// ============================================================================
console.log("Booking — company has its own email:");
{
  const company = seedCompany();
  seedOwner(company.id);
  const customer = seedCustomer(company.id);
  const service = seedService(company.id);

  resetEmails();
  const res = makeRes();
  await bookAppointment(bookReq(customer, service, { notes: "Gate code 1234" }), res);
  // NO settle(): sends must have completed BEFORE the handler resolved
  // (awaited pre-response for autoscale safety).
  check("booking responds 201", res.statusCode === 201, String(res.statusCode));
  check("company gets exactly one booking-request email (awaited pre-response)", bookingRequests().length === 1, `sent ${bookingRequests().length}`);
  check("booking request goes to company.email when set", bookingRequests()[0]?.to === company.email, bookingRequests()[0]?.to);
  check("booking request reply-to is the customer", bookingRequests()[0]?.replyTo === customer.email || bookingRequests()[0]?.reply_to === customer.email, JSON.stringify(bookingRequests()[0]));
  check("booking request names the service", String(bookingRequests()[0]?.text ?? bookingRequests()[0]?.body ?? "").includes(service.name) || String(bookingRequests()[0]?.subject).includes(customer.firstName), bookingRequests()[0]?.subject);
  check("customer gets exactly one confirmation email (awaited pre-response)", bookingConfirmations().length === 1, `sent ${bookingConfirmations().length}`);
  check("confirmation goes to the customer's email", bookingConfirmations()[0]?.to === customer.email, bookingConfirmations()[0]?.to);
}

console.log("\nBooking — company email missing, owner fallback:");
{
  const company = seedCompany({ email: null });
  const owner = seedOwner(company.id, { email: "fallback-owner@acme.test" });
  const customer = seedCustomer(company.id);
  const service = seedService(company.id);

  resetEmails();
  const res = makeRes();
  await bookAppointment(bookReq(customer, service), res);
  check("booking responds 201", res.statusCode === 201, String(res.statusCode));
  check("booking request falls back to the owner's email", bookingRequests()[0]?.to === owner.email, bookingRequests()[0]?.to);
  check("customer confirmation still sent", bookingConfirmations().length === 1, `sent ${bookingConfirmations().length}`);
}

console.log("\nBooking — no company email AND no owner:");
{
  const company = seedCompany({ email: null });
  const customer = seedCustomer(company.id);
  const service = seedService(company.id);

  resetEmails();
  const res = makeRes();
  await bookAppointment(bookReq(customer, service), res);
  check("booking still responds 201 (no notify address is not an error)", res.statusCode === 201, String(res.statusCode));
  check("no booking-request email when nobody can receive it", bookingRequests().length === 0, `sent ${bookingRequests().length}`);
  check("customer confirmation still sent", bookingConfirmations().length === 1, `sent ${bookingConfirmations().length}`);
}

console.log("\nBooking — customer without an email:");
{
  const company = seedCompany();
  const customer = seedCustomer(company.id, { email: null });
  const service = seedService(company.id);

  resetEmails();
  const res = makeRes();
  await bookAppointment(bookReq(customer, service), res);
  check("booking responds 201", res.statusCode === 201, String(res.statusCode));
  check("company still notified", bookingRequests().length === 1, `sent ${bookingRequests().length}`);
  check("no customer confirmation without an email on file", bookingConfirmations().length === 0, `sent ${bookingConfirmations().length}`);
}

console.log("\nBooking — rejected requests send nothing:");
{
  const company = seedCompany();
  seedOwner(company.id);
  const customer = seedCustomer(company.id);
  const service = seedService(company.id);

  // Past date
  resetEmails();
  const resPast = makeRes();
  await bookAppointment(bookReq(customer, service, { scheduledStart: new Date(Date.now() - 24 * 3600 * 1000).toISOString() }), resPast);
  check("past-date booking is rejected 400", resPast.statusCode === 400, String(resPast.statusCode));
  check("past-date booking sends NO emails", sentEmails.length === 0, `sent ${sentEmails.length}`);

  // Inactive service
  const inactive = seedService(company.id, { isActive: false, name: "Retired Service" });
  resetEmails();
  const resInactive = makeRes();
  await bookAppointment(bookReq(customer, inactive), resInactive);
  check("inactive-service booking is rejected 404", resInactive.statusCode === 404, String(resInactive.statusCode));
  check("inactive-service booking sends NO emails", sentEmails.length === 0, `sent ${sentEmails.length}`);
}

// ============================================================================
// Cancellation: POST /portal/appointments/:id/cancel
// ============================================================================
console.log("\nCancellation — company has its own email:");
{
  const company = seedCompany();
  seedOwner(company.id);
  const customer = seedCustomer(company.id);
  const service = seedService(company.id);
  const appointment = seedAppointment(company.id, customer.id, service.id);

  resetEmails();
  const res = makeRes();
  await cancelAppointment(
    { portal: { customerId: customer.id, companyId: company.id }, params: { id: String(appointment.id) } },
    res,
  );
  check("cancel responds 200", res.statusCode === 200, String(res.statusCode));
  check("appointment is cancelled", appointment.status === "cancelled", appointment.status);
  check("company gets exactly one cancellation email (awaited pre-response)", cancellations().length === 1, `sent ${cancellations().length}`);
  check("cancellation goes to company.email when set", cancellations()[0]?.to === company.email, cancellations()[0]?.to);
}

console.log("\nCancellation — owner-email fallback:");
{
  const company = seedCompany({ email: "   " });
  const owner = seedOwner(company.id, { email: "cancel-owner@acme.test" });
  const customer = seedCustomer(company.id);
  const service = seedService(company.id);
  const appointment = seedAppointment(company.id, customer.id, service.id, { status: "confirmed" });

  resetEmails();
  const res = makeRes();
  await cancelAppointment(
    { portal: { customerId: customer.id, companyId: company.id }, params: { id: String(appointment.id) } },
    res,
  );
  check("cancel responds 200", res.statusCode === 200, String(res.statusCode));
  check("cancellation falls back to the owner's email (blank company email)", cancellations()[0]?.to === owner.email, cancellations()[0]?.to);
}

console.log("\nCancellation — blocked cancels send nothing:");
{
  const company = seedCompany();
  seedOwner(company.id);
  const customer = seedCustomer(company.id);
  const service = seedService(company.id);

  // Company-scheduled visit: portal customers cannot cancel it.
  const companyVisit = seedAppointment(company.id, customer.id, service.id, { origin: "company" });
  resetEmails();
  const resForbidden = makeRes();
  await cancelAppointment(
    { portal: { customerId: customer.id, companyId: company.id }, params: { id: String(companyVisit.id) } },
    resForbidden,
  );
  check("company-scheduled visit cancel is 403", resForbidden.statusCode === 403, String(resForbidden.statusCode));
  check("blocked cancel sends NO emails", sentEmails.length === 0, `sent ${sentEmails.length}`);

  // Already-cancelled appointment.
  const done = seedAppointment(company.id, customer.id, service.id, { status: "cancelled" });
  resetEmails();
  const resDone = makeRes();
  await cancelAppointment(
    { portal: { customerId: customer.id, companyId: company.id }, params: { id: String(done.id) } },
    resDone,
  );
  check("already-cancelled cancel is 400", resDone.statusCode === 400, String(resDone.statusCode));
  check("already-cancelled cancel sends NO emails", sentEmails.length === 0, `sent ${sentEmails.length}`);

  // No notify address at all: cancellation still succeeds.
  const quietCompany = seedCompany({ email: null });
  const quietCustomer = seedCustomer(quietCompany.id);
  const quietService = seedService(quietCompany.id);
  const quietAppt = seedAppointment(quietCompany.id, quietCustomer.id, quietService.id);
  resetEmails();
  const resQuiet = makeRes();
  await cancelAppointment(
    { portal: { customerId: quietCustomer.id, companyId: quietCompany.id }, params: { id: String(quietAppt.id) } },
    resQuiet,
  );
  check("cancel succeeds even with no notify address", resQuiet.statusCode === 200 && quietAppt.status === "cancelled", `${resQuiet.statusCode}/${quietAppt.status}`);
  check("no cancellation email when nobody can receive it", cancellations().length === 0, `sent ${cancellations().length}`);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
