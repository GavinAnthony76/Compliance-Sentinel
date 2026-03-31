import { Router } from "express";
import { db, customersTable, invoicesTable, appointmentsTable, estimatesTable, companiesTable, servicesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { hashPassword, verifyPassword } from "../lib/auth";
import { z } from "zod";
import crypto from "crypto";

const router = Router();

const PORTAL_JWT_SECRET = process.env.SESSION_SECRET || process.env.JWT_SECRET;
if (!PORTAL_JWT_SECRET) {
  throw new Error("Missing required environment variable: SESSION_SECRET or JWT_SECRET");
}
const PORTAL_TOKEN_PREFIX = "portal:";

interface PortalJWTPayload {
  customerId: number;
  companyId: number;
  type: "portal";
}

function signPortalToken(payload: Omit<PortalJWTPayload, "type">): string {
  return jwt.sign({ ...payload, type: "portal" }, PORTAL_JWT_SECRET + PORTAL_TOKEN_PREFIX, { expiresIn: "30d" });
}

function verifyPortalToken(token: string): PortalJWTPayload {
  return jwt.verify(token, PORTAL_JWT_SECRET + PORTAL_TOKEN_PREFIX) as PortalJWTPayload;
}

function requirePortalAuth(req: any, res: any, next: any): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);
  try {
    const payload = verifyPortalToken(token);
    if (payload.type !== "portal") throw new Error("Invalid token type");
    req.portal = payload;
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized", message: "Invalid or expired portal token" });
  }
}

// POST /portal/auth/login
router.post("/auth/login", async (req, res) => {
  const parsed = z.object({ identifier: z.string().min(1), password: z.string().min(1), companySlug: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "ValidationError", message: parsed.error.message });

  const { identifier, password, companySlug } = parsed.data;

  const [company] = await db.select().from(companiesTable).where(and(eq(companiesTable.slug, companySlug), eq(companiesTable.isActive, true))).limit(1);
  if (!company) return res.status(404).json({ error: "NotFound", message: "Company not found" });

  // Support login by phone number (primary) or email (fallback)
  const isEmail = identifier.includes("@");
  const [customer] = await db.select().from(customersTable).where(
    and(
      eq(customersTable.companyId, company.id),
      isEmail ? eq(customersTable.email, identifier) : eq(customersTable.phone, identifier)
    )
  ).limit(1);
  if (!customer || !customer.portalPasswordHash) {
    return res.status(401).json({ error: "AuthError", message: "Invalid phone number or password" });
  }

  const valid = await verifyPassword(password, customer.portalPasswordHash);
  if (!valid) return res.status(401).json({ error: "AuthError", message: "Invalid phone number or password" });

  const token = signPortalToken({ customerId: customer.id, companyId: company.id });
  return res.json({
    token,
    customer: { id: customer.id, firstName: customer.firstName, lastName: customer.lastName, email: customer.email },
    company: { id: company.id, name: company.name, slug: company.slug, logoUrl: company.logoUrl, primaryColor: company.primaryColor },
  });
});

