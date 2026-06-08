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

  // Fire customer_created automations (non-blocking)
  fireAutomations(companyId, "customer_created", { customerId: customer.id, userId });

  // Auto-send portal invite (Growth+ feature — customer portal is not part of Starter)
  let portalUrl: string | undefined;
  try {
    const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
    if (company && hasFeature(company.subscriptionPlan, "customer_portal") && (customer.email || customer.phone)) {
      const inviteToken = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await db.update(customersTable).set({ portalInviteToken: inviteToken, portalInviteExpiresAt: expiresAt, updatedAt: new Date() }).where(eq(customersTable.id, customer.id));
      const baseUrl = process.env.APP_BASE_URL || `https://${process.env.REPLIT_DOMAINS?.split(",")[0]}`;
      // Passwordless magic link — clicking it signs the customer straight into the portal.
      portalUrl = `${baseUrl}/portal/${company.slug}/login?token=${inviteToken}`;
      const { sendSMS, sendPortalAccessEmail } = await import("../lib/notifications");
      if (customer.email) {
        await sendPortalAccessEmail({ to: customer.email, customerName: customer.firstName || customer.email, companyName: company.name, companyEmail: company.email ?? undefined, loginUrl: portalUrl, intent: "invite", expiresLabel: "in 7 days" });
      }
      if (customer.phone && hasFeature(company.subscriptionPlan, "sms_notifications")) {
        await sendSMS({ to: customer.phone, body: `${company.name} has invited you to your customer portal. Sign in here (no password needed): ${portalUrl}` });
      }
    }
  } catch { /* non-fatal — invite can be re-sent from customer detail */ }

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
