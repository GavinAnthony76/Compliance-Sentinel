import { Router, type Request } from "express";
import { db, companiesTable, invoicesTable } from "@workspace/db";
import { eq, and, ne } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { getPlanUsageSummary, getDowngradeViolations } from "../lib/features";
import { getUncachableStripeClient, getStripePublishableKey, getStripePriceId } from "../lib/stripe";
import { getCatalog } from "../lib/plan-catalog";
import { logActivity } from "../lib/activity";
import { logger } from "../lib/logger";

const router = Router();

// Log a subscription status flip (e.g. active → past_due) to the activity feed,
// but only when the status actually changed from what we have stored. Stripe
// commonly emits both customer.subscription.updated AND invoice.* events for the
// same flip; the change-guard ensures whichever handler runs first records it and
// the other is a no-op, so we never double-log. These are automated events with
// no acting user, so they're attributed to "Stripe / automated".
async function logBillingStatusFlip(subscriptionId: string, nextStatus: string): Promise<void> {
  try {
    const [company] = await db.select().from(companiesTable).where(eq(companiesTable.stripeSubscriptionId, subscriptionId)).limit(1);
    if (!company || company.subscriptionStatus === nextStatus) return;
    await logActivity({
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
    });
  } catch {
    // Activity logging must never break webhook processing
  }
}

