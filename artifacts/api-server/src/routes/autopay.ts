/**
 * Autopay routes — customer payment method management and invoice charging
 * All routes require business auth (requireAuth).
 */
import { Router } from "express";
import { db, customersTable, invoicesTable, recurringPlansTable } from "@workspace/db";
import { eq, and, lt, isNull, or, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { logActivity } from "../lib/activity";
import { logger } from "../lib/logger";
import { sendEmail, sendSMS } from "../lib/notifications";

const router = Router();
router.use(requireAuth);

// GET /autopay/customers/:customerId/payment-method
// Returns the Stripe setup intent for saving a card
router.get("/customers/:customerId/setup-intent", async (req: any, res) => {
  const { companyId } = req.user;
  const customerId = Number(req.params.customerId);

  const [customer] = await db.select().from(customersTable)
    .where(and(eq(customersTable.id, customerId), eq(customersTable.companyId, companyId)))
    .limit(1);
  if (!customer) return res.status(404).json({ error: "NotFound" });

  let stripe: any;
  try {
    const { getUncachableStripeClient } = await import("../lib/stripe");
    stripe = await getUncachableStripeClient();
  } catch {
    return res.status(503).json({ error: "BillingUnavailable" });
  }

  // Create or reuse Stripe customer
  let stripeCustomerId = customer.stripeCustomerId;
  if (!stripeCustomerId) {
    const sc = await stripe.customers.create({
      name: `${customer.firstName} ${customer.lastName}`,
      email: customer.email || undefined,
      phone: customer.phone || undefined,
      metadata: { customerId: String(customer.id), companyId: String(companyId) },
    });
    stripeCustomerId = sc.id;
    await db.update(customersTable).set({ stripeCustomerId, updatedAt: new Date() }).where(eq(customersTable.id, customerId));
  }

  const setupIntent = await stripe.setupIntents.create({
    customer: stripeCustomerId,
    payment_method_types: ["card"],
    metadata: { customerId: String(customerId), companyId: String(companyId) },
  });

  return res.json({ clientSecret: setupIntent.client_secret, stripeCustomerId });
});

// POST /autopay/customers/:customerId/payment-method
// Save the confirmed payment method after Stripe Elements confirms setup
router.post("/customers/:customerId/payment-method", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const customerId = Number(req.params.customerId);
  const { paymentMethodId } = req.body;
  if (!paymentMethodId) return res.status(400).json({ error: "Missing paymentMethodId" });

  const [customer] = await db.select().from(customersTable)
    .where(and(eq(customersTable.id, customerId), eq(customersTable.companyId, companyId)))
    .limit(1);
  if (!customer) return res.status(404).json({ error: "NotFound" });

  let stripe: any;
  try {
    const { getUncachableStripeClient } = await import("../lib/stripe");
    stripe = await getUncachableStripeClient();
  } catch {
    return res.status(503).json({ error: "BillingUnavailable" });
  }

  // Attach payment method to customer
  await stripe.paymentMethods.attach(paymentMethodId, { customer: customer.stripeCustomerId });
  // Set as default
  await stripe.customers.update(customer.stripeCustomerId!, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });

  await db.update(customersTable).set({ stripePaymentMethodId: paymentMethodId, updatedAt: new Date() }).where(eq(customersTable.id, customerId));
  await logActivity({ companyId, userId, action: "customer.payment_method_saved", entityType: "customer", entityId: customerId });

  return res.json({ success: true });
});

// DELETE /autopay/customers/:customerId/payment-method
router.delete("/customers/:customerId/payment-method", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const customerId = Number(req.params.customerId);

  const [customer] = await db.select().from(customersTable)
    .where(and(eq(customersTable.id, customerId), eq(customersTable.companyId, companyId)))
    .limit(1);
  if (!customer) return res.status(404).json({ error: "NotFound" });

  if (customer.stripePaymentMethodId) {
    try {
      const { getUncachableStripeClient } = await import("../lib/stripe");
      const stripe = await getUncachableStripeClient();
      await stripe.paymentMethods.detach(customer.stripePaymentMethodId);
    } catch (err) {
      logger.warn({ err }, "Failed to detach payment method from Stripe");
    }
  }

  await db.update(customersTable).set({ stripePaymentMethodId: null, autopayEnabled: "false", updatedAt: new Date() }).where(eq(customersTable.id, customerId));
  await logActivity({ companyId, userId, action: "customer.payment_method_removed", entityType: "customer", entityId: customerId });
  return res.json({ success: true });
});

// PATCH /autopay/customers/:customerId/autopay
// Toggle autopay on/off for a customer
router.patch("/customers/:customerId/autopay", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const customerId = Number(req.params.customerId);
  const { enabled } = req.body;

  const [customer] = await db.select().from(customersTable)
    .where(and(eq(customersTable.id, customerId), eq(customersTable.companyId, companyId)))
    .limit(1);
  if (!customer) return res.status(404).json({ error: "NotFound" });
  if (enabled && !customer.stripePaymentMethodId) {
    return res.status(400).json({ error: "NoPaymentMethod", message: "Customer must have a saved payment method to enable autopay" });
  }

  await db.update(customersTable).set({ autopayEnabled: enabled ? "true" : "false", updatedAt: new Date() }).where(eq(customersTable.id, customerId));
  await logActivity({ companyId, userId, action: `customer.autopay_${enabled ? "enabled" : "disabled"}`, entityType: "customer", entityId: customerId });
  return res.json({ success: true, autopayEnabled: enabled });
});

