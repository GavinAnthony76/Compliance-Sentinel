#!/usr/bin/env node
/**
 * Unit test locking in the BRANDED HTML bodies of the two account-lifecycle
 * emails in src/lib/notifications.ts:
 *
 *   1. sendEmailVerificationEmail — the signup email-confirmation message.
 *      Must go out as a multipart send (plain-text `text` body AND an `html`
 *      body), carry GreenSynk branding (name in the header band, default
 *      green accent), and include a "Confirm my email" CTA pointing at the
 *      verify URL.
 *
 *   2. sendPasswordResetEmail — the forgot-password message. Must also be
 *      multipart, GreenSynk-branded, and include a "Reset my password" CTA
 *      pointing at the reset URL, plus the password-rules and
 *      didn't-request-this copy in both bodies.
 *
 *   3. sendPasswordChangedEmail — the post-reset security notice. Must be
 *      multipart, GreenSynk-branded, keep the "if this wasn't you" copy and
 *      forgot-password link, and carry a "Reset my password" CTA.
 *
 *   4. sendForgotUsernameEmail — the username lookup message. Must be
 *      multipart, GreenSynk-branded, include the username (login email),
 *      account name/role, a "Sign in" CTA, and the forgot-password pointer.
 *
 * A future change that reverts any of these emails to plain text (dropping
 * `html`) or breaks its CTA link fails this suite.
 *
 * Same harness as branded-emails.test.mjs: mocks `resend` and `@workspace/db`
 * via node:test module mocking (--experimental-test-module-mocks) plus the
 * ts-resolve loader. No network or DB is touched.
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

// Neither function under test touches the DB, but notifications.ts imports
// @workspace/db at module load — mock it so no driver/connection is created.
mock.module("@workspace/db", {
  namedExports: {
    db: {
      select: () => {
        throw new Error("db access not expected in this unit test");
      },
    },
    invoicesTable: {},
    companiesTable: {},
    customersTable: {},
    invoiceLineItemsTable: {},
    usersTable: {},
  },
});

const { sendEmailVerificationEmail, sendPasswordResetEmail, sendPasswordChangedEmail, sendForgotUsernameEmail } = await import(
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

console.log("Branded email-verification & password-reset email unit test\n");

// ---------------------------------------------------------------------------
// 1. sendEmailVerificationEmail — multipart, GreenSynk-branded, verify CTA.
// ---------------------------------------------------------------------------
console.log("sendEmailVerificationEmail produces a branded multipart message:");
{
  sentEmails.length = 0;
  const verifyUrl = "https://app.greensynk.test/verify-email?token=abc123";
  const result = await sendEmailVerificationEmail({
    to: "newowner@acme.test",
    firstName: "Jamie",
    verifyUrl,
  });
  const email = sentEmails[0];

  check("exactly one email is sent", sentEmails.length === 1, `sent ${sentEmails.length}`);
  check("send is reported as delivered", result?.delivered === true, JSON.stringify(result));
  check("addressed to the new signup", email?.to === "newowner@acme.test", email?.to);
  check(
    "subject asks to confirm the email address",
    email?.subject === "Confirm your GreenSynk email address",
    email?.subject,
  );

  check(
    "a plain-text body is present (multipart)",
    typeof email?.text === "string" && email.text.includes("confirm your email address"),
  );
  check("plain-text body includes the verify URL", !!email?.text?.includes(verifyUrl));
  check(
    "plain-text body mentions the 24-hour validity window",
    !!email?.text?.includes("24 hours"),
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
    "HTML includes the confirm CTA pointing at the verify URL",
    !!html?.includes(`href="${verifyUrl}"`) && !!html?.includes("Confirm my email"),
  );
  check("HTML greets the new signup by name", !!html?.includes("Hi Jamie"));
  check(
    "HTML footer covers the didn't-sign-up case",
    !!html?.includes("you can safely ignore this email"),
  );
}

// ---------------------------------------------------------------------------
// 2. sendPasswordResetEmail — multipart, GreenSynk-branded, reset CTA.
// ---------------------------------------------------------------------------
console.log("\nsendPasswordResetEmail produces a branded multipart message:");
{
  sentEmails.length = 0;
  const resetUrl = "https://app.greensynk.test/reset-password?token=deadbeef";
  const result = await sendPasswordResetEmail({
    to: "owner@acme.test",
    firstName: "Dana",
    resetUrl,
  });
  const email = sentEmails[0];

  check("exactly one email is sent", sentEmails.length === 1, `sent ${sentEmails.length}`);
  check("send is reported as delivered", result?.delivered === true, JSON.stringify(result));
  check("addressed to the requesting user", email?.to === "owner@acme.test", email?.to);
  check(
    "subject is the reset-password subject",
    email?.subject === "Reset your GreenSynk password",
    email?.subject,
  );

  check(
    "a plain-text body is present (multipart)",
    typeof email?.text === "string" && email.text.includes("reset the password"),
  );
  check("plain-text body includes the reset URL", !!email?.text?.includes(resetUrl));
  check(
    "plain-text body mentions the 1-hour validity window",
    !!email?.text?.includes("valid for 1 hour"),
  );
  check(
    "plain-text body includes the password rules",
    !!email?.text?.includes("at least 8 characters"),
  );
  check(
    "plain-text body reassures non-requesters",
    !!email?.text?.includes("Your password will not change"),
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
    "HTML includes the reset CTA pointing at the reset URL",
    !!html?.includes(`href="${resetUrl}"`) && !!html?.includes("Reset my password"),
  );
  check("HTML greets the user by name", !!html?.includes("Hi Dana"));
  check(
    "HTML includes the password rules",
    !!html?.includes("at least 8 characters"),
  );
  check(
    "HTML footer reassures non-requesters",
    !!html?.includes("Your password will not change"),
  );
}

// ---------------------------------------------------------------------------
// 3. sendPasswordChangedEmail — multipart, GreenSynk-branded, security copy.
// ---------------------------------------------------------------------------
console.log("\nsendPasswordChangedEmail produces a branded multipart message:");
{
  sentEmails.length = 0;
  const forgotPasswordUrl = "https://app.greensynk.test/forgot-password";
  const result = await sendPasswordChangedEmail({
    to: "owner@acme.test",
    firstName: "Dana",
  });
  const email = sentEmails[0];

  check("exactly one email is sent", sentEmails.length === 1, `sent ${sentEmails.length}`);
  check("send is reported as delivered", result?.delivered === true, JSON.stringify(result));
  check("addressed to the account owner", email?.to === "owner@acme.test", email?.to);
  check(
    "subject confirms the password change",
    email?.subject === "Your GreenSynk password was changed",
    email?.subject,
  );

  check(
    "a plain-text body is present (multipart)",
    typeof email?.text === "string" && email.text.includes("was successfully changed"),
  );
  check(
    "plain-text body names the account email",
    !!email?.text?.includes("(owner@acme.test)"),
  );
  check(
    "plain-text body includes the changed-at timestamp",
    !!email?.text?.includes("Password changed at:"),
  );
  check(
    "plain-text body keeps the if-this-wasn't-you security copy",
    !!email?.text?.includes("did NOT request this change"),
  );
  check(
    "plain-text body includes the forgot-password link",
    !!email?.text?.includes(forgotPasswordUrl),
  );

  const html = email?.html;
  check("an HTML body is present (multipart)", typeof html === "string" && html.length > 0);
  check("HTML is a full document", !!html?.includes("<!DOCTYPE html>"));
  check("HTML carries GreenSynk branding in the header", !!html?.includes(">GreenSynk</span>"));
  check(
    "HTML header band uses the GreenSynk green accent",
    !!html?.includes(`background-color:${GREENSYNK_GREEN}`),
  );
  check("HTML greets the user by name", !!html?.includes("Hi Dana"));
  check(
    "HTML keeps the if-this-wasn't-you security copy",
    !!html?.includes("did NOT request this change"),
  );
  check(
    "HTML includes a reset CTA pointing at forgot-password",
    !!html?.includes(`href="${forgotPasswordUrl}"`) && !!html?.includes("Reset my password"),
  );
}

// ---------------------------------------------------------------------------
// 4. sendForgotUsernameEmail — multipart, GreenSynk-branded, username + reset pointer.
// ---------------------------------------------------------------------------
console.log("\nsendForgotUsernameEmail produces a branded multipart message:");
{
  sentEmails.length = 0;
  const loginUrl = "https://app.greensynk.test/login";
  const forgotPasswordUrl = "https://app.greensynk.test/forgot-password";
  const result = await sendForgotUsernameEmail({
    to: "manager@acme.test",
    firstName: "Riley",
    lastName: "Moss",
    role: "manager",
  });
  const email = sentEmails[0];

  check("exactly one email is sent", sentEmails.length === 1, `sent ${sentEmails.length}`);
  check("send is reported as delivered", result?.delivered === true, JSON.stringify(result));
  check("addressed to the requesting user", email?.to === "manager@acme.test", email?.to);
  check(
    "subject is the login-details subject",
    email?.subject === "Your GreenSynk login (username) details",
    email?.subject,
  );

  check(
    "a plain-text body is present (multipart)",
    typeof email?.text === "string" && email.text.includes("look up the login details"),
  );
  check(
    "plain-text body includes the username (login email)",
    !!email?.text?.includes("manager@acme.test"),
  );
  check(
    "plain-text body includes the account name",
    !!email?.text?.includes("Account name: Riley Moss"),
  );
  check(
    "plain-text body includes the capitalized role",
    !!email?.text?.includes("Account role: Manager"),
  );
  check("plain-text body includes the login URL", !!email?.text?.includes(loginUrl));
  check(
    "plain-text body includes the forgot-password pointer",
    !!email?.text?.includes(forgotPasswordUrl),
  );

  const html = email?.html;
  check("an HTML body is present (multipart)", typeof html === "string" && html.length > 0);
  check("HTML is a full document", !!html?.includes("<!DOCTYPE html>"));
  check("HTML carries GreenSynk branding in the header", !!html?.includes(">GreenSynk</span>"));
  check(
    "HTML header band uses the GreenSynk green accent",
    !!html?.includes(`background-color:${GREENSYNK_GREEN}`),
  );
  check("HTML greets the user by name", !!html?.includes("Hi Riley"));
  check(
    "HTML shows the username (login email)",
    !!html?.includes("manager@acme.test"),
  );
  check(
    "HTML includes a sign-in CTA pointing at the login page",
    !!html?.includes(`href="${loginUrl}"`) && !!html?.includes("Sign in"),
  );
  check(
    "HTML includes the forgot-password pointer",
    !!html?.includes(`href="${forgotPasswordUrl}"`),
  );
  check(
    "HTML footer covers the didn't-request case",
    !!html?.includes("you can safely ignore it"),
  );
}

// ---------------------------------------------------------------------------
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