// POST /portal/auth/send-invite — business sends portal invite to customer
router.post("/auth/send-invite", async (req: any, res) => {
  // This is called by the business (requires business auth header)
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  // Verify business user token
  let businessCompanyId: number;
  try {
    const { verifyUserToken } = await import("../lib/auth");
    const payload = verifyUserToken(authHeader.slice(7));
    businessCompanyId = payload.companyId;
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const parsed = z.object({ customerId: z.number().int() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "ValidationError" });

  const [customer] = await db.select().from(customersTable).where(and(eq(customersTable.id, parsed.data.customerId), eq(customersTable.companyId, businessCompanyId))).limit(1);
  if (!customer) return res.status(404).json({ error: "NotFound" });
  if (!customer.phone) return res.status(400).json({ error: "NoPhone", message: "Customer has no phone number. Add a phone number first." });

  const inviteToken = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await db.update(customersTable).set({
    portalInviteToken: inviteToken,
    portalInviteExpiresAt: expiresAt,
    updatedAt: new Date(),
  }).where(eq(customersTable.id, customer.id));

  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, businessCompanyId)).limit(1);
  const baseUrl = process.env.APP_BASE_URL || `https://${process.env.REPLIT_DOMAINS?.split(",")[0]}` || "http://localhost:3000";
  const portalUrl = `${baseUrl}/portal/set-password?token=${inviteToken}&slug=${company.slug}`;

  // Send SMS invite (mock or real via Twilio)
  const { sendSMS } = await import("../lib/notifications");
  await sendSMS({
    to: customer.phone,
    body: `${company.name} has invited you to your customer portal. Set up your account here: ${portalUrl} (link expires in 7 days)`,
  });

  return res.json({ success: true, portalUrl, sentTo: customer.phone });
});

// POST /portal/auth/set-password — customer sets password via invite token
router.post("/auth/set-password", async (req, res) => {
  const parsed = z.object({ token: z.string().min(1), password: z.string().min(8), companySlug: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "ValidationError", message: parsed.error.message });

  const { token, password, companySlug } = parsed.data;

  const [company] = await db.select().from(companiesTable).where(and(eq(companiesTable.slug, companySlug), eq(companiesTable.isActive, true))).limit(1);
  if (!company) return res.status(404).json({ error: "NotFound", message: "Company not found" });

  const [customer] = await db.select().from(customersTable).where(and(eq(customersTable.companyId, company.id), eq(customersTable.portalInviteToken, token))).limit(1);
  if (!customer) return res.status(400).json({ error: "InvalidToken", message: "Invalid or expired invite link" });
  if (customer.portalInviteExpiresAt && customer.portalInviteExpiresAt < new Date()) {
    return res.status(400).json({ error: "ExpiredToken", message: "This invite link has expired" });
  }

  const hash = await hashPassword(password);
  await db.update(customersTable).set({
    portalPasswordHash: hash,
    portalInviteToken: null,
    portalInviteExpiresAt: null,
    updatedAt: new Date(),
  }).where(eq(customersTable.id, customer.id));

  const portalToken = signPortalToken({ customerId: customer.id, companyId: company.id });
  return res.json({
    token: portalToken,
    customer: { id: customer.id, firstName: customer.firstName, lastName: customer.lastName, email: customer.email },
    company: { id: company.id, name: company.name, slug: company.slug, logoUrl: company.logoUrl, primaryColor: company.primaryColor },
  });
});

// POST /portal/auth/forgot-password
router.post("/auth/forgot-password", async (req, res) => {
  const parsed = z.object({ email: z.string().email(), companySlug: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "ValidationError", message: parsed.error.message });

  const { email, companySlug } = parsed.data;
  const [company] = await db.select().from(companiesTable).where(and(eq(companiesTable.slug, companySlug), eq(companiesTable.isActive, true))).limit(1);
  if (!company) return res.json({ success: true }); // silent — avoid slug enumeration

  const [customer] = await db.select().from(customersTable).where(and(eq(customersTable.companyId, company.id), eq(customersTable.email, email))).limit(1);

  if (customer && customer.portalPasswordHash) {
    const resetToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await db.update(customersTable).set({ portalInviteToken: resetToken, portalInviteExpiresAt: expiresAt, updatedAt: new Date() }).where(eq(customersTable.id, customer.id));

    const baseUrl = process.env.APP_BASE_URL || `https://${process.env.REPLIT_DOMAINS?.split(",")[0]}` || "http://localhost:3000";
    const resetUrl = `${baseUrl}/portal/set-password?token=${resetToken}&slug=${companySlug}`;
    const { sendEmail } = await import("../lib/notifications");
    await sendEmail({
      to: customer.email!,
      subject: `Reset your ${company.name} portal password`,
      body: `Hi ${customer.firstName},\n\nClick the link below to reset your portal password. This link expires in 1 hour.\n\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`,
    });
  }

  return res.json({ success: true, message: "If that email has a portal account, a reset link has been sent." });
});