// Webhook must NOT be behind requireAuth and needs raw body
router.post("/webhook", async (req: Request, res) => {
  let stripe: any;
  try {
    stripe = await getUncachableStripeClient();
  } catch (err) {
    logger.error({ err }, "Stripe client init failed for webhook");
    return res.json({ received: true });
  }

  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // Signature verification is mandatory — an unverified body would let anyone
  // forge a "checkout.session.completed" event and grant themselves a paid
  // plan for an arbitrary companyId. Never fall back to trusting req.body.
  if (!webhookSecret) {
    logger.error("STRIPE_WEBHOOK_SECRET is not configured; refusing to process webhook");
    return res.status(503).json({ error: "WebhookMisconfigured", message: "Webhook signature verification is not configured" });
  }
  if (!sig) {
    return res.status(400).json({ error: "MissingSignature", message: "Missing Stripe-Signature header" });
  }

  let event: any;
  try {
    event = stripe.webhooks.constructEvent((req as any).rawBody || req.body, sig, webhookSecret);
  } catch (err) {
    logger.error({ err }, "Webhook signature verification failed");
    return res.status(400).json({ error: "Webhook signature verification failed" });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const companyId = Number(session.metadata?.companyId);
        const plan = session.metadata?.plan;

        // Customer portal invoice payment
        if (session.metadata?.source === "customer_portal" && session.metadata?.invoiceId) {
          const invoiceId = Number(session.metadata.invoiceId);
          if (session.payment_status === "paid" && invoiceId) {
            const paymentIntentId = typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.id;
            // Conditional update so Stripe retries/replays of the same event
            // don't fire duplicate receipt + owner notification emails: only
            // rows transitioning out of "paid" are updated and notified.
            const transitioned = await db.update(invoicesTable).set({
              status: "paid",
              paidAt: new Date(),
              paymentMethod: "card",
              stripePaymentIntentId: paymentIntentId,
              updatedAt: new Date(),
            }).where(and(eq(invoicesTable.id, invoiceId), ne(invoicesTable.status, "paid"))).returning({ id: invoicesTable.id });
            logger.info({ invoiceId, sessionId: session.id, transitioned: transitioned.length > 0 }, "Invoice marked paid via portal checkout");
            if (companyId && transitioned.length > 0) {
              const { dispatchPaymentReceiptEmail, dispatchOwnerPaymentNotification } = await import("../lib/notifications");
              dispatchPaymentReceiptEmail(invoiceId, companyId);
              dispatchOwnerPaymentNotification(invoiceId, companyId);
            }
          }
          break;
        }

        // Company subscription checkout
        if (companyId && plan) {
          const [existing] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
          const previousPlan = existing?.subscriptionPlan ?? null;
          const subscription = await stripe.subscriptions.retrieve(session.subscription);
          await db.update(companiesTable).set({
            stripeCustomerId: session.customer,
            stripeSubscriptionId: session.subscription,
            subscriptionPlan: plan,
            subscriptionStatus: subscription.status,
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
            trialEndsAt: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
            updatedAt: new Date(),
          }).where(eq(companiesTable.id, companyId));

          // Attribute the plan change to the manager who started checkout (their
          // user id was stamped into the session metadata). Webhooks arrive
          // without a session, so this is the only reliable way to know "who".
          const actingUserId = Number(session.metadata?.userId) || undefined;
          await logActivity({
            companyId,
            userId: actingUserId,
            action: "billing.plan_changed",
            entityType: "company",
            entityId: companyId,
            metadata: {
              plan,
              previousPlan,
              status: subscription.status,
              actor: actingUserId ? undefined : "Stripe / automated",
            },
          });
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.created": {
        const sub = event.data.object;
        const plan = sub.metadata?.plan;
        const companies = await db.select().from(companiesTable).where(eq(companiesTable.stripeSubscriptionId, sub.id));
        if (companies.length > 0) {
          const before = companies[0];
          const nextPlan = plan || before.subscriptionPlan;
          await db.update(companiesTable).set({
            subscriptionStatus: sub.status,
            subscriptionPlan: nextPlan,
            currentPeriodEnd: new Date(sub.current_period_end * 1000),
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            updatedAt: new Date(),
          }).where(eq(companiesTable.stripeSubscriptionId, sub.id));

          // Only log when something meaningful actually flipped. This handler
          // also fires moments after a checkout (which already logged
          // billing.plan_changed), so without this guard we'd duplicate it.
          // These changes come straight from Stripe (e.g. the customer portal
          // or a status flip), so there is no acting user to attribute.
          const planChanged = nextPlan !== before.subscriptionPlan;
          const statusChanged = sub.status !== before.subscriptionStatus;
          const cancelScheduleChanged = !!sub.cancel_at_period_end !== !!before.cancelAtPeriodEnd;
          if (planChanged || statusChanged || cancelScheduleChanged) {
            await logActivity({
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
            });
          }
        }
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const companies = await db.select().from(companiesTable).where(eq(companiesTable.stripeSubscriptionId, sub.id));
        await db.update(companiesTable).set({
          subscriptionStatus: "canceled",
          updatedAt: new Date(),
        }).where(eq(companiesTable.stripeSubscriptionId, sub.id));
        if (companies.length > 0) {
          await logActivity({
            companyId: companies[0].id,
            action: "billing.subscription_canceled",
            entityType: "company",
            entityId: companies[0].id,
            metadata: {
              plan: companies[0].subscriptionPlan,
              previousStatus: companies[0].subscriptionStatus,
              actor: "Stripe / automated",
            },
          });
        }
        break;
      }
      case "invoice.paid":
      case "invoice.payment_succeeded": {
        const inv = event.data.object;
        if (inv.subscription) {
          // Use the subscription's real status instead of assuming "active".
          // A subscription created with a preserved trial_end stays "trialing"
          // until the trial ends, and Stripe finalizes a $0 invoice at trial
          // start whose invoice.paid event would otherwise flip the company to
          // "active" prematurely and hide the remaining free trial.
          let nextStatus = "active";
          try {
            const sub = await stripe.subscriptions.retrieve(inv.subscription as string);
            nextStatus = sub.status;
          } catch (err) {
            logger.error({ err, subscriptionId: inv.subscription }, "Failed to retrieve subscription on invoice.paid; defaulting to active");
          }
          await logBillingStatusFlip(inv.subscription as string, nextStatus);
          await db.update(companiesTable).set({
            subscriptionStatus: nextStatus,
            updatedAt: new Date(),
          }).where(eq(companiesTable.stripeSubscriptionId, inv.subscription as string));
        }
        break;
      }
      case "invoice.payment_failed": {
        const inv = event.data.object;
        if (inv.subscription) {
          await logBillingStatusFlip(inv.subscription as string, "past_due");
          await db.update(companiesTable).set({
            subscriptionStatus: "past_due",
            updatedAt: new Date(),
          }).where(eq(companiesTable.stripeSubscriptionId, inv.subscription as string));
        }
        break;
      }
    }
  } catch (err) {
    logger.error({ err, eventType: event.type }, "Error processing webhook event");
  }

  return res.json({ success: true });
});

