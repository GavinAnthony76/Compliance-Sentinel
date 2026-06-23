import { Router } from "express";
import { db, customersTable, invoicesTable, invoiceLineItemsTable, appointmentsTable, estimatesTable, companiesTable, servicesTable } from "@workspace/db";
import { eq, and, ne, desc } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { hashPassword, verifyPassword } from "../lib/auth";
import { hasFeature, getRequiredPlanForFeature } from "../lib/features";
import { z } from "zod";
import crypto from "crypto";
import { logger } from "../lib/logger";

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

  const [businessCompany] = await db.select({ subscriptionPlan: companiesTable.subscriptionPlan }).from(companiesTable).where(eq(companiesTable.id, businessCompanyId)).limit(1);
  if (!hasFeature(businessCompany?.subscriptionPlan, "customer_portal")) {
    const requiredPlan = getRequiredPlanForFeature("customer_portal");
    return res.status(403).json({
      error: "PlanUpgradeRequired",
      message: `This feature requires the ${requiredPlan.charAt(0).toUpperCase()}${requiredPlan.slice(1)} plan.`,
      feature: "customer_portal",
      requiredPlan,
      currentPlan: businessCompany?.subscriptionPlan ?? "none",
    });
  }

  const parsed = z.object({ customerId: z.number().int() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "ValidationError" });

  const [customer] = await db.select().from(customersTable).where(and(eq(customersTable.id, parsed.data.customerId), eq(customersTable.companyId, businessCompanyId))).limit(1);
  if (!customer) return res.status(404).json({ error: "NotFound" });
  if (!customer.email && !customer.phone) {
    return res.status(400).json({ error: "NoContact", message: "Customer has no email or phone number. Add one first." });
  }

  const rawInviteToken = crypto.randomBytes(32).toString("hex");
  // Store SHA-256 hash — not the raw token — so a DB read cannot be used to
  // immediately consume the invite link.
  const inviteTokenHash = crypto.createHash("sha256").update(rawInviteToken).digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await db.update(customersTable).set({
    portalInviteToken: inviteTokenHash,
    portalInviteExpiresAt: expiresAt,
    updatedAt: new Date(),
  }).where(eq(customersTable.id, customer.id));

  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, businessCompanyId)).limit(1);
  const baseUrl = process.env.APP_BASE_URL || `https://${process.env.REPLIT_DOMAINS?.split(",")[0]}` || "http://localhost:3000";
  // Invite link takes customers to the set-password page so they create a password on first access.
  const portalUrl = `${baseUrl}/portal/set-password?token=${rawInviteToken}&slug=${company.slug}`;
  const customerName = customer.firstName || customer.email || "there";

  const { sendSMS, sendPortalAccessEmail } = await import("../lib/notifications");
  const sentTo: string[] = [];
  if (customer.email) {
    await sendPortalAccessEmail({ to: customer.email, customerName, companyName: company.name, companyEmail: company.email ?? undefined, loginUrl: portalUrl, intent: "invite", expiresLabel: "in 7 days", logoUrl: company.logoUrl, primaryColor: company.primaryColor });
    sentTo.push(customer.email);
  }
  if (customer.phone && hasFeature(businessCompany?.subscriptionPlan, "sms_notifications")) {
    await sendSMS({ to: customer.phone, body: `${company.name} has invited you to your customer portal. Sign in here (no password needed): ${portalUrl} (link expires in 7 days)` });
    sentTo.push(customer.phone);
  }

  return res.json({ success: true, portalUrl, sentTo: sentTo.join(", ") || customer.email || customer.phone });
});

