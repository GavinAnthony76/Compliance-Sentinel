#!/usr/bin/env node
/**
 * Unit test for the billing activity-feed decision logic
 * (`src/lib/billing-activity.ts`) that the Stripe webhook handlers in
 * routes/billing.ts delegate to.
 *
 * Plan changes, subscription status flips, and cancellations are written to the
 * activity feed from inside the Stripe webhook handler. Those handlers can only
 * run on real signed webhook events (and make live Stripe + DB calls), so they
 * are impractical to exercise over HTTP — exactly the situation that
 * lead-ownership.test.mjs handles by testing the SAME pure logic the routes use
 * directly. This suite does the same: it imports the helpers the handlers call
 * and locks in:
 *
 *   - checkout.session.completed -> billing.plan_changed attributed to the
 *     acting userId from the session metadata (and to "Stripe / automated" when
 *     there is no acting user).
 *   - customer.subscription.updated -> billing.subscription_updated ONLY when the
 *     plan, status, or scheduled-cancellation flag actually changed, always
 *     attributed to "Stripe / automated".
 *   - customer.subscription.deleted -> billing.subscription_canceled.
 *   - invoice.paid / invoice.payment_succeeded / invoice.payment_failed ->
 *     billing.subscription_updated ONLY when the next status differs from the
 *     stored status (active -> past_due logs; a redundant event matching the
 *     stored status logs nothing), always attributed to "Stripe / automated".
 *   - The de-duplication guard: a single checkout flow (checkout logs
 *     plan_changed, then the follow-up subscription.updated reflects the SAME
 *     state) produces NO second subscription_updated entry.
 *
 * Node strips the TypeScript types on import, so no build step is required.
 *
 * Exit code 0 = all checks passed, 1 = at least one check failed.
 */

import {
  buildPlanChangedLog,
  buildSubscriptionUpdatedLog,
  buildSubscriptionCanceledLog,
  buildStatusFlipLog,
} from "../src/lib/billing-activity.ts";

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

console.log("Billing activity logging unit test\n");

// ---------------------------------------------------------------------------
// 1. checkout.session.completed -> billing.plan_changed
// ---------------------------------------------------------------------------
console.log("checkout.session.completed logs plan_changed attributed to the acting user:");
{
  const log = buildPlanChangedLog({
    companyId: 42,
    plan: "growth",
    previousPlan: "starter",
    status: "active",
    actingUserId: 7,
  });
  check("action is billing.plan_changed", log.action === "billing.plan_changed", log.action);
  check("scoped to the company", log.companyId === 42 && log.entityId === 42 && log.entityType === "company");
  check("attributed to the acting userId from session metadata", log.userId === 7, `userId ${log.userId}`);
  check("no 'Stripe / automated' actor when a user is present", log.metadata.actor === undefined, String(log.metadata.actor));
  check("records the new plan and previous plan", log.metadata.plan === "growth" && log.metadata.previousPlan === "starter");
  check("records the subscription status", log.metadata.status === "active");
}

console.log("\ncheckout with no acting user falls back to 'Stripe / automated':");
{
  const log = buildPlanChangedLog({
    companyId: 42,
    plan: "pro",
    previousPlan: null,
    status: "trialing",
    actingUserId: undefined,
  });
  check("no userId attributed", log.userId === undefined, String(log.userId));
  check("actor is 'Stripe / automated'", log.metadata.actor === "Stripe / automated", String(log.metadata.actor));
  check("null previousPlan is preserved", log.metadata.previousPlan === null);
}

// ---------------------------------------------------------------------------
// 2. customer.subscription.updated -> billing.subscription_updated (change-guard)
// ---------------------------------------------------------------------------
console.log("\ncustomer.subscription.updated logs ONLY when something actually changed:");

const baseCompany = {
  id: 99,
  subscriptionPlan: "growth",
  subscriptionStatus: "active",
  cancelAtPeriodEnd: false,
};

// 2a. Nothing changed -> no log (this is the de-dup guard in isolation).
{
  const log = buildSubscriptionUpdatedLog({
    before: baseCompany,
    sub: { status: "active", cancel_at_period_end: false, metadata: { plan: "growth" } },
  });
  check("identical state produces NO log entry", log === null, JSON.stringify(log));
}

// 2b. Status flip -> log, attributed to Stripe.
{
  const log = buildSubscriptionUpdatedLog({
    before: baseCompany,
    sub: { status: "past_due", cancel_at_period_end: false, metadata: { plan: "growth" } },
  });
  check("status change produces a log", log !== null);
  check("action is billing.subscription_updated", log?.action === "billing.subscription_updated");
  check("attributed to 'Stripe / automated'", log?.metadata.actor === "Stripe / automated");
  check("no acting user on an automated update", log?.userId === undefined);
  check("records new and previous status", log?.metadata.status === "past_due" && log?.metadata.previousStatus === "active");
  check("previousPlan omitted when plan did not change", log?.metadata.previousPlan === undefined);
}

// 2c. Plan change via the customer portal -> log.
{
  const log = buildSubscriptionUpdatedLog({
    before: baseCompany,
    sub: { status: "active", cancel_at_period_end: false, metadata: { plan: "pro" } },
  });
  check("plan change produces a log", log !== null);
  check("records new and previous plan", log?.metadata.plan === "pro" && log?.metadata.previousPlan === "growth");
  check("previousStatus omitted when status did not change", log?.metadata.previousStatus === undefined);
}

