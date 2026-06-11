// Pure decision logic for the billing activity-feed entries written from the
// Stripe webhook handlers (see routes/billing.ts). These functions are kept
// free of any DB / Stripe / network access so the attribution rules and the
// de-duplication guard can be unit-tested directly (tests/billing-activity.test.mjs),
// the same way lead-access.ts is tested in lead-ownership.test.mjs. The webhook
// handlers do the I/O (read company, update DB) and delegate every "what should
// the activity entry look like, and should we even write one?" decision here.

export type LogActivityOpts = {
  companyId?: number;
  userId?: number;
  adminId?: number;
  action: string;
  entityType?: string;
  entityId?: number;
  metadata?: Record<string, any>;
};

// checkout.session.completed — a manager finished checkout for a plan. The
// acting user's id is carried in the session metadata (webhooks have no session),
// so we attribute the change to them. When there is no acting user (e.g. an
// automated/back-office flow), it is attributed to "Stripe / automated".
export function buildPlanChangedLog(input: {
  companyId: number;
  plan: string;
  previousPlan: string | null;
  status: string;
  actingUserId?: number;
}): LogActivityOpts {
  const { companyId, plan, previousPlan, status, actingUserId } = input;
  return {
    companyId,
    userId: actingUserId,
    action: "billing.plan_changed",
    entityType: "company",
    entityId: companyId,
    metadata: {
      plan,
      previousPlan,
      status,
      actor: actingUserId ? undefined : "Stripe / automated",
    },
  };
}

// customer.subscription.updated / .created — Stripe pushed the current state of
// the subscription. This fires moments after a checkout (which already logged
// billing.plan_changed) AND for genuine later changes (status flips, scheduled
// cancellations, portal plan swaps). Returns null when nothing meaningful
// actually changed versus what we have stored, which is what prevents a single
// checkout flow from producing both a plan_changed AND a subscription_updated
// entry. These come straight from Stripe, so there is no acting user.
export function buildSubscriptionUpdatedLog(input: {
  before: {
    id: number;
    subscriptionPlan: string | null;
    subscriptionStatus: string | null;
    cancelAtPeriodEnd: boolean | null;
  };
  sub: {
    status: string;
    cancel_at_period_end?: boolean | null;
    metadata?: { plan?: string } | null;
  };
}): LogActivityOpts | null {
  const { before, sub } = input;
  const nextPlan = sub.metadata?.plan || before.subscriptionPlan;
  const planChanged = nextPlan !== before.subscriptionPlan;
  const statusChanged = sub.status !== before.subscriptionStatus;
  const cancelScheduleChanged = !!sub.cancel_at_period_end !== !!before.cancelAtPeriodEnd;
  if (!planChanged && !statusChanged && !cancelScheduleChanged) return null;
  return {
    companyId: before.id,
    action: "billing.subscription_updated",
    entityType: "company",
    entityId: before.id,
    metadata: {
      plan: nextPlan,
      previousPlan: planChanged ? before.subscriptionPlan : undefined,
      status: sub.status,
      previousStatus: statusChanged ? before.subscriptionStatus : undefined,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      actor: "Stripe / automated",
    },
  };
}

// invoice.paid / invoice.payment_succeeded / invoice.payment_failed — Stripe
// finalized (or failed) a subscription invoice, which flips the company's billing
// status (e.g. active → past_due, or trialing/past_due → active). Returns null
// when the next status matches what we already have stored. That change-guard is
// what prevents double-logging when Stripe emits BOTH a customer.subscription.updated
// AND an invoice.* event for the same flip — whichever handler runs first records
// it, the other becomes a no-op. These are automated events with no acting user.
export function buildStatusFlipLog(input: {
  company: {
    id: number;
    subscriptionPlan: string | null;
    subscriptionStatus: string | null;
  };
  nextStatus: string;
}): LogActivityOpts | null {
  const { company, nextStatus } = input;
  if (company.subscriptionStatus === nextStatus) return null;
  return {
    companyId: company.id,
    action: "billing.subscription_updated",
    entityType: "company",
    entityId: company.id,
    metadata: {
      plan: company.subscriptionPlan,
      status: nextStatus,
      previousStatus: company.subscriptionStatus,
      actor: "Stripe / automated",
    },
  };
}

// customer.subscription.deleted — the subscription was canceled at Stripe. This
// is always an automated event (no acting user).
export function buildSubscriptionCanceledLog(input: {
  company: {
    id: number;
    subscriptionPlan: string | null;
    subscriptionStatus: string | null;
  };
}): LogActivityOpts {
  const { company } = input;
  return {
    companyId: company.id,
    action: "billing.subscription_canceled",
    entityType: "company",
    entityId: company.id,
    metadata: {
      plan: company.subscriptionPlan,
      previousStatus: company.subscriptionStatus,
      actor: "Stripe / automated",
    },
  };
}