// POST /portal/auth/request-link — customer requests a passwordless email login link
router.post("/auth/request-link", async (req, res) => {
  const parsed = z.object({ email: z.string().email(), companySlug: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "ValidationError", message: parsed.error.message });

  const { email, companySlug } = parsed.data;
  const [company] = await db.select().from(companiesTable).where(and(eq(companiesTable.slug, companySlug), eq(companiesTable.isActive, true))).limit(1);
  // Always respond success to avoid leaking which emails/slugs exist
  if (company) {
    const [customer] = await db.select().from(customersTable).where(and(eq(customersTable.companyId, company.id), eq(customersTable.email, email))).limit(1);
    if (customer && customer.email) {
      const rawLoginToken = crypto.randomBytes(32).toString("hex");
      const loginTokenHash = crypto.createHash("sha256").update(rawLoginToken).digest("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await db.update(customersTable).set({ portalInviteToken: loginTokenHash, portalInviteExpiresAt: expiresAt, updatedAt: new Date() }).where(eq(customersTable.id, customer.id));
      const baseUrl = process.env.APP_BASE_URL || `https://${process.env.REPLIT_DOMAINS?.split(",")[0]}` || "http://localhost:3000";
      const loginUrl = `${baseUrl}/portal/${company.slug}/login?token=${rawLoginToken}`;
      const { sendPortalAccessEmail } = await import("../lib/notifications");
      await sendPortalAccessEmail({ to: customer.email, customerName: customer.firstName || customer.email, companyName: company.name, companyEmail: company.email ?? undefined, loginUrl, intent: "login", expiresLabel: "in 1 hour", logoUrl: company.logoUrl, primaryColor: company.primaryColor });
    }
  }
  return res.json({ success: true, message: "If that email has portal access, a login link has been sent." });
});

// POST /portal/auth/verify-link — exchange a magic-link token for a portal session
router.post("/auth/verify-link", async (req, res) => {
  const parsed = z.object({ token: z.string().min(1), companySlug: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "ValidationError", message: parsed.error.message });

  const { token, companySlug } = parsed.data;
  const [company] = await db.select().from(companiesTable).where(and(eq(companiesTable.slug, companySlug), eq(companiesTable.isActive, true))).limit(1);
  if (!company) return res.status(404).json({ error: "NotFound", message: "Company not found" });

  // Hash incoming raw token before DB lookup — tokens are stored as SHA-256 hashes.
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const [customer] = await db.select().from(customersTable).where(and(eq(customersTable.companyId, company.id), eq(customersTable.portalInviteToken, tokenHash))).limit(1);
  if (!customer) return res.status(400).json({ error: "InvalidToken", message: "This login link is invalid or has already been used" });
  if (customer.portalInviteExpiresAt && customer.portalInviteExpiresAt < new Date()) {
    return res.status(400).json({ error: "ExpiredToken", message: "This login link has expired. Please request a new one." });
  }

  // Consume the single-use token
  await db.update(customersTable).set({ portalInviteToken: null, portalInviteExpiresAt: null, updatedAt: new Date() }).where(eq(customersTable.id, customer.id));

  const portalToken = signPortalToken({ customerId: customer.id, companyId: company.id });
  return res.json({
    token: portalToken,
    customer: { id: customer.id, firstName: customer.firstName, lastName: customer.lastName, email: customer.email },
    company: { id: company.id, name: company.name, slug: company.slug, logoUrl: company.logoUrl, primaryColor: company.primaryColor },
  });
});

// POST /portal/auth/set-password — customer sets password via invite token
router.post("/auth/set-password", async (req, res) => {
  const parsed = z.object({ token: z.string().min(1), password: z.string().min(8), companySlug: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "ValidationError", message: parsed.error.message });

  const { token, password, companySlug } = parsed.data;

  const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;
  if (!PASSWORD_REGEX.test(password)) {
    return res.status(400).json({
      error: "WeakPassword",
      message: "Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character.",
    });
  }

  const [company] = await db.select().from(companiesTable).where(and(eq(companiesTable.slug, companySlug), eq(companiesTable.isActive, true))).limit(1);
  if (!company) return res.status(404).json({ error: "NotFound", message: "Company not found" });

  // Hash the raw token before lookup — tokens are stored as SHA-256 hashes.
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const [customer] = await db.select().from(customersTable).where(and(eq(customersTable.companyId, company.id), eq(customersTable.portalInviteToken, tokenHash))).limit(1);
  if (!customer) return res.status(400).json({ error: "InvalidToken", message: "Invalid or expired invite link" });
  if (customer.portalInviteExpiresAt && customer.portalInviteExpiresAt < new Date()) {
    return res.status(400).json({ error: "ExpiredToken", message: "This invite link has expired" });
  }

  const wasReset = !!customer.portalPasswordHash;

  const hash = await hashPassword(password);
  await db.update(customersTable).set({
    portalPasswordHash: hash,
    portalInviteToken: null,
    portalInviteExpiresAt: null,
    updatedAt: new Date(),
  }).where(eq(customersTable.id, customer.id));

  // Confirmation / security notice — don't block the response on email delivery.
  if (customer.email) {
    const baseUrl = process.env.APP_BASE_URL || `https://${process.env.REPLIT_DOMAINS?.split(",")[0]}` || "http://localhost:3000";
    const loginUrl = `${baseUrl}/portal/${company.slug}/login`;
    import("../lib/notifications")
      .then(({ sendPortalPasswordChangedEmail }) =>
        sendPortalPasswordChangedEmail({
          to: customer.email!,
          customerName: customer.firstName || customer.email!,
          companyName: company.name,
          companyEmail: company.email ?? undefined,
          companyPhone: company.phone ?? undefined,
          loginUrl,
          wasReset,
          logoUrl: company.logoUrl,
          primaryColor: company.primaryColor,
        }),
      )
      .catch((err) => logger.error({ err, customerId: customer.id }, "Failed to send portal password-changed email"));
  }

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
  const genericResponse = { success: true, message: "If that email has a portal account, a reset link has been sent." };
  const [company] = await db.select().from(companiesTable).where(and(eq(companiesTable.slug, companySlug), eq(companiesTable.isActive, true))).limit(1);
  if (!company) return res.json(genericResponse); // silent — avoid slug enumeration

  const [customer] = await db.select().from(customersTable).where(and(eq(customersTable.companyId, company.id), eq(customersTable.email, email))).limit(1);

  // Send the set/reset link to any portal customer with an email — not only
  // those who already created a password. Customers who have only ever used
  // magic links have no password hash yet, and must still be able to set one
  // via "forgot password" (the set-password page handles both set and reset).
  if (customer && customer.email) {
    const hasPassword = !!customer.portalPasswordHash;
    const rawResetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenHash = crypto.createHash("sha256").update(rawResetToken).digest("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await db.update(customersTable).set({ portalInviteToken: resetTokenHash, portalInviteExpiresAt: expiresAt, updatedAt: new Date() }).where(eq(customersTable.id, customer.id));

    const baseUrl = process.env.APP_BASE_URL || `https://${process.env.REPLIT_DOMAINS?.split(",")[0]}` || "http://localhost:3000";
    const resetUrl = `${baseUrl}/portal/set-password?token=${rawResetToken}&slug=${companySlug}`;
    const { sendPortalAccessEmail } = await import("../lib/notifications");
    await sendPortalAccessEmail({
      to: customer.email,
      customerName: customer.firstName || customer.email,
      companyName: company.name,
      companyEmail: company.email ?? undefined,
      loginUrl: resetUrl,
      intent: hasPassword ? "reset" : "set",
      expiresLabel: "in 1 hour",
      logoUrl: company.logoUrl,
      primaryColor: company.primaryColor,
    });
  }

  return res.json(genericResponse);
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
    origin: "portal_request",
    scheduledStart: scheduledDate,
    notes: notes || null,
    price: service.basePrice ?? null,
  }).returning();

  // Notify the company of the new request AND confirm to the customer
  // (fire-and-forget — never block the booking response on email).
  void (async () => {
    try {
      const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, customerId)).limit(1);
      const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
      if (!customer || !company) return;
      const customerName = `${customer.firstName} ${customer.lastName}`.trim();
      const { sendBookingRequestNotification, sendBookingConfirmationEmail, resolveCompanyNotificationEmail } = await import("../lib/notifications");

      const companyNotifyEmail = await resolveCompanyNotificationEmail(companyId, company.email);
      if (companyNotifyEmail) {
        await sendBookingRequestNotification({
          companyEmail: companyNotifyEmail,
          companyName: company.name,
          customerName,
          customerEmail: customer.email,
          customerPhone: customer.phone,
          serviceName: service.name,
          address: customer.addressLine1 ?? null,
          preferredDate: scheduledDate,
          notes: notes || null,
        });
      }

      if (customer.email) {
        await sendBookingConfirmationEmail({
          to: customer.email,
          customerName,
          companyName: company.name,
          companyEmail: company.email ?? undefined,
          companyPhone: company.phone ?? null,
          serviceName: service.name,
          preferredDate: scheduledDate,
          address: customer.addressLine1 ?? null,
          logoUrl: company.logoUrl,
          primaryColor: company.primaryColor,
        });
      }
    } catch (err) {
      logger.error({ err, companyId }, "Failed to send portal booking notifications");
    }
  })();

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
  // Customers may only cancel their own portal-submitted requests. Visits the
  // company scheduled (including recurring-generated ones) must be changed by
  // the company — the portal directs customers to contact them instead.
  if (appointment.origin !== "portal_request") {
    return res.status(403).json({ error: "CannotCancel", message: "This visit was scheduled by the company. Please contact them to make changes." });
  }
  if (!["pending", "confirmed"].includes(appointment.status)) {
    return res.status(400).json({ error: "CannotCancel", message: `Cannot cancel an appointment with status: ${appointment.status}` });
  }

  const [updated] = await db.update(appointmentsTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(appointmentsTable.id, id))
    .returning();

  // Notify the company that the customer cancelled (fire-and-forget).
  void (async () => {
    try {
      const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, customerId)).limit(1);
      const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
      if (!customer || !company) return;
      const [service] = updated.serviceId
        ? await db.select({ name: servicesTable.name }).from(servicesTable).where(eq(servicesTable.id, updated.serviceId)).limit(1)
        : [null];
      const { sendPortalCancellationNotification, resolveCompanyNotificationEmail } = await import("../lib/notifications");
      const companyNotifyEmail = await resolveCompanyNotificationEmail(companyId, company.email);
      if (!companyNotifyEmail) return;
      await sendPortalCancellationNotification({
        companyEmail: companyNotifyEmail,
        companyName: company.name,
        customerName: `${customer.firstName} ${customer.lastName}`.trim(),
        customerEmail: customer.email,
        customerPhone: customer.phone,
        serviceName: service?.name ?? null,
        scheduledStart: updated.scheduledStart,
      });
    } catch (err) {
      logger.error({ err, companyId }, "Failed to send portal cancellation notification");
    }
  })();

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

