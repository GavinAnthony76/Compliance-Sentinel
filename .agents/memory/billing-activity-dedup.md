---
name: Billing activity-feed de-duplication
description: Why checkout + subscription.updated don't double-log, and how the billing activity logic is structured for testing
---

# Billing activity-feed de-duplication

The Stripe webhook handlers (`artifacts/api-server/src/routes/billing.ts`) write
billing.* entries to the activity feed. The decision logic lives in pure helpers
in `src/lib/billing-activity.ts` (buildPlanChangedLog / buildSubscriptionUpdatedLog
/ buildSubscriptionCanceledLog), unit-tested in `tests/billing-activity.test.mjs`.

**The de-dup guarantee depends on ordering, not on a dedicated dedup table.**
On a single checkout flow Stripe fires checkout.session.completed AND
customer.subscription.updated back-to-back. checkout.session.completed updates the
company row to the new plan/status FIRST, then logs billing.plan_changed. When the
follow-up subscription.updated handler runs, it reads the (already-updated) company
as `before` and compares it to the incoming subscription — plan/status/cancel flag
all match, so buildSubscriptionUpdatedLog returns null and no second entry is written.

**Why:** without this change-guard every checkout would produce both a plan_changed
AND a subscription_updated entry for the same event.

**How to apply:** if you ever move the DB update to AFTER the subscription.updated
log, or stop reading the pre-update company snapshot, the guard breaks and duplicates
return. The guard compares against STORED state, so it only works because the company
row is updated before the comparison happens. `logBillingStatusFlip` (invoice.* paths)
has its own separate guard (compares stored subscriptionStatus to nextStatus) and is
NOT yet unit-tested.
