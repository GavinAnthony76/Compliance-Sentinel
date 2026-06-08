import { Router, type Request } from "express";
import { db, companiesTable, invoicesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { getPlanUsageSummary } from "../lib/features";
import { getUncachableStripeClient, getStripePublishableKey, getStripePriceId, STRIPE_PLANS } from "../lib/stripe";
import { logActivity } from "../lib/activity";
import { logger } from "../lib/logger";

const router = Router();

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
            await db.update(invoicesTable).set({
              status: "paid",
              paidAt: new Date(),
              paymentMethod: "card",
              stripePaymentIntentId: paymentIntentId,
              updatedAt: new Date(),
            }).where(eq(invoicesTable.id, invoiceId));
            logger.info({ invoiceId, sessionId: session.id }, "Invoice marked paid via portal checkout");
            if (companyId) {
              const { dispatchPaymentReceiptEmail } = await import("../lib/notifications");
              dispatchPaymentReceiptEmail(invoiceId, companyId);
            }
          }
          break;
        }

        // Company subscription checkout
        if (companyId && plan) {
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
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.created": {
        const sub = event.data.object;
        const plan = sub.metadata?.plan;
        const companies = await db.select().from(companiesTable).where(eq(companiesTable.stripeSubscriptionId, sub.id));
        if (companies.length > 0) {
          await db.update(companiesTable).set({
            subscriptionStatus: sub.status,
            subscriptionPlan: plan || companies[0].subscriptionPlan,
            currentPeriodEnd: new Date(sub.current_period_end * 1000),
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            updatedAt: new Date(),
          }).where(eq(companiesTable.stripeSubscriptionId, sub.id));
        }
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        await db.update(companiesTable).set({
          subscriptionStatus: "canceled",
          updatedAt: new Date(),
        }).where(eq(companiesTable.stripeSubscriptionId, sub.id));
        break;
      }
      case "invoice.paid": {
        const inv = event.data.object;
        if (inv.subscription) {
          await db.update(companiesTable).set({
            subscriptionStatus: "active",
            updatedAt: new Date(),
          }).where(eq(companiesTable.stripeSubscriptionId, inv.subscription as string));
        }
        break;
      }
      case "invoice.payment_failed": {
        const inv = event.data.object;
        if (inv.subscription) {
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
    plans: Object.values(STRIPE_PLANS),
    publishableKey,
  });
});

router.get("/usage", async (req: any, res) => {
  const { companyId } = req.user;
  const summary = await getPlanUsageSummary(companyId);
  return res.json(summary);
});

router.get("/status", async (req: any, res) => {
  const { companyId } = req.user;
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
  if (!company) return res.status(404).json({ error: "NotFound" });

  return res.json({
    plan: company.subscriptionPlan,
    status: company.subscriptionStatus,
    trialEndsAt: company.trialEndsAt,
    currentPeriodEnd: company.currentPeriodEnd,
    cancelAtPeriodEnd: company.cancelAtPeriodEnd,
  });
});

// Plan changes and billing-portal access affect the whole company's subscription —
// restrict to owner/admin so staff cannot change plans or payment methods.
router.post("/subscribe", requireRole("owner", "admin"), async (req: any, res) => {
  const { companyId, userId } = req.user;
  const { planId } = req.body;

  if (!["starter", "growth", "pro"].includes(planId)) {
    return res.status(400).json({ error: "InvalidPlan" });
  }

  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
  if (!company) return res.status(404).json({ error: "NotFound" });

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
  const priceId = getStripePriceId(planId as keyof typeof STRIPE_PLANS);
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

    const baseUrl = process.env.APP_BASE_URL || `https://${process.env.REPLIT_DOMAINS?.split(",")[0]}`;
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/billing?success=true`,
      cancel_url: `${baseUrl}/billing?canceled=true`,
      metadata: { companyId: String(companyId), plan: planId },
      subscription_data: {
        trial_period_days: 14,
        metadata: { companyId: String(companyId), plan: planId },
      },
    });

    await logActivity({ companyId, userId, action: "billing.checkout_started", metadata: { plan: planId } });
    return res.json({ url: session.url });
  } catch (err) {
    logger.error({ err }, "Error creating checkout session");
    return res.status(500).json({ error: "CheckoutError", message: "Failed to create checkout session" });
  }
});

// ── Stripe Connect ────────────────────────────────────────────────────────────

// GET /billing/connect/status — is this company's Connect account linked?
router.get("/connect/status", async (req: any, res) => {
  const { companyId } = req.user;
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
  if (!company) return res.status(404).json({ error: "NotFound" });

  if (!company.stripeConnectAccountId) {
    return res.json({ connected: false, accountId: null, chargesEnabled: false, payoutsEnabled: false });
  }

  let stripe: any;
  try {
    stripe = await getUncachableStripeClient();
  } catch (err) {
    return res.status(503).json({ error: "BillingUnavailable", message: "Billing service is not configured" });
  }

  try {
    const account = await stripe.accounts.retrieve(company.stripeConnectAccountId);
    return res.json({
      connected: true,
      accountId: company.stripeConnectAccountId,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
    });
  } catch (err: any) {
    if (err?.code === "account_invalid") {
      await db.update(companiesTable).set({ stripeConnectAccountId: null }).where(eq(companiesTable.id, companyId));
      return res.json({ connected: false, accountId: null, chargesEnabled: false, payoutsEnabled: false });
    }
    logger.error({ err }, "Error retrieving Connect account");
    return res.status(500).json({ error: "ConnectError", message: "Could not retrieve account status" });
  }
});

// POST /billing/connect/onboard — create/resume Express onboarding link
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

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        email: company.email || undefined,
        business_profile: { name: company.name },
        metadata: { companyId: String(companyId) },
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      });
      accountId = account.id;
      await db.update(companiesTable).set({ stripeConnectAccountId: accountId, updatedAt: new Date() }).where(eq(companiesTable.id, companyId));
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${baseUrl}/settings?connect=refresh`,
      return_url: `${baseUrl}/settings?connect=success`,
      type: "account_onboarding",
    });

    return res.json({ url: accountLink.url });
  } catch (err) {
    logger.error({ err }, "Error creating Connect onboarding link");
    return res.status(500).json({ error: "ConnectError", message: "Could not create onboarding link" });
  }
});

// POST /billing/connect/dashboard — redirect to Express dashboard
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
    const loginLink = await stripe.accounts.createLoginLink(company.stripeConnectAccountId);
    return res.json({ url: loginLink.url });
  } catch (err) {
    logger.error({ err }, "Error creating Connect dashboard link");
    return res.status(500).json({ error: "ConnectError", message: "Could not open Stripe dashboard" });
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