// GET /portal/invoices/:id — full detail with line items and company payment config
router.get("/invoices/:id", requirePortalAuth, async (req: any, res) => {
  const { customerId, companyId } = req.portal;
  const id = Number(req.params.id);
  const [invoice] = await db.select().from(invoicesTable)
    .where(and(eq(invoicesTable.id, id), eq(invoicesTable.customerId, customerId), eq(invoicesTable.companyId, companyId)))
    .limit(1);
  if (!invoice) return res.status(404).json({ error: "NotFound" });

  const [lineItems, company] = await Promise.all([
    db.select().from(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, id)).orderBy(invoiceLineItemsTable.sortOrder),
    db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1).then(r => r[0]),
  ]);

  const parsePaymentMethods = (raw: string | null | undefined): string[] => {
    if (!raw) return ["cash", "check"];
    try { return JSON.parse(raw); } catch { return ["cash", "check"]; }
  };

  const paymentConfig = {
    acceptedPaymentMethods: parsePaymentMethods(company?.acceptedPaymentMethods),
    paymentInstructions: company?.paymentInstructions ?? "",
    zelleInfo: company?.zelleInfo ?? "",
    venmoHandle: company?.venmoHandle ?? "",
    cashAppTag: company?.cashAppTag ?? "",
    checkPayableTo: company?.checkPayableTo ?? "",
  };

  return res.json({
    ...invoice,
    subtotal: Number(invoice.subtotal),
    tax: Number(invoice.tax),
    total: Number(invoice.total),
    lineItems: lineItems.map(li => ({
      ...li,
      quantity: Number(li.quantity),
      unitPrice: Number(li.unitPrice),
      lineTotal: Number(li.lineTotal),
    })),
    paymentConfig,
    companyName: company?.name ?? "",
    companyPlan: company?.subscriptionPlan ?? "starter",
  });
});

