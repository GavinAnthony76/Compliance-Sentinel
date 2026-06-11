#!/usr/bin/env node
/**
 * Unit test for the proactive billing status-change emails the Stripe webhook
 * handlers send to the company owner (`dispatchBillingStatusEmail` in
 * src/lib/notifications.ts) and the change-guard that gates them
 * (`logBillingStatusFlip` in routes/billing.ts -> buildStatusFlipLog).
 *
 * Owners get a "payment failed" email whenever Stripe flips their subscription to
 * past_due, and a "you're all set" recovery email only when it climbs back from
 * past_due to active. Those two emails are fired straight from inside the signed
 * Stripe webhook handler, which makes live Stripe + DB calls, so they're
 * impractical to exercise over HTTP — exactly the situation billing-activity.test.mjs
 * handles by testing the SAME logic the route delegates to. This suite does the
 * same and locks in:
 *
 *   - ANY status -> past_due sends the "payment failed" email (failure alert).
 *   - past_due -> active sends the "you're all set" recovery email, but a
 *     non-recovery climb to active (e.g. trialing -> active) stays SILENT.
 *   - Any other transition (e.g. trialing -> active, active -> canceled) sends
 *     nothing.
 *   - No email is sent when the company has no email address on file.
 *   - The function NEVER throws — a DB failure is swallowed (webhook processing
 *     must not break because an alert couldn't be sent).
 *   - The email only fires on a genuine status flip: it reuses the SAME
 *     buildStatusFlipLog change-guard the activity feed uses, so a Stripe
 *     retry/replay of a status we already have produces neither an activity entry
 *     nor an email.
 *
 * Unlike billing-activity.ts, dispatchBillingStatusEmail does real I/O (reads the
 * company row, calls Resend), so this suite mocks @workspace/db and the `resend`
 * package via node:test module mocking (--experimental-test-module-mocks) and a
 * tiny loader that resolves the api-server's extensionless TypeScript imports.
 * No production code is changed and no network/DB is touched.
 *
 * Exit code 0 = all checks passed, 1 = at least one check failed.
 */

import { register } from "node:module";
import { mock } from "node:test";

// Resolve api-server's extensionless relative .ts imports (./logger, ./resend)
// the way esbuild does at build time, so notifications.ts can be imported here.
register("./ts-resolve.loader.mjs", import.meta.url);

// Make sendEmail take the real Resend path (creds present) so we can capture the
// outgoing payload through the mocked `resend` package below.
process.env.RESEND_API_KEY = "re_test_dummy";
process.env.RESEND_FROM_EMAIL = "noreply@greensynk.test";

// ---------------------------------------------------------------------------
// Mocks: capture outgoing emails and control the company row the function reads.
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

// Controlled by each test: the row dispatchBillingStatusEmail will "read" for the
// company, or a thrown error to simulate a DB failure.
let mockCompanyRows = [];
let mockDbThrows = false;
mock.module("@workspace/db", {
  namedExports: {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              if (mockDbThrows) throw new Error("simulated DB failure");
              return mockCompanyRows;
            },
          }),
        }),
      }),
    },
    invoicesTable: {},
    customersTable: {},
    companiesTable: { id: "id" },
  },
});

const { dispatchBillingStatusEmail } = await import("../src/lib/notifications.ts");
const { buildStatusFlipLog } = await import("../src/lib/billing-activity.ts");

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

// Run dispatchBillingStatusEmail against a given company row and transition,
// returning the emails it sent (and clearing the capture buffer first).
async function dispatch({ company, previousStatus, nextStatus, throws = false }) {
  sentEmails.length = 0;
  mockCompanyRows = company ? [company] : [];
  mockDbThrows = throws;
  await dispatchBillingStatusEmail(company?.id ?? 1, previousStatus, nextStatus);
  return sentEmails.slice();
}

const FAILURE_SUBJECT = "Action needed: your GreenSynk payment failed";
const RECOVERY_SUBJECT = "You're all set — your GreenSynk subscription is active again";

const owner = { id: 7, name: "Acme Lawn Co", email: "owner@acme.test" };

console.log("Billing status-change email unit test\n");

// ---------------------------------------------------------------------------
// 1. ANY status -> past_due sends the "payment failed" email.
// ---------------------------------------------------------------------------
console.log("A flip to past_due sends the payment-failed alert (from any prior status):");
for (const previousStatus of ["active", "trialing", "incomplete", null]) {
  const emails = await dispatch({ company: owner, previousStatus, nextStatus: "past_due" });
  check(
    `${previousStatus ?? "null"} -> past_due sends exactly one email`,
    emails.length === 1,
    `sent ${emails.length}`,
  );
  check(
    `${previousStatus ?? "null"} -> past_due uses the payment-failed subject`,
    emails[0]?.subject === FAILURE_SUBJECT,
    emails[0]?.subject,
  );
  check(
    `${previousStatus ?? "null"} -> past_due is addressed to the company owner`,
    emails[0]?.to === owner.email,
    emails[0]?.to,
  );
}

// ---------------------------------------------------------------------------
// 2. Recovery email ONLY on past_due -> active.
// ---------------------------------------------------------------------------
console.log("\nA recovery email is sent only when climbing back from past_due to active:");
{
  const emails = await dispatch({ company: owner, previousStatus: "past_due", nextStatus: "active" });
  check("past_due -> active sends exactly one email", emails.length === 1, `sent ${emails.length}`);
  check("past_due -> active uses the recovery subject", emails[0]?.subject === RECOVERY_SUBJECT, emails[0]?.subject);
  check("recovery email is addressed to the company owner", emails[0]?.to === owner.email, emails[0]?.to);
}

