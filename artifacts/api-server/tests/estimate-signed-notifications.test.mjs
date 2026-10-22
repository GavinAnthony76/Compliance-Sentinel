#!/usr/bin/env node
/**
 * Automated tests for the emails sent when a customer signs an estimate through
 * its public share link (POST /public/estimates/:token/sign in
 * routes/public-estimates.ts).
 *
 * Locks in:
 *   - The business "estimate accepted" notice uses the established recipient
 *     rule (resolveCompanyNotificationEmail): company.email when set, else the
 *     owner user's email, else no business notice at all.
 *   - The notice only claims "A signed copy is attached" when the PDF was built.
 *   - The customer gets their signed copy, and the signing response only says
 *     "emailed" when that delivery actually succeeded.
 *
 * I/O boundaries are mocked via node:test module mocking
 * (--experimental-test-module-mocks): `resend` captures outgoing emails,
 * `@workspace/db` + `drizzle-orm` are an in-memory store, and the estimate PDF
 * builder is stubbed. No network or database is touched.
 *
 * Exit code 0 = all checks passed, 1 = at least one check failed.
 */

import { register } from "node:module";
import { mock } from "node:test";
import crypto from "node:crypto";

register("./ts-resolve.loader.mjs", import.meta.url);

// Real Resend path (creds present) so sendEmail reaches the mocked `resend`
// package below. NODE_ENV must NOT be "test" or sendEmail short-circuits.
process.env.RESEND_API_KEY = "re_test_dummy";
process.env.RESEND_FROM_EMAIL = "noreply@greensynk.test";
delete process.env.NODE_ENV;

// --- Email capture (mocked `resend` package) --------------------------------
const sentEmails = [];
let rejectRecipient = null;
mock.module("resend", {
  namedExports: {
    Resend: class {
      constructor() {
        this.emails = {
          send: async (payload) => {
            if (rejectRecipient && payload.to === rejectRecipient) {
              return { error: { message: "rejected by provider (test)" } };
            }
            sentEmails.push(payload);
            return { error: null };
          },
        };
      }
    },
  },
});

const businessNotices = () => sentEmails.filter((e) => /^Estimate .* accepted by /.test(String(e.subject)));
const customerCopies = () => sentEmails.filter((e) => String(e.subject).startsWith("Your signed estimate"));
function resetEmails() {
  sentEmails.length = 0;
}

// --- In-memory database (mocked @workspace/db + drizzle-orm) -----------------
const store = { companies: [], customers: [], users: [], estimates: [], estimateLineItems: [] };

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
  usersTable: makeTable("users"),
  estimatesTable: makeTable("estimates"),
  estimateLineItemsTable: makeTable("estimateLineItems"),
  invoicesTable: makeTable("invoices"),
  invoiceLineItemsTable: makeTable("invoiceLineItems"),
  smsConsentEventsTable: makeTable("smsConsentEvents"),
};
mock.module("@workspace/db", { namedExports: dbNamedExports });

const drizzleNamedExports = {
  eq: (col, val) => (row) => row[col.__col] === val,
  ne: (col, val) => (row) => row[col.__col] !== val,
  and: (...preds) => (row) => preds.every((p) => !p || p(row)),
  isNull: (col) => (row) => row[col.__col] == null,
  sql: Object.assign(() => ({}), { raw: () => ({}) }),
};
mock.module("drizzle-orm", { namedExports: drizzleNamedExports });

// --- Stub the router's other collaborators -----------------------------------
let pdfShouldFail = false;
const relativeMocks = {
  "../src/lib/estimate-pdf.ts": {
    buildEstimatePdf: async () => {
      if (pdfShouldFail) throw new Error("pdf failure (test)");
      return Buffer.from("PDF");
    },
  },
  "../src/lib/activity.ts": { logActivity: async () => {} },
};
for (const [specifier, namedExports] of Object.entries(relativeMocks)) {
  mock.module(specifier, { namedExports });
}

// --- Preflight: mock surface must cover production imports -------------------
const { assertMockCovers, assertRelativeMockCovers } = await import("./mock-surface-check.mjs");
const routeEntryFiles = ["../src/routes/public-estimates.ts"];
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

// --- Import the REAL public-estimates router ---------------------------------
const publicEstimatesRouter = (await import("../src/routes/public-estimates.ts")).default;

function routeHandler(router, method, path) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}
const signEstimate = routeHandler(publicEstimatesRouter, "post", "/estimates/:token/sign");

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
  };
  return res;
}

// --- Seed helpers -------------------------------------------------------------
let nextId = 1;
const SIGNATURE = "data:image/png;base64,iVBORw0KGgo=";