// GET /portal/invoices/:id/pdf — download a PDF copy of the customer's own invoice
router.get("/invoices/:id/pdf", requirePortalAuth, async (req: any, res) => {
  const { customerId, companyId } = req.portal;
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "ValidationError", message: "Invalid invoice ID" });

  const [invoice] = await db.select().from(invoicesTable)
    .where(and(eq(invoicesTable.id, id), eq(invoicesTable.customerId, customerId), eq(invoicesTable.companyId, companyId)))
    .limit(1);
  if (!invoice) return res.status(404).json({ error: "NotFound" });

  const [customer, company, lineItems] = await Promise.all([
    db.select().from(customersTable).where(eq(customersTable.id, customerId)).limit(1).then(r => r[0]),
    db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1).then(r => r[0]),
    db.select().from(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, id)).orderBy(invoiceLineItemsTable.sortOrder),
  ]);

  const { buildInvoicePdf } = await import("../lib/invoice-pdf");
  const pdfBuffer = await buildInvoicePdf({ invoice, customer, company, lineItems });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="invoice-${invoice.invoiceNumber}.pdf"`);
  return res.send(pdfBuffer);
});

// GET /portal/invoices/:id/receipt-pdf — download a proof-of-payment receipt for a paid invoice
router.get("/invoices/:id/receipt-pdf", requirePortalAuth, async (req: any, res) => {
  const { customerId, companyId } = req.portal;
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "ValidationError", message: "Invalid invoice ID" });

  const [invoice] = await db.select().from(invoicesTable)
    .where(and(eq(invoicesTable.id, id), eq(invoicesTable.customerId, customerId), eq(invoicesTable.companyId, companyId)))
    .limit(1);
  if (!invoice) return res.status(404).json({ error: "NotFound" });
  if (invoice.status !== "paid") return res.status(400).json({ error: "NotPaid", message: "A receipt is only available for paid invoices." });

  const [customer, company, lineItems] = await Promise.all([
    db.select().from(customersTable).where(eq(customersTable.id, customerId)).limit(1).then(r => r[0]),
    db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1).then(r => r[0]),
    db.select().from(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, id)).orderBy(invoiceLineItemsTable.sortOrder),
  ]);

  const { buildInvoicePdf } = await import("../lib/invoice-pdf");
  const pdfBuffer = await buildInvoicePdf({ invoice, customer, company, lineItems, documentType: "receipt" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="receipt-${invoice.invoiceNumber}.pdf"`);
  return res.send(pdfBuffer);
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

  // --- PLAN ENFORCEMENT: only Growth/Pro companies can accept online card payments ---
  const plan = company?.subscriptionPlan ?? "starter";
  if (!["growth", "pro"].includes(plan)) {
    return res.status(403).json({ error: "PlanRequired", message: "Online card payments require a Growth or Pro plan." });
  }

  // --- PAYMENT METHOD ENFORCEMENT: company must have 'card' in accepted methods ---
  const parseAcceptedMethods = (raw: string | null | undefined): string[] => {
    if (!raw) return ["cash", "check"];
    try { return JSON.parse(raw); } catch { return ["cash", "check"]; }
  };
  const acceptedMethods: string[] = parseAcceptedMethods(company?.acceptedPaymentMethods);
  if (!acceptedMethods.includes("card")) {
    return res.status(403).json({ error: "PaymentMethodNotEnabled", message: "Online card payments are not enabled for this company." });
  }

  let stripe: any;
  try {
    const { getUncachableStripeClient } = await import("../lib/stripe");
    stripe = await getUncachableStripeClient();
  } catch {
    return res.status(503).json({ error: "BillingUnavailable", message: "Payment processing not configured" });
  }

  // --- CONNECT ENFORCEMENT: company must have a connected Stripe account ---
  if (!company.stripeConnectAccountId) {
    return res.status(403).json({
      error: "ConnectRequired",
      message: "This company has not connected their Stripe account yet. Online payments are not available.",
    });
  }

  // Verify the Connect account can accept charges via V2 API (falls back to V1 for legacy accounts)
  try {
    let readyToProcessPayments = false;
    try {
      const account = await (stripe as any).v2.core.accounts.retrieve(
        company.stripeConnectAccountId,
        { include: ["configuration.merchant"] },
      );
      readyToProcessPayments =
        account?.configuration?.merchant?.capabilities?.card_payments?.status === "active";
    } catch {
      // V1 fallback for legacy Express accounts
      const v1Account = await stripe.accounts.retrieve(company.stripeConnectAccountId);
      readyToProcessPayments = v1Account.charges_enabled ?? false;
    }
    if (!readyToProcessPayments) {
      return res.status(403).json({
        error: "ConnectIncomplete",
        message: "The company's Stripe account setup is not complete. Online payments are temporarily unavailable.",
      });
    }
  } catch {
    return res.status(503).json({ error: "ConnectError", message: "Could not verify payment account." });
  }

  const baseUrl = process.env.APP_BASE_URL || `https://${process.env.REPLIT_DOMAINS?.split(",")[0]}` || "http://localhost:3000";
  const amountCents = Math.round(Number(invoice.total) * 100);

  // Optional platform fee (e.g. 0.5%) — set STRIPE_PLATFORM_FEE_PERCENT env var to enable
  const platformFeePercent = parseFloat(process.env.STRIPE_PLATFORM_FEE_PERCENT || "0");
  const applicationFeeAmount = platformFeePercent > 0
    ? Math.round(amountCents * (platformFeePercent / 100))
    : 0;

  // Create a Stripe Checkout session routed to the company's Connect account
  const sessionParams: any = {
    mode: "payment",
    payment_method_types: ["card"],
    customer_email: customer.email || undefined,
    line_items: [{
      price_data: {
        currency: "usd",
        unit_amount: amountCents,
        product_data: { name: `Invoice ${invoice.invoiceNumber} — ${company.name}` },
      },
      quantity: 1,
    }],
    success_url: `${baseUrl}/portal/${company.slug}?payment=success&invoice=${invoice.id}`,
    cancel_url: `${baseUrl}/portal/${company.slug}/invoices`,
    metadata: { invoiceId: String(invoice.id), companyId: String(companyId), customerId: String(customerId), source: "customer_portal" },
    payment_intent_data: {
      application_fee_amount: applicationFeeAmount > 0 ? applicationFeeAmount : undefined,
      transfer_data: { destination: company.stripeConnectAccountId },
    },
  };
  // Concurrency guard: two near-simultaneous pay requests (e.g. a double-click)
  // could otherwise each create their own Checkout Session for the same unpaid
  // invoice. A stable idempotency key keyed on the invoice + amount makes Stripe
  // return the SAME session for concurrent/retried creates, so only one charge
  // path is ever opened. (The downstream confirm-payment + webhook handlers are
  // already transition-guarded on status, so the invoice still can't be marked
  // paid — or notified — twice.)
  const session = await stripe.checkout.sessions.create(sessionParams, {
    idempotencyKey: `portal-checkout-inv-${invoice.id}-${amountCents}`,
  });

  // Store checkout session ID so confirm-payment can retrieve and verify it.
  // Guard on status so a session id can't clobber an invoice that was paid in
  // the meantime.
  await db.update(invoicesTable).set({ stripePaymentIntentId: session.id, updatedAt: new Date() })
    .where(and(eq(invoicesTable.id, id), ne(invoicesTable.status, "paid")));

  return res.json({ url: session.url });
});

