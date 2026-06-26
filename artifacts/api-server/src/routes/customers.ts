import { Router } from "express";
import { z } from "zod";
import { db, customersTable, propertiesTable, appointmentsTable, invoicesTable, companiesTable } from "@workspace/db";
import { eq, and, ilike, sql, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { requireActiveSubscription } from "../lib/subscription";
import { requireWithinPlanLimit, hasFeature } from "../lib/features";
import { logActivity } from "../lib/activity";
import { fireAutomations } from "../lib/automations";
import crypto from "crypto";

const customerBodySchema = z.object({
  firstName: z.string().max(100).optional().default(""),
  lastName: z.string().max(100).optional().default(""),
  email: z.string().email().optional().nullable(),
  phone: z.string().min(7).max(30),
  addressLine1: z.string().max(255).optional().nullable(),
  addressLine2: z.string().max(255).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(50).optional().nullable(),
  zip: z.string().max(20).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  leadSource: z.string().max(100).optional().nullable(),
  tags: z.array(z.string()).optional(),
});

const router = Router();
router.use(requireAuth);
router.use(requireActiveSubscription);

router.get("/", async (req: any, res) => {
  const { companyId } = req.user;
  const search = req.query.search as string;
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const offset = (page - 1) * limit;

  let conditions = [eq(customersTable.companyId, companyId)];
  if (search) {
    conditions.push(
      sql`(${customersTable.firstName} || ' ' || ${customersTable.lastName} ilike ${'%' + search + '%'} OR ${customersTable.email} ilike ${'%' + search + '%'} OR ${customersTable.phone} ilike ${'%' + search + '%'})`
    );
  }

  const [customers, totalResult] = await Promise.all([
    db.select().from(customersTable).where(and(...conditions)).orderBy(desc(customersTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(customersTable).where(and(...conditions)),
  ]);

  return res.json({ customers, total: Number(totalResult[0].count), page, limit });
});

router.post("/", requireWithinPlanLimit("customers"), async (req: any, res) => {
  const parsed = customerBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "ValidationError", message: parsed.error.message });
  }
  const { companyId, userId } = req.user;
  const [customer] = await db.insert(customersTable).values({
    companyId,
    ...parsed.data,
    tags: parsed.data.tags ?? [],
  }).returning();
  await logActivity({ companyId, userId, action: "customer.created", entityType: "customer", entityId: customer.id });

  // Mirror the customer's service address into a property record so scheduling /
  // routing have something to work with from day one.
  if (parsed.data.addressLine1) {
    await db.insert(propertiesTable).values({
      companyId,
      customerId: customer.id,
      addressLine1: parsed.data.addressLine1,
      addressLine2: parsed.data.addressLine2 ?? null,
      city: parsed.data.city ?? null,
      state: parsed.data.state ?? null,
      zip: parsed.data.zip ?? null,
    });
  }

  // Fire customer_created automations (non-blocking)
  fireAutomations(companyId, "customer_created", { customerId: customer.id, userId });

  // Welcome the new customer. Growth+ gets a customer-portal invite; plans
  // without the portal (e.g. Starter) still get a self-scheduling link to the
  // public booking page so the customer can book appointments online.
  let portalUrl: string | undefined;
  try {
    const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
    if (company) {
      const baseUrl = process.env.APP_BASE_URL || `https://${process.env.REPLIT_DOMAINS?.split(",")[0]}`;
      const { sendPortalAccessEmail, sendCustomerWelcomeBookingEmail } = await import("../lib/notifications");
      const { sendSMSWithConsent } = await import("../lib/sms-consent");
      if (hasFeature(company.subscriptionPlan, "customer_portal") && (customer.email || customer.phone)) {
        const inviteToken = crypto.randomBytes(32).toString("hex");
        // Store only the SHA-256 hash; the raw token lives solely in the emailed/SMS
        // link. Verification endpoints (portal set-password/login) hash the incoming
        // token and compare against this stored hash, so the two must match.
        const inviteTokenHash = crypto.createHash("sha256").update(inviteToken).digest("hex");
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await db.update(customersTable).set({ portalInviteToken: inviteTokenHash, portalInviteExpiresAt: expiresAt, updatedAt: new Date() }).where(eq(customersTable.id, customer.id));
        // Invite link takes customers to the set-password page so they create a password on first access.
        portalUrl = `${baseUrl}/portal/set-password?token=${inviteToken}&slug=${company.slug}`;
        if (customer.email) {
          await sendPortalAccessEmail({ to: customer.email, customerName: customer.firstName || customer.email, companyName: company.name, companyEmail: company.email ?? undefined, loginUrl: portalUrl, intent: "invite", expiresLabel: "in 7 days", logoUrl: company.logoUrl, primaryColor: company.primaryColor });
        }
        if (customer.phone && hasFeature(company.subscriptionPlan, "sms_notifications")) {
          await sendSMSWithConsent({ to: customer.phone, body: `${company.name} has invited you to your customer portal. Create your password here: ${portalUrl}`, category: "service_updates", subject: { type: "customer", id: customer.id, companyId: company.id } });
        }
      } else if (customer.email && company.slug && hasFeature(company.subscriptionPlan, "public_booking")) {
        const bookingUrl = `${baseUrl}/book/${company.slug}`;
        await sendCustomerWelcomeBookingEmail({
          to: customer.email,
          customerName: customer.firstName || customer.email,
          companyName: company.name,
          companyEmail: company.email ?? undefined,
          companyPhone: company.phone ?? null,
          bookingUrl,
          logoUrl: company.logoUrl,
          primaryColor: company.primaryColor,
        });
      }
    }
  } catch { /* non-fatal — invite/booking link can be re-sent from customer detail */ }

  return res.status(201).json({ ...customer, portalUrl });
});