// POST /billing/webhook/v2 — Stripe V2 thin-event webhook
// Handles account requirements and capability status changes for Connect accounts.
// Set up in Stripe Dashboard → Developers → Webhooks → Add destination:
//   - Events from: Connected accounts
//   - Payload style: Thin
//   - Events: v2.core.account[requirements].updated,
//             v2.core.account[configuration.merchant].capability_status_updated,
//             v2.core.account[configuration.customer].capability_status_updated
// Store the signing secret as STRIPE_V2_WEBHOOK_SECRET.
router.post("/webhook/v2", async (req: Request, res) => {
  const webhookSecret = process.env.STRIPE_V2_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logger.warn("STRIPE_V2_WEBHOOK_SECRET not configured; skipping V2 webhook processing");
    return res.json({ received: true });
  }

  const sig = req.headers["stripe-signature"];
  if (!sig) {
    return res.status(400).json({ error: "MissingSignature" });
  }

  let stripe: any;
  try {
    stripe = await getUncachableStripeClient();
  } catch (err) {
    logger.error({ err }, "Stripe client init failed for V2 webhook");
    return res.json({ received: true });
  }

  let thinEvent: any;
  try {
    // parseThinEvent verifies the signature and returns a lightweight event object
    thinEvent = stripe.parseThinEvent((req as any).rawBody || req.body, sig, webhookSecret);
  } catch (err) {
    logger.error({ err }, "V2 webhook signature verification failed");
    return res.status(400).json({ error: "Webhook signature verification failed" });
  }

  try {
    // Fetch the full event data from Stripe (thin events only contain the ID + type)
    const event = await (stripe as any).v2.core.events.retrieve(thinEvent.id);

    switch (event.type) {
      case "v2.core.account[requirements].updated": {
        // Account requirements changed (e.g. new KYC docs required by a regulator).
        // We read status live from the API, so no DB update needed — just log.
        const accountId = event.related_object?.id ?? "unknown";
        logger.info({ accountId }, "V2 Connect account requirements updated");
        break;
      }
      case "v2.core.account[configuration.merchant].capability_status_updated": {
        // Merchant card_payments capability status changed (e.g. became active).
        const accountId = event.related_object?.id ?? "unknown";
        logger.info({ accountId }, "V2 Connect merchant capability status updated");
        break;
      }
      case "v2.core.account[configuration.customer].capability_status_updated": {
        const accountId = event.related_object?.id ?? "unknown";
        logger.info({ accountId }, "V2 Connect customer capability status updated");
        break;
      }
      default:
        logger.info({ type: event.type }, "Unhandled V2 thin event");
    }
  } catch (err) {
    logger.error({ err, thinEventId: thinEvent?.id }, "Error processing V2 thin event");
  }

  return res.json({ received: true });
});

// All other billing routes require auth
router.use(requireAuth);

router.get("/plans", async (_req, res) => {
  let publishableKey: string | null = null;
  try {
    publishableKey = await getStripePublishableKey();
  } catch {
    publishableKey = null;
  }

  return res.json({
    plans: getCatalog().map((p) => ({
      id: p.id,
      name: p.name,
      price: p.price,
      interval: p.interval,
      tagline: p.tagline,
      features: p.features,
      isPopular: p.isPopular,
      sortOrder: p.sortOrder,
    })),
    publishableKey,
  });
});

router.get("/usage", requireRole("owner", "admin"), async (req: any, res) => {
  const { companyId } = req.user;
  const summary = await getPlanUsageSummary(companyId);
  return res.json(summary);
});

router.get("/status", requireRole("owner", "admin"), async (req: any, res) => {
  const { companyId } = req.user;
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
  if (!company) return res.status(404).json({ error: "NotFound" });

  return res.json({
    plan: company.subscriptionPlan,
    status: company.subscriptionStatus,
    trialEndsAt: company.trialEndsAt,
    currentPeriodEnd: company.currentPeriodEnd,
    cancelAtPeriodEnd: company.cancelAtPeriodEnd,
    // True once a real Stripe subscription exists. The frontend uses this to
    // decide between "Add payment method" (checkout) and "Manage Billing"
    // (Stripe customer portal). Gating on the subscription — not just a
    // customer id, which is created when checkout merely starts — avoids
    // showing a dead-end portal button after an abandoned checkout.
    hasBillingAccount: !!company.stripeSubscriptionId,
  });
});