// 2d. Scheduled cancellation toggled on -> log.
{
  const log = buildSubscriptionUpdatedLog({
    before: baseCompany,
    sub: { status: "active", cancel_at_period_end: true, metadata: { plan: "growth" } },
  });
  check("scheduled-cancellation toggle produces a log", log !== null);
  check("records cancelAtPeriodEnd", log?.metadata.cancelAtPeriodEnd === true);
}

// 2e. Missing sub.metadata.plan falls back to the stored plan (no false change).
{
  const log = buildSubscriptionUpdatedLog({
    before: baseCompany,
    sub: { status: "active", cancel_at_period_end: false, metadata: null },
  });
  check("absent metadata.plan does not fabricate a plan change", log === null, JSON.stringify(log));
}

// ---------------------------------------------------------------------------
// 3. customer.subscription.deleted -> billing.subscription_canceled
// ---------------------------------------------------------------------------
console.log("\ncustomer.subscription.deleted logs subscription_canceled:");
{
  const log = buildSubscriptionCanceledLog({
    company: { id: 99, subscriptionPlan: "growth", subscriptionStatus: "past_due" },
  });
  check("action is billing.subscription_canceled", log.action === "billing.subscription_canceled");
  check("scoped to the company", log.companyId === 99 && log.entityId === 99 && log.entityType === "company");
  check("attributed to 'Stripe / automated'", log.metadata.actor === "Stripe / automated");
  check("records the plan and the status it was canceled from", log.metadata.plan === "growth" && log.metadata.previousStatus === "past_due");
}

// ---------------------------------------------------------------------------
// 4. invoice.paid / invoice.payment_succeeded / invoice.payment_failed ->
//    billing.subscription_updated (logBillingStatusFlip change-guard)
// ---------------------------------------------------------------------------
console.log("\ninvoice.* webhooks log a status flip ONLY when the status actually changed:");

const flipCompany = {
  id: 77,
  subscriptionPlan: "growth",
  subscriptionStatus: "active",
};

// 4a. invoice.payment_failed flips active -> past_due: logs once, attributed to Stripe.
{
  const log = buildStatusFlipLog({ company: flipCompany, nextStatus: "past_due" });
  check("a flip to a new status produces a log", log !== null, JSON.stringify(log));
  check("action is billing.subscription_updated", log?.action === "billing.subscription_updated");
  check("scoped to the company", log?.companyId === 77 && log?.entityId === 77 && log?.entityType === "company");
  check("records new and previous status", log?.metadata.status === "past_due" && log?.metadata.previousStatus === "active");
  check("carries the stored plan", log?.metadata.plan === "growth");
  check("attributed to 'Stripe / automated'", log?.metadata.actor === "Stripe / automated");
  check("no acting user on an invoice-driven flip", log?.userId === undefined, String(log?.userId));
}

// 4b. Redundant event whose status matches what we already stored: NO log
//     (this is the guard that stops double-logging when Stripe emits both
//     customer.subscription.updated AND invoice.* for the same flip).
{
  const log = buildStatusFlipLog({ company: flipCompany, nextStatus: "active" });
  check("a redundant event matching the stored status produces NO log", log === null, JSON.stringify(log));
}

// 4c. invoice.paid recovering past_due -> active also logs.
{
  const recovering = { id: 78, subscriptionPlan: "pro", subscriptionStatus: "past_due" };
  const log = buildStatusFlipLog({ company: recovering, nextStatus: "active" });
  check("a recovery flip (past_due -> active) produces a log", log !== null, JSON.stringify(log));
  check("recovery records new and previous status", log?.metadata.status === "active" && log?.metadata.previousStatus === "past_due");
}

// 4d. invoice.paid on a preserved trial keeps "trialing": status unchanged -> NO log.
{
  const trialing = { id: 79, subscriptionPlan: "growth", subscriptionStatus: "trialing" };
  const log = buildStatusFlipLog({ company: trialing, nextStatus: "trialing" });
  check("a $0 trial-start invoice does not log when status stays 'trialing'", log === null, JSON.stringify(log));
}

// ---------------------------------------------------------------------------
// 5. No duplicate plan_changed + subscription_updated for a single checkout flow
// ---------------------------------------------------------------------------
console.log("\nA single checkout flow does not double-log (plan_changed + subscription_updated):");
{
  // Step 1: checkout.session.completed fires. The handler updates the company to
  // the new plan/status and logs plan_changed for the acting user.
  const planLog = buildPlanChangedLog({
    companyId: 5,
    plan: "growth",
    previousPlan: "starter",
    status: "active",
    actingUserId: 11,
  });
  check("checkout logs exactly one plan_changed entry", planLog.action === "billing.plan_changed");

  // Step 2: Stripe immediately follows with customer.subscription.updated. By now
  // the company row ALREADY reflects the post-checkout state, so the change-guard
  // must suppress a second entry.
  const companyAfterCheckout = {
    id: 5,
    subscriptionPlan: "growth",
    subscriptionStatus: "active",
    cancelAtPeriodEnd: false,
  };
  const followUp = buildSubscriptionUpdatedLog({
    before: companyAfterCheckout,
    sub: { status: "active", cancel_at_period_end: false, metadata: { plan: "growth" } },
  });
  check("follow-up subscription.updated produces NO duplicate entry", followUp === null, JSON.stringify(followUp));
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