router.get("/:id", async (req: any, res) => {
  const { companyId } = req.user;
  const id = Number(req.params.id);

  const [customer] = await db.select().from(customersTable).where(and(eq(customersTable.id, id), eq(customersTable.companyId, companyId))).limit(1);
  if (!customer) return res.status(404).json({ error: "NotFound" });

  const [properties, recentAppointments, recentInvoices] = await Promise.all([
    db.select().from(propertiesTable).where(and(eq(propertiesTable.customerId, id), eq(propertiesTable.companyId, companyId))),
    db.select().from(appointmentsTable).where(and(eq(appointmentsTable.customerId, id), eq(appointmentsTable.companyId, companyId))).orderBy(desc(appointmentsTable.scheduledStart)).limit(10),
    db.select().from(invoicesTable).where(and(eq(invoicesTable.customerId, id), eq(invoicesTable.companyId, companyId))).orderBy(desc(invoicesTable.createdAt)).limit(10),
  ]);

  return res.json({ customer, properties, recentAppointments, recentInvoices });
});

router.put("/:id", async (req: any, res) => {
  const parsed = customerBodySchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "ValidationError", message: parsed.error.message });
  }
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(customersTable).where(and(eq(customersTable.id, id), eq(customersTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });
  const [updated] = await db.update(customersTable).set({ ...parsed.data, updatedAt: new Date() }).where(and(eq(customersTable.id, id), eq(customersTable.companyId, companyId))).returning();
  await logActivity({ companyId, userId, action: "customer.updated", entityType: "customer", entityId: id });

  // Keep the customer's primary property address in sync. Update the oldest
  // property if one exists, otherwise create one from the new address.
  if (parsed.data.addressLine1 !== undefined && parsed.data.addressLine1) {
    const addressFields = {
      addressLine1: parsed.data.addressLine1,
      addressLine2: parsed.data.addressLine2 ?? null,
      city: parsed.data.city ?? null,
      state: parsed.data.state ?? null,
      zip: parsed.data.zip ?? null,
    };
    const [primary] = await db.select().from(propertiesTable)
      .where(and(eq(propertiesTable.customerId, id), eq(propertiesTable.companyId, companyId)))
      .orderBy(propertiesTable.id).limit(1);
    if (primary) {
      await db.update(propertiesTable).set({ ...addressFields, updatedAt: new Date() }).where(eq(propertiesTable.id, primary.id));
    } else {
      await db.insert(propertiesTable).values({ companyId, customerId: id, ...addressFields });
    }
  }
  return res.json(updated);
});

router.delete("/:id", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);

  const [existing] = await db.select().from(customersTable).where(and(eq(customersTable.id, id), eq(customersTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });

  await db.delete(customersTable).where(and(eq(customersTable.id, id), eq(customersTable.companyId, companyId)));
  await logActivity({ companyId, userId, action: "customer.deleted", entityType: "customer", entityId: id });
  return res.json({ success: true });
});

export default router;