// Plan changes and billing-portal access affect the whole company's subscription —
// restrict to owner/admin so staff cannot change plans or payment methods.
router.post("/subscribe", requireRole("owner", "admin"), async (req: any, res) => {
  const { companyId, userId } = req.user;
  const { planId, confirmDowngrade } = req.body;

  if (!["starter", "growth", "pro"].includes(planId)) {
    return res.status(400).json({ error: "InvalidPlan" });
  }

  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
  if (!company) return res.status(404).json({ error: "NotFound" });

  // Downgrade safety: if the chosen plan is smaller than what the account is
  // actually using, refuse unless the manager has explicitly confirmed. This is
  // enforced here (server-side) so the UI warning can't be bypassed. Usage is
  // compared against the *target* plan's limits, not the current plan's.
  if (!confirmDowngrade) {
    const violations = await getDowngradeViolations(companyId, planId);
    if (violations.length > 0) {
      return res.status(409).json({
        error: "DowngradeExceedsUsage",
        message: "The selected plan is smaller than your current usage. Review what's over the limit before switching.",
        targetPlan: planId,
        violations,
      });
    }
  }

  let stripe: any;
  try {
    stripe = await getUncachableStripeClient();
  } catch (err) {
    logger.error({ err }, "Stripe client init failed");
    return res.status(503).json({ error: "BillingUnavailable", message: "Billing service is not configured" });
  }

  // Price IDs must come from pre-configured Stripe Price objects via environment
  // variables (STRIPE_STARTER_PRICE_ID / STRIPE_GROWTH_PRICE_ID / STRIPE_PRO_PRICE_ID).
  // Never hardcode price IDs or fabricate prices at checkout time.
  const priceId = getStripePriceId(planId);
  if (!priceId) {
    logger.error({ planId }, "Stripe price ID not configured for plan");
    return res.status(503).json({
      error: "BillingMisconfigured",
      message: "This plan is not yet available for checkout. Please contact support.",
    });
  }

  try {
    let customerId = company.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: company.email || undefined,
        name: company.name,
        metadata: { companyId: String(companyId) },
      });
      customerId = customer.id;
      await db.update(companiesTable).set({ stripeCustomerId: customerId }).where(eq(companiesTable.id, companyId));
    }

    // Preserve the customer's existing local trial: if they convert mid-trial,
    // they keep the remaining free days and are first charged at their original
    // trialEndsAt instead of getting a brand-new 14-day Stripe trial. Stripe
    // requires trial_end to be at least 48h out, so if less than that remains
    // (or they aren't trialing), we skip the trial and charge at checkout.
    const subscriptionData: any = {
      metadata: { companyId: String(companyId), plan: planId, userId: String(userId) },
    };
    const trialEndMs = company.trialEndsAt ? new Date(company.trialEndsAt).getTime() : 0;
    // Stripe requires trial_end to be at least 48h out; add a 10-minute buffer
    // so request/clock latency never lands us just under Stripe's minimum.
    const MIN_TRIAL_MS = 48 * 60 * 60 * 1000 + 10 * 60 * 1000;
    if (company.subscriptionStatus === "trialing" && trialEndMs - Date.now() >= MIN_TRIAL_MS) {
      subscriptionData.trial_end = Math.floor(trialEndMs / 1000);
    }

    const baseUrl = process.env.APP_BASE_URL || `https://${process.env.REPLIT_DOMAINS?.split(",")[0]}`;
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/billing?success=true`,
      cancel_url: `${baseUrl}/billing?canceled=true`,
      metadata: { companyId: String(companyId), plan: planId, userId: String(userId) },
      subscription_data: subscriptionData,
    });

    await logActivity({ companyId, userId, action: "billing.checkout_started", metadata: { plan: planId } });
    return res.json({ url: session.url });
  } catch (err) {
    logger.error({ err }, "Error creating checkout session");
    return res.status(500).json({ error: "CheckoutError", message: "Failed to create checkout session" });
  }
});

// ── Stripe Connect (V2 API) ───────────────────────────────────────────────────

// GET /billing/connect/status
// Uses the V2 accounts API to get live onboarding + capability status.
router.get("/connect/status", requireRole("owner", "admin"), async (req: any, res) => {
  const { companyId } = req.user;
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
  if (!company) return res.status(404).json({ error: "NotFound" });

  if (!company.stripeConnectAccountId) {
    return res.json({ connected: false, accountId: null, readyToProcessPayments: false, onboardingComplete: false });
  }

  let stripe: any;
  try {
    stripe = await getUncachableStripeClient();
  } catch (err) {
    return res.status(503).json({ error: "BillingUnavailable", message: "Billing service is not configured" });
  }

  try {
    // V2 retrieve — includes merchant configuration and requirements so we can
    // compute readyToProcessPayments and onboardingComplete without storing state.
    const account = await (stripe as any).v2.core.accounts.retrieve(
      company.stripeConnectAccountId,
      { include: ["configuration.merchant", "requirements"] },
    );

    const readyToProcessPayments =
      account?.configuration?.merchant?.capabilities?.card_payments?.status === "active";
    const requirementsStatus =
      account?.requirements?.summary?.minimum_deadline?.status ?? null;
    const onboardingComplete =
      requirementsStatus !== "currently_due" && requirementsStatus !== "past_due";

    return res.json({
      connected: true,
      accountId: company.stripeConnectAccountId,
      readyToProcessPayments,
      onboardingComplete,
      requirementsStatus,
    });
  } catch (err: any) {
    // Fallback: legacy V1 Express accounts created before the V2 migration
    try {
      const v1 = await stripe.accounts.retrieve(company.stripeConnectAccountId);
      return res.json({
        connected: true,
        accountId: company.stripeConnectAccountId,
        readyToProcessPayments: v1.charges_enabled ?? false,
        onboardingComplete: v1.details_submitted ?? false,
        requirementsStatus: null,
      });
    } catch (v1Err: any) {
      if (v1Err?.code === "account_invalid") {
        await db.update(companiesTable).set({ stripeConnectAccountId: null }).where(eq(companiesTable.id, companyId));
        return res.json({ connected: false, accountId: null, readyToProcessPayments: false, onboardingComplete: false });
      }
      logger.error({ err, v1Err }, "Error retrieving Connect account");
      return res.status(500).json({ error: "ConnectError", message: "Could not retrieve account status" });
    }
  }
});

// POST /billing/connect/onboard — create or resume a V2 onboarding link
router.post("/connect/onboard", requireRole("owner", "admin"), async (req: any, res) => {
  const { companyId } = req.user;
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
  if (!company) return res.status(404).json({ error: "NotFound" });

  let stripe: any;
  try {
    stripe = await getUncachableStripeClient();
  } catch (err) {
    return res.status(503).json({ error: "BillingUnavailable", message: "Billing service is not configured" });
  }

  const baseUrl = process.env.APP_BASE_URL || `https://${process.env.REPLIT_DOMAINS?.split(",")[0]}`;

  try {
    let accountId = company.stripeConnectAccountId;

    // Helper: check if an error is a V2 permission/access error so we can fall back to V1
    const isV2PermissionError = (e: any) =>
      e?.code === "forbidden" || e?.statusCode === 403 ||
      (typeof e?.message === "string" && e.message.toLowerCase().includes("permission denied"));

    try {
      if (!accountId) {
        const account = await (stripe as any).v2.core.accounts.create({
          display_name: company.name,
          contact_email: company.email || undefined,
          identity: { country: "us" },
          dashboard: "full",
          defaults: {
            responsibilities: {
              fees_collector: "stripe",
              losses_collector: "stripe",
            },
          },
          configuration: {
            customer: {},
            merchant: {
              capabilities: {
                card_payments: { requested: true },
              },
            },
          },
        });
        accountId = account.id;
        await db.update(companiesTable)
          .set({ stripeConnectAccountId: accountId, updatedAt: new Date() })
          .where(eq(companiesTable.id, companyId));
      }

      const accountLink = await (stripe as any).v2.core.accountLinks.create({
        account: accountId,
        use_case: {
          type: "account_onboarding",
          account_onboarding: {
            configurations: ["merchant", "customer"],
            refresh_url: `${baseUrl}/settings?connect=refresh`,
            return_url: `${baseUrl}/settings?connect=success&accountId=${accountId}`,
          },
        },
      });

      return res.json({ url: accountLink.url });
    } catch (v2Err: any) {
      if (!isV2PermissionError(v2Err)) throw v2Err;

      // V2 not available on this account — fall back to V1 Express
      logger.warn("Stripe V2 Connect not available, falling back to V1 Express");

      if (!accountId) {
        const account = await stripe.accounts.create({
          type: "express",
          email: company.email || undefined,
          business_profile: company.name ? { name: company.name } : undefined,
        });
        accountId = account.id;
        await db.update(companiesTable)
          .set({ stripeConnectAccountId: accountId, updatedAt: new Date() })
          .where(eq(companiesTable.id, companyId));
      }

      const accountLink = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: `${baseUrl}/settings?connect=refresh`,
        return_url: `${baseUrl}/settings?connect=success&accountId=${accountId}`,
        type: "account_onboarding",
      });

      return res.json({ url: accountLink.url });
    }
  } catch (err: any) {
    logger.error({ err }, "Error creating Connect onboarding link");
    const isPermissionError =
      err?.type === "StripePermissionError" ||
      err?.statusCode === 403 ||
      (typeof err?.message === "string" && err.message.toLowerCase().includes("does not have the required permissions"));
    if (isPermissionError) {
      return res.status(403).json({
        error: "ConnectPermissionError",
        message:
          "The configured Stripe key is not authorized for Connect. Use a Stripe secret key with Connect enabled (full-access secret key, or a restricted key with 'Connect: write' permission).",
      });
    }
    const isPlatformProfileError =
      typeof err?.message === "string" &&
      (err.message.toLowerCase().includes("responsibilities of managing losses") ||
        err.message.toLowerCase().includes("platform-profile") ||
        err.message.toLowerCase().includes("platform profile"));
    if (isPlatformProfileError) {
      return res.status(400).json({
        error: "ConnectPlatformProfileIncomplete",
        message:
          "Stripe Connect isn't fully set up yet. Complete your Connect platform profile in the Stripe Dashboard (Settings → Connect → Platform profile) — including who is responsible for losses on connected accounts — then try again.",
      });
    }
    if (err?.rawType === "invalid_request_error" && typeof err?.message === "string") {
      const safeMessage = err.message.replace(/\b(rk|sk|pk|acct|rak)_[A-Za-z0-9_]+/g, "[redacted]");
      return res.status(400).json({ error: "ConnectError", message: safeMessage });
    }
    return res.status(500).json({ error: "ConnectError", message: "Could not create onboarding link" });
  }
});