// GET /portal/auth/me
router.get("/auth/me", requirePortalAuth, async (req: any, res) => {
  const { customerId, companyId } = req.portal;
  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, customerId)).limit(1);
  if (!customer) return res.status(401).json({ error: "Unauthorized" });
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
  return res.json({
    customer: { id: customer.id, firstName: customer.firstName, lastName: customer.lastName, email: customer.email, phone: customer.phone },
    company: { id: company.id, name: company.name, slug: company.slug, logoUrl: company.logoUrl, primaryColor: company.primaryColor },
  });
});

// GET /portal/services — list company's active services for booking
router.get("/services", requirePortalAuth, async (req: any, res) => {
  const { companyId } = req.portal;
  const services = await db.select().from(servicesTable)
    .where(and(eq(servicesTable.companyId, companyId), eq(servicesTable.isActive, true)));
  return res.json(services.map(s => ({
    id: s.id,
    name: s.name,
    description: s.description,
    basePrice: s.basePrice ? Number(s.basePrice) : null,
    durationMinutes: s.durationMinutes,
    category: s.category,
  })));
});

// GET /portal/appointments
router.get("/appointments", requirePortalAuth, async (req: any, res) => {
  const { customerId, companyId } = req.portal;
  const appointments = await db.select().from(appointmentsTable)
    .where(and(eq(appointmentsTable.customerId, customerId), eq(appointmentsTable.companyId, companyId)))
    .orderBy(desc(appointmentsTable.scheduledStart));

  // Enrich with service names
  const serviceIds = [...new Set(appointments.map(a => a.serviceId).filter(Boolean))] as number[];
  const services = serviceIds.length > 0 ? await db.select().from(servicesTable).where(eq(servicesTable.companyId, companyId)) : [];
  const serviceMap = Object.fromEntries(services.map(s => [s.id, s.name]));

  return res.json(appointments.map(a => ({
    ...a,
    price: a.price ? Number(a.price) : null,
    serviceName: a.serviceId ? serviceMap[a.serviceId] ?? null : null,
  })));
});

// POST /portal/appointments — book a new appointment request
router.post("/appointments", requirePortalAuth, async (req: any, res) => {
  const { customerId, companyId } = req.portal;
  const parsed = z.object({
    serviceId: z.number().int().positive(),
    scheduledStart: z.string().min(1),
    notes: z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "ValidationError", message: parsed.error.message });

  const { serviceId, scheduledStart, notes } = parsed.data;

  // Verify the service belongs to the company
  const [service] = await db.select().from(servicesTable)
    .where(and(eq(servicesTable.id, serviceId), eq(servicesTable.companyId, companyId), eq(servicesTable.isActive, true)))
    .limit(1);
  if (!service) return res.status(404).json({ error: "NotFound", message: "Service not found" });

  const scheduledDate = new Date(scheduledStart);
  if (isNaN(scheduledDate.getTime())) return res.status(400).json({ error: "ValidationError", message: "Invalid date" });
  if (scheduledDate <= new Date()) return res.status(400).json({ error: "ValidationError", message: "Preferred date must be in the future" });

  const [appointment] = await db.insert(appointmentsTable).values({
    companyId,
    customerId,
    serviceId,
    status: "pending",
    scheduledStart: scheduledDate,
    notes: notes || null,
    price: service.basePrice ?? null,
  }).returning();

  return res.status(201).json({
    ...appointment,
    price: appointment.price ? Number(appointment.price) : null,
    serviceName: service.name,
  });
});

