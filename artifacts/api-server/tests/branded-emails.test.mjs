#!/usr/bin/env node
/**
 * Unit test locking in the BRANDED HTML bodies of two owner-facing emails in
 * src/lib/notifications.ts:
 *
 *   1. sendWelcomeEmail — the new-company welcome message. Must go out as a
 *      multipart send (plain-text `text` body AND an `html` body), carry
 *      GreenSynk branding (name in the header band, default green accent),
 *      and include a login call-to-action button pointing at the login URL.
 *
 *   2. dispatchOwnerPaymentNotification — the "you've been paid" alert. Must
 *      also be multipart, and its HTML must REUSE the company's own branding
 *      (logoUrl rendered in the header, primaryColor as the accent color)
 *      while including the payment details (customer, invoice number, amount,
 *      date, method) and a "View in Dashboard" CTA. When the company has no
 *      logo/color, it must fall back to the company name + GreenSynk green.
 *
 * A future change that reverts either email to plain text (dropping `html`)
 * or stops threading company branding through buildBrandedEmailHtml fails
 * this suite.
 *
 * Both functions do real I/O (DB reads, Resend), so — exactly like
 * billing-status-email.test.mjs — this suite mocks `@workspace/db` and the
 * `resend` package via node:test module mocking
 * (--experimental-test-module-mocks) plus the ts-resolve loader for the
 * api-server's extensionless TypeScript imports. No network or DB is touched
 * and no production code changes.
 *
 * NOTE: NODE_ENV must NOT be "test" here — sendEmail short-circuits before
 * building the Resend payload in that mode, and we need to inspect the
 * payload (text + html) through the mocked `resend` package.
 *
 * Exit code 0 = all checks passed, 1 = at least one check failed.
 */

import { register } from "node:module";
import { mock } from "node:test";

register("./ts-resolve.loader.mjs", import.meta.url);

// Take the real Resend path so the outgoing payload (text/html) is capturable.
delete process.env.NODE_ENV;
process.env.RESEND_API_KEY = "re_test_dummy";
process.env.RESEND_FROM_EMAIL = "noreply@greensynk.test";
process.env.APP_BASE_URL = "https://app.greensynk.test";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const sentEmails = [];
const resendNamedExports = {
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
};
mock.module("resend", { namedExports: resendNamedExports });

// Table sentinels so the db mock can route each select to the right rows.
const invoicesTable = { id: "id", companyId: "companyId", customerId: "customerId" };
const companiesTable = { id: "id" };
const customersTable = { id: "id", companyId: "companyId" };
const invoiceLineItemsTable = { invoiceId: "invoiceId", sortOrder: "sortOrder" };
const usersTable = { email: "email", companyId: "companyId", role: "role" };

// Per-test rows, keyed by table sentinel.
const tableRows = new Map();

const dbNamedExports = {
  db: {
    select: () => ({
      from: (table) => ({
        where: () => ({
          limit: async () => tableRows.get(table) ?? [],
          // Line-items query (PDF attachment path). Throw so the receipt-PDF
          // generation is skipped via its documented graceful fallback — this
          // suite is about the email bodies, not the attachment.
          orderBy: async () => {
            throw new Error("line items unavailable in unit test");
          },
        }),
      }),
    }),
  },
  invoicesTable,
  companiesTable,
  customersTable,
  invoiceLineItemsTable,
  usersTable,
  smsConsentEventsTable: {},
};
mock.module("@workspace/db", { namedExports: dbNamedExports });

// Preflight: fail with an actionable message if production code grew an
// import these mocks don't provide (instead of an opaque import-time crash).
const { assertSuiteMocksCover } = await import("./mock-surface-check.mjs");
assertSuiteMocksCover({
  testFile: import.meta.url,
  entryFiles: ["../src/lib/notifications.ts"],
  packageMocks: { resend: resendNamedExports, "@workspace/db": dbNamedExports },
});

const { sendWelcomeEmail, dispatchOwnerPaymentNotification } = await import(
  "../src/lib/notifications.ts"
);

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

const GREENSYNK_GREEN = "#16a34a";

console.log("Branded welcome & owner-payment email unit test\n");