// POST /portal/invoices/:id/confirm-payment
// Called by the portal client on the payment-success redirect as a reliable
// fallback for when the Stripe webhook hasn't fired yet. Retrieves the stored
// checkout session, verifies payment_status === "paid", and marks the invoice.
router.post("/invoices/:id/confirm-payment", requirePortalAuth, async (req: any, res) => {
  const { customerId, companyId } = req.portal;
  const id = Number(req.params.id);

  const [invoice] = await db.select().from(invoicesTable)
    .where(and(eq(invoicesTable.id, id), eq(invoicesTable.customerId, customerId), eq(invoicesTable.companyId, companyId)))
    .limit(1);
  if (!invoice) return res.status(404).json({ error: "NotFound" });

  if (invoice.status === "paid") return res.json({ confirmed: true });

  if (!invoice.stripePaymentIntentId) {
    return res.status(400).json({ error: "NoPendingPayment", message: "No pending payment session found for this invoice." });
  }

  let stripe: any;
  try {
    const { getUncachableStripeClient } = await import("../lib/stripe");
    stripe = await getUncachableStripeClient();
  } catch {
    return res.status(503).json({ error: "BillingUnavailable", message: "Payment processing not available." });
  }

  const session = await stripe.checkout.sessions.retrieve(invoice.stripePaymentIntentId);
  if (!session || session.payment_status !== "paid") {
    return res.status(402).json({ error: "NotPaid", message: "Payment not yet confirmed by Stripe." });
  }

  // Transition-guarded update: the webhook (billing.ts) may mark this invoice
  // paid concurrently between the pre-read guard above and here, so only the
  // request that actually flips status -> paid sends notifications. Prevents
  // duplicate receipt + owner emails in the webhook/fallback race.
  const transitioned = await db.update(invoicesTable).set({
    status: "paid",
    paidAt: new Date(),
    updatedAt: new Date(),
  }).where(and(eq(invoicesTable.id, id), ne(invoicesTable.status, "paid"))).returning({ id: invoicesTable.id });

  if (transitioned.length > 0) {
    const { dispatchPaymentReceiptEmail, dispatchOwnerPaymentNotification } = await import("../lib/notifications");
    dispatchPaymentReceiptEmail(id, companyId);
    dispatchOwnerPaymentNotification(id, companyId);
  }

  return res.json({ confirmed: true });
});

export default router;