// POST /autopay/invoices/:id/charge
// Charge a saved card for an invoice immediately
router.post("/invoices/:id/charge", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const invoiceId = Number(req.params.id);

  const [invoice] = await db.select().from(invoicesTable)
    .where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.companyId, companyId)))
    .limit(1);
  if (!invoice) return res.status(404).json({ error: "NotFound" });
  if (invoice.status === "paid") return res.status(400).json({ error: "AlreadyPaid" });

  const [customer] = await db.select().from(customersTable)
    .where(eq(customersTable.id, invoice.customerId))
    .limit(1);
  if (!customer?.stripePaymentMethodId || !customer.stripeCustomerId) {
    return res.status(400).json({ error: "NoPaymentMethod", message: "Customer has no saved payment method" });
  }

  let stripe: any;
  try {
    const { getUncachableStripeClient } = await import("../lib/stripe");
    stripe = await getUncachableStripeClient();
  } catch {
    return res.status(503).json({ error: "BillingUnavailable" });
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(Number(invoice.total) * 100),
      currency: "usd",
      customer: customer.stripeCustomerId,
      payment_method: customer.stripePaymentMethodId,
      confirm: true,
      off_session: true,
      metadata: { invoiceId: String(invoiceId), companyId: String(companyId) },
      description: `Invoice ${invoice.invoiceNumber}`,
    });

    if (paymentIntent.status === "succeeded") {
      await db.update(invoicesTable).set({
        status: "paid",
        paidAt: new Date(),
        paymentMethod: "card",
        stripePaymentIntentId: paymentIntent.id,
        updatedAt: new Date(),
      }).where(eq(invoicesTable.id, invoiceId));

      await logActivity({ companyId, userId, action: "invoice.autopay_charged", entityType: "invoice", entityId: invoiceId });
      return res.json({ success: true, status: "paid" });
    }

    return res.json({ success: false, status: paymentIntent.status, message: "Payment requires additional action" });
  } catch (err: any) {
    logger.error({ err, invoiceId }, "Autopay charge failed");
    return res.status(402).json({ error: "PaymentFailed", message: err.message || "Payment failed" });
  }
});

// POST /autopay/invoices/send-reminders
// Send overdue reminders for all overdue invoices in a company
router.post("/invoices/send-reminders", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const now = new Date();

  // Find sent invoices past due date with no recent reminder (within 24h)
  const overdueInvoices = await db.select().from(invoicesTable)
    .where(and(
      eq(invoicesTable.companyId, companyId),
      eq(invoicesTable.status, "sent"),
      lt(invoicesTable.dueDate, now),
    ));

  const { companiesTable } = await import("@workspace/db");
  const { eq: deq } = await import("drizzle-orm");
  const [company] = await db.select().from(companiesTable).where(deq(companiesTable.id, companyId)).limit(1);

  let sent = 0;
  for (const invoice of overdueInvoices) {
    // Throttle: don't send if already sent within the last 24h
    if (invoice.lastReminderSentAt) {
      const hoursSince = (now.getTime() - invoice.lastReminderSentAt.getTime()) / (1000 * 60 * 60);
      if (hoursSince < 24) continue;
    }

    const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, invoice.customerId)).limit(1);
    if (!customer) continue;

    const daysOverdue = Math.floor((now.getTime() - (invoice.dueDate?.getTime() || 0)) / (1000 * 60 * 60 * 24));
    const message = `Hi ${customer.firstName}, your invoice ${invoice.invoiceNumber} for $${Number(invoice.total).toFixed(2)} from ${company?.name || "your service provider"} is ${daysOverdue} day${daysOverdue !== 1 ? "s" : ""} overdue. Please pay at your earliest convenience.`;

    if (customer.email) {
      await sendEmail({
        to: customer.email,
        subject: `Invoice ${invoice.invoiceNumber} is overdue — ${company?.name}`,
        body: `${message}\n\nInvoice: ${invoice.invoiceNumber}\nAmount: $${Number(invoice.total).toFixed(2)}\nDue: ${invoice.dueDate?.toLocaleDateString()}\n\nThank you.`,
      });
    }
    if (customer.phone) {
      await sendSMS({ to: customer.phone, body: message });
    }

    await db.update(invoicesTable).set({
      lastReminderSentAt: now,
      reminderCount: (invoice.reminderCount || 0) + 1,
      updatedAt: new Date(),
    }).where(eq(invoicesTable.id, invoice.id));

    sent++;
  }

  await logActivity({ companyId, userId, action: "invoices.reminders_sent", metadata: { count: sent } });
  return res.json({ success: true, remindersSent: sent, totalOverdue: overdueInvoices.length });
});

export default router;