// ---------------------------------------------------------------------------
// 1. sendWelcomeEmail — multipart, GreenSynk-branded, login CTA.
// ---------------------------------------------------------------------------
console.log("sendWelcomeEmail produces a branded multipart message:");
{
  sentEmails.length = 0;
  const loginUrl = "https://app.greensynk.test/login";
  const result = await sendWelcomeEmail({
    to: "owner@acme.test",
    firstName: "Jamie",
    companyName: "Acme Lawn Co",
    loginUrl,
  });
  const email = sentEmails[0];

  check("exactly one email is sent", sentEmails.length === 1, `sent ${sentEmails.length}`);
  check("send is reported as delivered", result?.delivered === true, JSON.stringify(result));
  check("addressed to the new owner", email?.to === "owner@acme.test", email?.to);

  check(
    "a plain-text body is present (multipart)",
    typeof email?.text === "string" && email.text.includes("Welcome to GreenSynk"),
  );
  check(
    "plain-text body includes the login URL",
    email?.text?.includes(loginUrl),
  );

  const html = email?.html;
  check("an HTML body is present (multipart)", typeof html === "string" && html.length > 0);
  check("HTML is a full document", !!html?.includes("<!DOCTYPE html>"));
  check("HTML carries GreenSynk branding in the header", !!html?.includes(">GreenSynk</span>"));
  check(
    "HTML header band uses the GreenSynk green accent",
    !!html?.includes(`background-color:${GREENSYNK_GREEN}`),
  );
  check(
    "HTML includes a login CTA button",
    !!html?.includes(`href="${loginUrl}"`) && !!html?.includes("Log in to GreenSynk"),
  );
  check(
    "HTML greets the new owner and names their company",
    !!html?.includes("Hi Jamie") && !!html?.includes("Acme Lawn Co"),
  );
}

// ---------------------------------------------------------------------------
// 2. dispatchOwnerPaymentNotification — branded with COMPANY logo/color.
// ---------------------------------------------------------------------------
const invoice = {
  id: 42,
  companyId: 7,
  customerId: 5,
  invoiceNumber: "INV-1042",
  total: "245.50",
  paidAt: new Date("2026-07-20T12:00:00Z"),
  paymentMethod: "card",
};
const customer = { id: 5, firstName: "Dana", lastName: "Fields", email: "dana@customer.test" };

async function dispatchOwnerEmail(company) {
  sentEmails.length = 0;
  tableRows.set(invoicesTable, [invoice]);
  tableRows.set(companiesTable, company ? [company] : []);
  tableRows.set(customersTable, [customer]);
  await dispatchOwnerPaymentNotification(invoice.id, 7);
  return sentEmails.slice();
}

console.log("\ndispatchOwnerPaymentNotification reuses the company's branding:");
{
  const brandedCompany = {
    id: 7,
    name: "Acme Lawn Co",
    email: "owner@acme.test",
    logoUrl: "https://cdn.acme.test/logo.png",
    primaryColor: "#123abc",
  };
  const emails = await dispatchOwnerEmail(brandedCompany);
  const email = emails[0];

  check("exactly one email is sent", emails.length === 1, `sent ${emails.length}`);
  check("addressed to the company email", email?.to === brandedCompany.email, email?.to);

  check(
    "a plain-text body is present (multipart)",
    typeof email?.text === "string" && email.text.includes("you've been paid"),
  );
  check(
    "plain-text body includes amount and invoice number",
    !!email?.text?.includes("$245.50") && !!email?.text?.includes("INV-1042"),
  );

  const html = email?.html;
  check("an HTML body is present (multipart)", typeof html === "string" && html.length > 0);
  check(
    "HTML header renders the company's logoUrl",
    !!html?.includes(`src="${brandedCompany.logoUrl}"`),
  );
  check(
    "HTML accent uses the company's primaryColor",
    !!html?.includes(`background-color:${brandedCompany.primaryColor}`),
  );
  check(
    "HTML does NOT fall back to the default green accent",
    !html?.includes(`background-color:${GREENSYNK_GREEN}`),
  );
  check(
    "HTML includes the payment details",
    !!html?.includes("$245.50") &&
      !!html?.includes("INV-1042") &&
      !!html?.includes("Dana Fields") &&
      !!html?.includes(
        new Date(invoice.paidAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
      ) &&
      !!html?.includes("card"),
  );
  check(
    "HTML includes the dashboard CTA",
    !!html?.includes("View in Dashboard") &&
      !!html?.includes(`href="https://app.greensynk.test/invoices"`),
  );
}

console.log("\n…and falls back to name + GreenSynk green when the company has no branding:");
{
  const plainCompany = { id: 7, name: "Plain Co", email: "owner@plain.test", logoUrl: null, primaryColor: null };
  const emails = await dispatchOwnerEmail(plainCompany);
  const html = emails[0]?.html;

  check("email is still sent", emails.length === 1, `sent ${emails.length}`);
  check("header falls back to the company name", !!html?.includes(">Plain Co</span>"));
  check("no <img> logo is rendered", !html?.includes("<img "));
  check("accent falls back to GreenSynk green", !!html?.includes(`background-color:${GREENSYNK_GREEN}`));
}

console.log("\nNo email when the company has no address on file:");
{
  const emails = await dispatchOwnerEmail({ id: 7, name: "No Email Co", email: null });
  check("nothing is sent without a company email", emails.length === 0, `sent ${emails.length}`);
}

// ---------------------------------------------------------------------------
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