function seedScenario({ companyEmail = "office@acme.test", ownerEmail = "owner@acme.test", customerEmail = "casey@customer.test" } = {}) {
  const company = { id: nextId++, name: "Acme Lawn Co", email: companyEmail };
  store.companies.push(company);
  if (ownerEmail) store.users.push({ id: nextId++, companyId: company.id, role: "owner", email: ownerEmail });
  const customer = { id: nextId++, companyId: company.id, firstName: "Casey", lastName: "Customer", email: customerEmail };
  store.customers.push(customer);
  const raw = crypto.randomBytes(16).toString("hex");
  const estimate = {
    id: nextId++,
    companyId: company.id,
    customerId: customer.id,
    estimateNumber: `EST-${nextId}`,
    status: "sent",
    subtotal: "100.00",
    tax: "0.00",
    total: "100.00",
    validUntil: null,
    notes: null,
    signedAt: null,
    signerName: null,
    signatureData: null,
    publicToken: crypto.createHash("sha256").update(raw).digest("hex"),
  };
  store.estimates.push(estimate);
  return { company, customer, estimate, raw };
}

async function sign(raw) {
  const res = makeRes();
  await signEstimate({ params: { token: raw }, body: { signerName: "Casey Customer", signatureData: SIGNATURE } }, res);
  return res;
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

console.log("Signed-estimate notification tests\n");

console.log("Company email set:");
{
  const { company, customer, raw } = seedScenario();
  resetEmails();
  const res = await sign(raw);
  check("signing succeeds", res.statusCode === 200 && res.body?.success === true, JSON.stringify(res.body));
  check("business notice goes to the company email", businessNotices().length === 1 && businessNotices()[0].to === company.email, JSON.stringify(businessNotices().map((e) => e.to)));
  check("business notice mentions the attached signed copy", /signed copy is attached/i.test(businessNotices()[0]?.text ?? ""), businessNotices()[0]?.text);
  check("customer receives their signed copy", customerCopies().length === 1 && customerCopies()[0].to === customer.email);
  check("response says the copy was emailed", /emailed/i.test(res.body?.message ?? ""), res.body?.message);
  check("response reports signedCopyEmailed=true", res.body?.signedCopyEmailed === true, JSON.stringify(res.body));
}

console.log("\nCompany email missing — owner fallback:");
{
  const { raw } = seedScenario({ companyEmail: null, ownerEmail: "fallback-owner@acme.test" });
  resetEmails();
  await sign(raw);
  check("business notice falls back to the owner's email", businessNotices().length === 1 && businessNotices()[0].to === "fallback-owner@acme.test", JSON.stringify(businessNotices().map((e) => e.to)));
}
{
  const { raw } = seedScenario({ companyEmail: "   ", ownerEmail: "blank-owner@acme.test" });
  resetEmails();
  await sign(raw);
  check("a blank company email also falls back to the owner", businessNotices()[0]?.to === "blank-owner@acme.test", JSON.stringify(businessNotices().map((e) => e.to)));
}

console.log("\nNo company email and no owner:");
{
  const { customer, raw } = seedScenario({ companyEmail: null, ownerEmail: null });
  resetEmails();
  const res = await sign(raw);
  check("signing still succeeds", res.statusCode === 200 && res.body?.success === true, JSON.stringify(res.body));
  check("no business notice is sent", businessNotices().length === 0, `sent ${businessNotices().length}`);
  check("the customer still gets their copy", customerCopies().length === 1 && customerCopies()[0].to === customer.email);
}

console.log("\nPDF build fails:");
{
  const { raw } = seedScenario();
  pdfShouldFail = true;
  resetEmails();
  await sign(raw);
  pdfShouldFail = false;
  check("business notice is still sent", businessNotices().length === 1, `sent ${businessNotices().length}`);
  check("business notice does NOT claim an attachment", !/attached/i.test(businessNotices()[0]?.text ?? ""), businessNotices()[0]?.text);
}

console.log("\nCustomer copy rejected by the provider:");
{
  const { customer, raw } = seedScenario({ customerEmail: "bounce@customer.test" });
  rejectRecipient = customer.email;
  resetEmails();
  const res = await sign(raw);
  rejectRecipient = null;
  check("signing still succeeds", res.statusCode === 200 && res.body?.success === true, JSON.stringify(res.body));
  check("response does NOT claim the copy was emailed", !/emailed/i.test(res.body?.message ?? ""), res.body?.message);
  check("response reports signedCopyEmailed=false while the customer HAS an email", res.body?.signedCopyEmailed === false && res.body?.customerHasEmail === true, JSON.stringify(res.body));
  check("the signature is still persisted", store.estimates.find((e) => e.customerId === customer.id)?.signedAt != null);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