// POST /portal/appointments/:id/cancel — cancel a pending or confirmed appointment
router.post("/appointments/:id/cancel", requirePortalAuth, async (req: any, res) => {
  const { customerId, companyId } = req.portal;
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "ValidationError", message: "Invalid appointment ID" });

  const [appointment] = await db.select().from(appointmentsTable)
    .where(and(eq(appointmentsTable.id, id), eq(appointmentsTable.customerId, customerId), eq(appointmentsTable.companyId, companyId)))
    .limit(1);

  if (!appointment) return res.status(404).json({ error: "NotFound", message: "Appointment not found" });
  if (!["pending", "confirmed"].includes(appointment.status)) {
    return res.status(400).json({ error: "CannotCancel", message: `Cannot cancel an appointment with status: ${appointment.status}` });
  }

  const [updated] = await db.update(appointmentsTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(appointmentsTable.id, id))
    .returning();

  return res.json({ ...updated, price: updated.price ? Number(updated.price) : null });
});

// GET /portal/invoices
router.get("/invoices", requirePortalAuth, async (req: any, res) => {
  const { customerId, companyId } = req.portal;
  const invoices = await db.select().from(invoicesTable)
    .where(and(eq(invoicesTable.customerId, customerId), eq(invoicesTable.companyId, companyId)))
    .orderBy(desc(invoicesTable.createdAt));
  return res.json(invoices.map(i => ({ ...i, subtotal: Number(i.subtotal), tax: Number(i.tax), total: Number(i.total) })));
});

// GET /portal/estimates
router.get("/estimates", requirePortalAuth, async (req: any, res) => {
  const { customerId, companyId } = req.portal;
  const estimates = await db.select().from(estimatesTable)
    .where(and(eq(estimatesTable.customerId, customerId), eq(estimatesTable.companyId, companyId)))
    .orderBy(desc(estimatesTable.createdAt));
  return res.json(estimates.map(e => ({ ...e, total: Number(e.total) })));
});

// POST /portal/invoices/:id/pay — Stripe payment from customer portal
router.post("/invoices/:id/pay", requirePortalAuth, async (req: any, res) => {
  const { customerId, companyId } = req.portal;
  const id = Number(req.params.id);

  const [invoice] = await db.select().from(invoicesTable).where(and(eq(invoicesTable.id, id), eq(invoicesTable.customerId, customerId), eq(invoicesTable.companyId, companyId))).limit(1);
  if (!invoice) return res.status(404).json({ error: "NotFound" });
  if (invoice.status === "paid") return res.status(400).json({ error: "AlreadyPaid" });

  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, customerId)).limit(1);
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);

  let stripe: any;
  try {
    const { getUncachableStripeClient } = await import("../lib/stripe");
    stripe = await getUncachableStripeClient();
  } catch {
    return res.status(503).json({ error: "BillingUnavailable", message: "Payment processing not configured" });
  }

  const baseUrl = process.env.APP_BASE_URL || `https://${process.env.REPLIT_DOMAINS?.split(",")[0]}` || "http://localhost:3000";

  // Create a Stripe Checkout session for the customer to pay
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    customer_email: customer.email || undefined,
    line_items: [{
      price_data: {
        currency: "usd",
        unit_amount: Math.round(Number(invoice.total) * 100),
        product_data: { name: `Invoice ${invoice.invoiceNumber} - ${company.name}` },
      },
      quantity: 1,
    }],
    success_url: `${baseUrl}/portal/${company.slug}?payment=success&invoice=${invoice.id}`,
    cancel_url: `${baseUrl}/portal/${company.slug}/invoices`,
    metadata: { invoiceId: String(invoice.id), companyId: String(companyId), customerId: String(customerId), source: "customer_portal" },
  });

  // Store payment intent reference
  await db.update(invoicesTable).set({ stripePaymentIntentId: session.payment_intent as string || session.id, updatedAt: new Date() }).where(eq(invoicesTable.id, id));

  return res.json({ url: session.url });
});

export default router;