console.log("\nA non-recovery climb to active stays silent:");
for (const previousStatus of ["trialing", "incomplete", "active", null]) {
  const emails = await dispatch({ company: owner, previousStatus, nextStatus: "active" });
  check(
    `${previousStatus ?? "null"} -> active sends NO email`,
    emails.length === 0,
    `sent ${emails.length} (${emails[0]?.subject ?? ""})`,
  );
}

console.log("\nAny other transition sends nothing:");
{
  const canceled = await dispatch({ company: owner, previousStatus: "active", nextStatus: "canceled" });
  check("active -> canceled sends NO email", canceled.length === 0, `sent ${canceled.length}`);
  const trialing = await dispatch({ company: owner, previousStatus: "incomplete", nextStatus: "trialing" });
  check("incomplete -> trialing sends NO email", trialing.length === 0, `sent ${trialing.length}`);
}

// ---------------------------------------------------------------------------
// 3. No email when there is no address on file; errors are swallowed.
// ---------------------------------------------------------------------------
console.log("\nNo email is sent when the company has no email address on file:");
{
  const noEmail = await dispatch({
    company: { id: 9, name: "No Email Co", email: null },
    previousStatus: "active",
    nextStatus: "past_due",
  });
  check("a past_due flip with no owner email sends nothing", noEmail.length === 0, `sent ${noEmail.length}`);

  const missingCompany = await dispatch({ company: null, previousStatus: "active", nextStatus: "past_due" });
  check("a missing company row sends nothing", missingCompany.length === 0, `sent ${missingCompany.length}`);
}

console.log("\nA DB failure is swallowed — dispatchBillingStatusEmail never throws:");
{
  let threw = false;
  let emails = [];
  try {
    emails = await dispatch({ company: owner, previousStatus: "active", nextStatus: "past_due", throws: true });
  } catch {
    threw = true;
  }
  check("a DB error does not propagate out of dispatchBillingStatusEmail", threw === false);
  check("no email is sent when the company lookup fails", emails.length === 0, `sent ${emails.length}`);
}

// ---------------------------------------------------------------------------
// 4. The email fires only on a genuine flip (reuses buildStatusFlipLog guard).
// ---------------------------------------------------------------------------
// logBillingStatusFlip (routes/billing.ts) computes buildStatusFlipLog and bails
// (`if (!log) return;`) before it ever calls dispatchBillingStatusEmail. So the
// SAME change-guard that stops double-logging the activity feed is what stops a
// Stripe retry/replay from re-emailing the owner. We exercise that wiring here:
// run the flip through the guard, and only dispatch the email when the guard
// produced a log — mirroring the route — then assert the email count.
console.log("\nThe owner email follows the buildStatusFlipLog change-guard (no email on retries/replays):");

async function flipAndMaybeEmail({ storedStatus, nextStatus }) {
  const company = { id: 77, subscriptionPlan: "growth", subscriptionStatus: storedStatus, name: "Acme", email: owner.email };
  const log = buildStatusFlipLog({ company, nextStatus });
  sentEmails.length = 0;
  mockCompanyRows = [company];
  mockDbThrows = false;
  // The route only emails when the change-guard confirms a genuine flip.
  if (log) {
    await dispatchBillingStatusEmail(company.id, storedStatus, nextStatus);
  }
  return { logged: log !== null, emails: sentEmails.slice() };
}

{
  // Genuine flip active -> past_due: guard logs AND owner is emailed.
  const r = await flipAndMaybeEmail({ storedStatus: "active", nextStatus: "past_due" });
  check("genuine active -> past_due flip passes the change-guard", r.logged === true);
  check("genuine active -> past_due flip emails the owner once", r.emails.length === 1, `sent ${r.emails.length}`);
  check("the flip email is the payment-failed alert", r.emails[0]?.subject === FAILURE_SUBJECT, r.emails[0]?.subject);
}
{
  // Replay: Stripe re-delivers past_due when we already store past_due. The guard
  // returns null, so the route never reaches the email call.
  const r = await flipAndMaybeEmail({ storedStatus: "past_due", nextStatus: "past_due" });
  check("a replayed past_due event is suppressed by the change-guard", r.logged === false, JSON.stringify(r.logged));
  check("a replayed past_due event sends NO duplicate email", r.emails.length === 0, `sent ${r.emails.length}`);
}
{
  // Genuine recovery past_due -> active: guard logs AND recovery email is sent.
  const r = await flipAndMaybeEmail({ storedStatus: "past_due", nextStatus: "active" });
  check("genuine past_due -> active recovery passes the change-guard", r.logged === true);
  check("genuine recovery emails the owner once", r.emails.length === 1, `sent ${r.emails.length}`);
  check("the recovery flip email is the all-set message", r.emails[0]?.subject === RECOVERY_SUBJECT, r.emails[0]?.subject);
}
{
  // Redundant active event matching stored active: guard returns null -> no email.
  const r = await flipAndMaybeEmail({ storedStatus: "active", nextStatus: "active" });
  check("a redundant active event is suppressed by the change-guard", r.logged === false, JSON.stringify(r.logged));
  check("a redundant active event sends NO email", r.emails.length === 0, `sent ${r.emails.length}`);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
