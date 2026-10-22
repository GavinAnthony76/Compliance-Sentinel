#!/usr/bin/env node
/**
 * Unit test locking in the BRANDED team-invite email produced by
 * sendTeamInviteEmail in src/lib/notifications.ts.
 *
 * A new team member's first impression of GreenSynk is this email, so the
 * suite asserts:
 *
 *   1. With company branding (logoUrl + primaryColor): the HTML renders the
 *      company logo in the header band, uses the company's primaryColor as
 *      the accent, shows the recipient email and temporary password in the
 *      credentials box, and includes a "Log In" CTA pointing at the login URL.
 *   2. Without branding: falls back to the company name in the header and
 *      the default GreenSynk green accent — still a fully branded layout.
 *   3. The plain-text fallback body always carries the credentials (email +
 *      temporary password) and the login URL.
 *
 * A future change that reverts the invite to plain text (dropping `html`),
 * stops threading company branding through buildBrandedEmailHtml, or drops
 * the credentials from either body fails this suite.
 *
 * Exactly like branded-emails.test.mjs, the `resend` package (and
 * `@workspace/db`, imported transitively by notifications.ts) is mocked via
 * node:test module mocking (--experimental-test-module-mocks) plus the
 * ts-resolve loader. No network or DB is touched and no real email can be
 * sent — the Resend client is replaced with an in-memory capture.
 *
 * NOTE: NODE_ENV must NOT be "test" here — sendEmail short-circuits before
 * building the Resend payload in that mode, and we need to inspect the
 * payload (text + html) through the mocked `resend` package. The mock is
 * what guarantees nothing real goes out.
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

// notifications.ts imports @workspace/db at module scope; sendTeamInviteEmail
// itself never touches the DB, so an inert mock is enough.
const dbNamedExports = {
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
          orderBy: async () => [],
        }),
      }),
    }),
  },
  invoicesTable: {},
  companiesTable: {},
  customersTable: {},
  invoiceLineItemsTable: {},
  usersTable: {},
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

const { sendTeamInviteEmail } = await import("../src/lib/notifications.ts");

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

const invite = {
  to: "newstaff@acme.test",
  firstName: "Riley",
  lastName: "Nguyen",
  companyName: "Acme Lawn Co",
  temporaryPassword: "Tmp!x9K2qLm4",
  loginUrl: "https://app.greensynk.test/login",
};

console.log("Branded team-invite email unit test\n");

// ---------------------------------------------------------------------------
// 1. With company branding: logo + primaryColor drive the layout.
// ---------------------------------------------------------------------------
console.log("sendTeamInviteEmail uses the company's own branding:");
{
  sentEmails.length = 0;
  const branding = {
    logoUrl: "https://cdn.acme.test/logo.png",
    primaryColor: "#123abc",
  };
  const result = await sendTeamInviteEmail({ ...invite, ...branding });
  const email = sentEmails[0];

  check("exactly one email is sent", sentEmails.length === 1, `sent ${sentEmails.length}`);
  check("send is reported as delivered", result?.delivered === true, JSON.stringify(result));
  check("addressed to the invitee", email?.to === invite.to, email?.to);
  check(
    "subject names the company",
    !!email?.subject?.includes("Acme Lawn Co"),
    email?.subject,
  );

  const html = email?.html;
  check("an HTML body is present (multipart)", typeof html === "string" && html.length > 0);
  check("HTML is a full document", !!html?.includes("<!DOCTYPE html>"));
  check(
    "HTML header renders the company's logoUrl",
    !!html?.includes(`src="${branding.logoUrl}"`),
  );
  check(
    "HTML accent uses the company's primaryColor",
    !!html?.includes(`background-color:${branding.primaryColor}`),
  );
  check(
    "HTML does NOT fall back to the default green accent",
    !html?.includes(`background-color:${GREENSYNK_GREEN}`),
  );
  check("HTML greets the new team member", !!html?.includes("Hi Riley"));
  check(
    "HTML credentials box shows the recipient email",
    !!html?.includes(invite.to),
  );
  check(
    "HTML credentials box shows the temporary password",
    !!html?.includes(invite.temporaryPassword),
  );
  check(
    "HTML includes a Log In CTA pointing at the login URL",
    !!html?.includes(`href="${invite.loginUrl}"`) && !!html?.includes(">Log In<"),
  );
  check(
    "HTML prompts a password change after first login",
    !!html?.includes("change your password"),
  );

  const text = email?.text;
  check("a plain-text body is present (multipart)", typeof text === "string" && text.length > 0);
  check("plain-text body includes the recipient email", !!text?.includes(`Email: ${invite.to}`));
  check(
    "plain-text body includes the temporary password",
    !!text?.includes(`Temporary Password: ${invite.temporaryPassword}`),
  );
  check("plain-text body includes the login URL", !!text?.includes(invite.loginUrl));
  check("plain-text body names the company", !!text?.includes("Acme Lawn Co"));
}

// ---------------------------------------------------------------------------
// 2. Without branding: falls back to company name + GreenSynk green.
// ---------------------------------------------------------------------------
console.log("\n…and falls back to name + GreenSynk green when the company has no branding:");
{
  sentEmails.length = 0;
  await sendTeamInviteEmail({ ...invite, logoUrl: null, primaryColor: null });
  const html = sentEmails[0]?.html;

  check("email is still sent", sentEmails.length === 1, `sent ${sentEmails.length}`);
  check("header falls back to the company name", !!html?.includes(">Acme Lawn Co</span>"));
  check("no <img> logo is rendered", !html?.includes("<img "));
  check(
    "accent falls back to GreenSynk green",
    !!html?.includes(`background-color:${GREENSYNK_GREEN}`),
  );
  check(
    "credentials and CTA still present without branding",
    !!html?.includes(invite.temporaryPassword) && !!html?.includes(`href="${invite.loginUrl}"`),
  );
}

// ---------------------------------------------------------------------------
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