// POST /billing/connect/dashboard — open the Stripe dashboard for the connected account
router.post("/connect/dashboard", requireRole("owner", "admin"), async (req: any, res) => {
  const { companyId } = req.user;
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
  if (!company?.stripeConnectAccountId) return res.status(400).json({ error: "NotConnected" });

  let stripe: any;
  try {
    stripe = await getUncachableStripeClient();
  } catch {
    return res.status(503).json({ error: "BillingUnavailable" });
  }

  try {
    // V2 accounts with dashboard:"full" log in to dashboard.stripe.com directly
    // (no login-link needed). Try a V1 login link first for legacy Express accounts;
    // fall back to the full dashboard URL for V2 accounts.
    const loginLink = await stripe.accounts.createLoginLink(company.stripeConnectAccountId);
    return res.json({ url: loginLink.url });
  } catch {
    // V2 full-dashboard accounts don't support login links — return the dashboard URL
    return res.json({ url: "https://dashboard.stripe.com" });
  }
});

// ── Billing portal ─────────────────────────────────────────────────────────────

router.post("/portal", requireRole("owner", "admin"), async (req: any, res) => {
  const { companyId } = req.user;
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
  if (!company || !company.stripeCustomerId) {
    return res.status(400).json({ error: "NoBillingAccount", message: "No billing account found" });
  }

  let stripe: any;
  try {
    stripe = await getUncachableStripeClient();
  } catch (err) {
    return res.status(503).json({ error: "BillingUnavailable", message: "Billing service is not configured" });
  }

  const baseUrl = process.env.APP_BASE_URL || `https://${process.env.REPLIT_DOMAINS?.split(",")[0]}`;
  const session = await stripe.billingPortal.sessions.create({
    customer: company.stripeCustomerId,
    return_url: `${baseUrl}/billing`,
  });

  return res.json({ url: session.url });
});

export default router;
