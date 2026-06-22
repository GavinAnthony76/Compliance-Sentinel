import { Router } from "express";
import { db, companiesTable, usersTable, customersTable, platformAdminsTable, appointmentsTable, invoicesTable, activityLogsTable, leadsTable, followUpCampaignsTable, followUpLogsTable, communicationEventsTable } from "@workspace/db";
import { eq, sql, desc, ilike, and, inArray, or } from "drizzle-orm";
import { requireAdminAuth, hashPassword } from "../lib/auth";
import { logActivity } from "../lib/activity";
import { logger } from "../lib/logger";
import { getPlanUsageSummary, type Plan } from "../lib/features";
import { isEmailConfigured } from "../lib/resend";
import { sendAdminDeactivationEmail, sendAdminReactivationEmail, resolveBaseUrl } from "../lib/notifications";
import { getCatalog } from "../lib/plan-catalog";
import { deactivateStaleAdmins } from "../lib/stale-admins";
import { getPlatformSettings, updatePlatformSettings, MIN_STALE_ADMIN_DAYS, MAX_STALE_ADMIN_DAYS } from "../lib/platform-settings";
import { z } from "zod";

// MRR-per-plan (in cents) and labels are derived from the DB-backed plan
// catalog (the single source of truth for plan pricing) at request time.
function planMrrCents(planId: string | null): number {
  const plan = getCatalog().find(p => p.id === planId);
  return plan ? plan.price * 100 : 0;
}
function planLabel(planId: string | null): string {
  const plan = getCatalog().find(p => p.id === planId);
  return plan ? `${plan.name} ($${plan.price})` : (planId ?? "");
}

// Contact address surfaced to a deactivated admin so they know who to reach to
// restore access. Falls back to a sensible default when no override is set.
function resolveAdminSupportEmail(): string {
  return process.env.ADMIN_SUPPORT_EMAIL || process.env.RESEND_FROM_EMAIL || "support@greensynk.com";
}

const router = Router();
router.use(requireAdminAuth);

// Block all admin functionality until a forced password change is completed.
// The change happens via /admin/auth/change-password (mounted separately), so
// this gate cannot lock an admin out of resolving it.
router.use(async (req: any, res, next) => {
  try {
    const { adminId } = req.admin;
    const [admin] = await db
      .select({ mustChangePassword: platformAdminsTable.mustChangePassword })
      .from(platformAdminsTable)
      .where(eq(platformAdminsTable.id, adminId))
      .limit(1);
    if (admin?.mustChangePassword) {
      res.status(403).json({
        error: "PasswordChangeRequired",
        message: "You must change your password before continuing.",
      });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
});

// ─── Dashboard ────────────────────────────────────────────────────────────────
router.get("/dashboard", async (_req, res) => {
  const [
    totalCompanies,
    activeSubscriptions,
    trialingAccounts,
    pastDueAccounts,
    canceledAccounts,
    totalAppointments,
    totalInvoices,
    recentSignups,
    planBreakdown,
    totalUsers,
    totalCustomers,
    recentActivity,
    monthlySignups,
    paidRevenue,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(companiesTable),
    db.select({ count: sql<number>`count(*)` }).from(companiesTable).where(eq(companiesTable.subscriptionStatus, "active")),
    db.select({ count: sql<number>`count(*)` }).from(companiesTable).where(eq(companiesTable.subscriptionStatus, "trialing")),
    db.select({ count: sql<number>`count(*)` }).from(companiesTable).where(eq(companiesTable.subscriptionStatus, "past_due")),
    db.select({ count: sql<number>`count(*)` }).from(companiesTable).where(eq(companiesTable.subscriptionStatus, "canceled")),
    db.select({ count: sql<number>`count(*)` }).from(appointmentsTable),
    db.select({ count: sql<number>`count(*)` }).from(invoicesTable),
    db.select().from(companiesTable).orderBy(desc(companiesTable.createdAt)).limit(5),
    db.select({ plan: companiesTable.subscriptionPlan, count: sql<number>`count(*)` })
      .from(companiesTable)
      .where(eq(companiesTable.subscriptionStatus, "active"))
      .groupBy(companiesTable.subscriptionPlan),
    db.select({ count: sql<number>`count(*)` }).from(usersTable),
    db.select({ count: sql<number>`count(*)` }).from(customersTable),
    db.select().from(activityLogsTable).orderBy(desc(activityLogsTable.createdAt)).limit(8),
    db.select({
      month: sql<string>`to_char(created_at, 'YYYY-MM')`,
      count: sql<number>`count(*)`,
    }).from(companiesTable).where(sql`created_at >= now() - interval '6 months'`)
      .groupBy(sql`to_char(created_at, 'YYYY-MM')`)
      .orderBy(sql`to_char(created_at, 'YYYY-MM')`),
    db.select({ total: sql<number>`coalesce(sum(total::numeric), 0)` }).from(invoicesTable).where(eq(invoicesTable.status, "paid")),
  ]);

  const mrr = planBreakdown.reduce((sum, row) => sum + (planMrrCents(row.plan)) * Number(row.count), 0);

  // Enrich activity with company names
  const companyIds = [...new Set(recentActivity.map(l => l.companyId).filter(Boolean))] as number[];
  const companies = companyIds.length > 0
    ? await db.select({ id: companiesTable.id, name: companiesTable.name }).from(companiesTable).where(inArray(companiesTable.id, companyIds))
    : [];
  const companyMap = Object.fromEntries(companies.map(c => [c.id, c.name]));

  return res.json({
    totalCompanies: Number(totalCompanies[0].count),
    activeSubscriptions: Number(activeSubscriptions[0].count),
    trialingAccounts: Number(trialingAccounts[0].count),
    pastDueAccounts: Number(pastDueAccounts[0].count),
    canceledAccounts: Number(canceledAccounts[0].count),
    totalAppointments: Number(totalAppointments[0].count),
    totalInvoices: Number(totalInvoices[0].count),
    totalUsers: Number(totalUsers[0].count),
    totalCustomers: Number(totalCustomers[0].count),
    totalRevenue: Number(paidRevenue[0]?.total ?? 0),
    mrr,
    recentSignups,
    recentActivity: recentActivity.map(l => ({ ...l, companyName: l.companyId ? companyMap[l.companyId] ?? null : null })),
    monthlySignups: monthlySignups.map(m => ({ month: m.month, count: Number(m.count) })),
    planBreakdown: Object.fromEntries(planBreakdown.map(p => [p.plan, Number(p.count)])),
  });
});

// ─── Beta Readiness ─────────────────────────────────────────────────────────
router.get("/beta-readiness", async (_req, res) => {
  const [
    totalCompanies,
    betaTenants,
    pendingFollowUps,
    failedCommunications,
    missingBilling,
    missingSlug,
    usersWithoutRole,
    apptsWithoutCustomer,
    recentActivity,
    recentErrors,
    lastAutomation,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(companiesTable),
    db.select().from(companiesTable).where(eq(companiesTable.betaEnabled, true)).orderBy(desc(companiesTable.createdAt)),
    db.select({ count: sql<number>`count(*)` }).from(followUpLogsTable).where(eq(followUpLogsTable.status, "pending")),
    db.select({ count: sql<number>`count(*)` }).from(communicationEventsTable).where(eq(communicationEventsTable.status, "failed")),
    db.select({ count: sql<number>`count(*)` }).from(companiesTable).where(or(sql`subscription_status is null`, sql`subscription_status = ''`)),
    db.select({ count: sql<number>`count(*)` }).from(companiesTable).where(or(sql`slug is null`, sql`slug = ''`)),
    db.select({ count: sql<number>`count(*)` }).from(usersTable).where(or(sql`role is null`, sql`role = ''`)),
    db.select({ count: sql<number>`count(*)` }).from(appointmentsTable).where(sql`customer_id is null`),
    db.select().from(activityLogsTable).orderBy(desc(activityLogsTable.createdAt)).limit(10),
    db.select().from(activityLogsTable).where(ilike(activityLogsTable.action, "%error%")).orderBy(desc(activityLogsTable.createdAt)).limit(10),
    db.select().from(activityLogsTable).where(ilike(activityLogsTable.action, "automation%")).orderBy(desc(activityLogsTable.createdAt)).limit(1),
  ]);

  // DB connectivity: if the queries above resolved, the DB is reachable.
  let dbConnected = true;
  try {
    await db.select({ ok: sql<number>`1` }).from(companiesTable).limit(1);
  } catch {
    dbConnected = false;
  }

  const emailConfigured = await isEmailConfigured();
  const integrations = {
    stripe: { configured: !!(process.env.STRIPE_SECRET_KEY || process.env.REPLIT_CONNECTORS_HOSTNAME), label: "Stripe" },
    sendgrid: { configured: emailConfigured, label: "Resend (Email)" },
    twilio: { configured: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER), label: "Twilio (SMS)" },
    openai: { configured: !!(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL && process.env.AI_INTEGRATIONS_OPENAI_API_KEY), label: "OpenAI (AI Estimates)" },
    database: { configured: dbConnected, label: "Database" },
  };

  // Enrich activity with company names
  const allLogs = [...recentActivity, ...recentErrors];
  const companyIds = [...new Set(allLogs.map(l => l.companyId).filter(Boolean))] as number[];
  const companies = companyIds.length > 0
    ? await db.select({ id: companiesTable.id, name: companiesTable.name }).from(companiesTable).where(inArray(companiesTable.id, companyIds))
    : [];
  const companyMap = Object.fromEntries(companies.map(c => [c.id, c.name]));
  const withName = (l: any) => ({ ...l, companyName: l.companyId ? companyMap[l.companyId] ?? null : null });

  return res.json({
    counts: {
      totalCompanies: Number(totalCompanies[0].count),
      betaTenants: betaTenants.length,
      pendingFollowUps: Number(pendingFollowUps[0].count),
      failedCommunications: Number(failedCommunications[0].count),
    },
    dataIntegrity: {
      companiesMissingBilling: Number(missingBilling[0].count),
      companiesMissingSlug: Number(missingSlug[0].count),
      usersWithoutRole: Number(usersWithoutRole[0].count),
      appointmentsWithoutCustomer: Number(apptsWithoutCustomer[0].count),
    },
    integrations,
    betaTenants: betaTenants.map(c => ({ id: c.id, name: c.name, slug: c.slug, subscriptionPlan: c.subscriptionPlan, subscriptionStatus: c.subscriptionStatus, isActive: c.isActive })),
    lastAutomationRun: lastAutomation[0] ? withName(lastAutomation[0]) : null,
    recentActivity: recentActivity.map(withName),
    recentErrors: recentErrors.map(withName),
  });
});

// Toggle a company's beta tenant flag
router.put("/companies/:id/beta", async (req: any, res) => {
  const id = Number(req.params.id);
  const betaEnabled = !!req.body?.betaEnabled;
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, id)).limit(1);
  if (!company) return res.status(404).json({ error: "NotFound" });
  await db.update(companiesTable).set({ betaEnabled, updatedAt: new Date() }).where(eq(companiesTable.id, id));
  await logActivity({ adminId: req.admin.adminId, action: "admin.company_beta_toggled", entityType: "company", entityId: id, metadata: { betaEnabled } });
  return res.json({ success: true, betaEnabled });
});

// ─── Revenue ──────────────────────────────────────────────────────────────────
router.get("/revenue", async (_req, res) => {
  const [
    planBreakdown,
    statusBreakdown,
    paidInvoices,
    totalCustomers,
    monthlySignups,
    pastDueCompanies,
  ] = await Promise.all([
    db.select({ plan: companiesTable.subscriptionPlan, count: sql<number>`count(*)` })
      .from(companiesTable)
      .where(eq(companiesTable.subscriptionStatus, "active"))
      .groupBy(companiesTable.subscriptionPlan),
    db.select({ status: companiesTable.subscriptionStatus, count: sql<number>`count(*)` })
      .from(companiesTable)
      .groupBy(companiesTable.subscriptionStatus),
    db.select({
      count: sql<number>`count(*)`,
      total: sql<number>`coalesce(sum(total::numeric), 0)`,
    }).from(invoicesTable).where(eq(invoicesTable.status, "paid")),
    db.select({ count: sql<number>`count(*)` }).from(customersTable),
    db.select({
      month: sql<string>`to_char(created_at, 'YYYY-MM')`,
      count: sql<number>`count(*)`,
    }).from(companiesTable).where(sql`created_at >= now() - interval '6 months'`)
      .groupBy(sql`to_char(created_at, 'YYYY-MM')`)
      .orderBy(sql`to_char(created_at, 'YYYY-MM')`),
    db.select().from(companiesTable).where(eq(companiesTable.subscriptionStatus, "past_due")).limit(20),
  ]);

  const mrr = planBreakdown.reduce((sum, row) => sum + (planMrrCents(row.plan)) * Number(row.count), 0);
  const statusMap = Object.fromEntries(statusBreakdown.map(s => [s.status, Number(s.count)]));

  const planData = Object.fromEntries(
    planBreakdown.map(p => [p.plan, {
      count: Number(p.count),
      mrr: (planMrrCents(p.plan)) * Number(p.count),
      label: planLabel(p.plan),
    }])
  );

  return res.json({
    mrr,
    planBreakdown: planData,
    statusBreakdown: statusMap,
    totalCustomers: Number(totalCustomers[0]?.count ?? 0),
    paidInvoicesCount: Number(paidInvoices[0]?.count ?? 0),
    totalRevenue: Number(paidInvoices[0]?.total ?? 0),
    monthlySignups: monthlySignups.map(m => ({ month: m.month, count: Number(m.count) })),
    pastDueCompanies,
  });
});

// ─── Companies ────────────────────────────────────────────────────────────────
router.get("/companies", async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const search = req.query.search as string;
  const plan = req.query.plan as string;
  const status = req.query.status as string;

  const conditions: any[] = [];
  if (search) conditions.push(ilike(companiesTable.name, `%${search}%`));
  if (plan) conditions.push(eq(companiesTable.subscriptionPlan, plan));
  if (status) conditions.push(eq(companiesTable.subscriptionStatus, status));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [companies, total] = await Promise.all([
    db.select().from(companiesTable).where(whereClause).orderBy(desc(companiesTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(companiesTable).where(whereClause),
  ]);

  const enriched = await Promise.all(companies.map(async (c) => {
    const [owner, custCount, apptCount] = await Promise.all([
      db.select().from(usersTable).where(and(eq(usersTable.companyId, c.id), eq(usersTable.role, "owner"))).limit(1),
      db.select({ count: sql<number>`count(*)` }).from(customersTable).where(eq(customersTable.companyId, c.id)),
      db.select({ count: sql<number>`count(*)` }).from(appointmentsTable).where(eq(appointmentsTable.companyId, c.id)),
    ]);
    return {
      ...c,
      ownerName: owner[0] ? `${owner[0].firstName} ${owner[0].lastName}` : null,
      ownerEmail: owner[0]?.email ?? null,
      customersCount: Number(custCount[0].count),
      appointmentsCount: Number(apptCount[0].count),
    };
  }));

  return res.json({ companies: enriched, total: Number(total[0].count), page, limit });
});

router.get("/companies/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, id)).limit(1);
  if (!company) return res.status(404).json({ error: "NotFound" });

  const [users, recentActivity] = await Promise.all([
    db.select({ id: usersTable.id, companyId: usersTable.companyId, firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email, role: usersTable.role, phone: usersTable.phone, isActive: usersTable.isActive, lastLoginAt: usersTable.lastLoginAt, createdAt: usersTable.createdAt }).from(usersTable).where(eq(usersTable.companyId, id)),
    db.select().from(activityLogsTable).where(eq(activityLogsTable.companyId, id)).orderBy(desc(activityLogsTable.createdAt)).limit(10),
  ]);

  const [custCount, apptCount, owner, invoiceSummary, usage] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(customersTable).where(eq(customersTable.companyId, id)),
    db.select({ count: sql<number>`count(*)` }).from(appointmentsTable).where(eq(appointmentsTable.companyId, id)),
    db.select().from(usersTable).where(and(eq(usersTable.companyId, id), eq(usersTable.role, "owner"))).limit(1),
    db.select({
      total: sql<number>`count(*)`,
      paid: sql<number>`sum(case when status='paid' then 1 else 0 end)`,
      revenue: sql<number>`coalesce(sum(case when status='paid' then total::numeric else 0 end), 0)`,
    }).from(invoicesTable).where(eq(invoicesTable.companyId, id)),
    getPlanUsageSummary(id),
  ]);

  // Flag usage at/near plan limits so admins can spot accounts that need attention.
  const limitFlags = (Object.entries(usage.usage) as [keyof typeof usage.usage, number][]).map(([metric, current]) => {
    const limitKey = ({
      customers: "maxCustomers", users: "maxUsers", appointments: "maxAppointmentsPerMonth",
      estimates: "maxEstimatesPerMonth", invoices: "maxInvoicesPerMonth",
    } as const)[metric];
    const limit = usage.limits[limitKey];
    if (limit === null) return { metric, current, limit: null, status: "unlimited" as const };
    const pct = limit > 0 ? current / limit : 0;
    const status = current >= limit ? "over" : pct >= 0.8 ? "near" : "ok";
    return { metric, current, limit, status };
  });

  return res.json({
    company: {
      ...company,
      ownerName: owner[0] ? `${owner[0].firstName} ${owner[0].lastName}` : null,
      ownerEmail: owner[0]?.email ?? null,
      customersCount: Number(custCount[0].count),
      appointmentsCount: Number(apptCount[0].count),
      invoicesTotal: Number(invoiceSummary[0]?.total ?? 0),
      invoicesPaid: Number(invoiceSummary[0]?.paid ?? 0),
      revenue: Number(invoiceSummary[0]?.revenue ?? 0),
    },
    usage: { plan: usage.plan, limits: usage.limits, current: usage.usage, flags: limitFlags },
    users,
    recentActivity,
  });
});

const updateCompanySchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  subscriptionStatus: z.enum(["active", "trialing", "past_due", "canceled"]).optional(),
});

router.put("/companies/:id", async (req: any, res) => {
  const id = Number(req.params.id);
  const parsed = updateCompanySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "ValidationError", message: parsed.error.message });
  const fields = parsed.data;
  if (Object.keys(fields).length === 0) return res.status(400).json({ error: "NoFields", message: "No fields to update" });
  await db.update(companiesTable).set({ ...fields, updatedAt: new Date() }).where(eq(companiesTable.id, id));
  await logActivity({ adminId: req.admin.adminId, action: "admin.company_updated", entityType: "company", entityId: id, metadata: fields });
  return res.json({ success: true });
});

router.post("/companies/:id/suspend", async (req: any, res) => {
  const id = Number(req.params.id);
  await db.update(companiesTable).set({ isActive: false, updatedAt: new Date() }).where(eq(companiesTable.id, id));
  await logActivity({ adminId: req.admin.adminId, action: "admin.company_suspended", entityType: "company", entityId: id });
  return res.json({ success: true });
});

router.post("/companies/:id/activate", async (req: any, res) => {
  const id = Number(req.params.id);
  await db.update(companiesTable).set({ isActive: true, updatedAt: new Date() }).where(eq(companiesTable.id, id));
  await logActivity({ adminId: req.admin.adminId, action: "admin.company_activated", entityType: "company", entityId: id });
  return res.json({ success: true });
});

router.put("/companies/:id/plan", async (req: any, res) => {
  const id = Number(req.params.id);
  const plan = req.body?.plan;
  if (!plan || !["starter", "growth", "pro"].includes(plan)) return res.status(400).json({ error: "InvalidPlan", message: "Valid plan required: starter, growth, or pro" });
  const [existing] = await db.select({ subscriptionPlan: companiesTable.subscriptionPlan }).from(companiesTable).where(eq(companiesTable.id, id)).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });
  await db.update(companiesTable).set({ subscriptionPlan: plan, updatedAt: new Date() }).where(eq(companiesTable.id, id));
  // Manual platform-admin plan changes are audited with both the prior and new plan
  // so support/billing can reconstruct who changed what and when.
  await logActivity({
    adminId: req.admin.adminId,
    action: "admin.company_plan_changed",
    entityType: "company",
    entityId: id,
    metadata: { fromPlan: existing.subscriptionPlan ?? "none", toPlan: plan },
  });
  return res.json({ success: true });
});

router.put("/companies/:id/notes", async (req: any, res) => {
  const id = Number(req.params.id);
  const notes = req.body?.notes ?? null;
  await db.update(companiesTable).set({ internalNotes: notes, updatedAt: new Date() }).where(eq(companiesTable.id, id));
  await logActivity({ adminId: req.admin.adminId, action: "admin.company_notes_updated", entityType: "company", entityId: id });
  return res.json({ success: true });
});

const createCompanySchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  plan: z.enum(["starter", "growth", "pro"]).default("starter"),
  ownerFirstName: z.string().min(1),
  ownerLastName: z.string().min(1),
  ownerEmail: z.string().email().transform((s) => s.trim().toLowerCase()),
  ownerPassword: z.string().min(8),
});

router.post("/companies", async (req: any, res) => {
  const parsed = createCompanySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "ValidationError", message: parsed.error.message });

  const { name, email, phone, address, city, state, zip, plan, ownerFirstName, ownerLastName, ownerEmail, ownerPassword } = parsed.data;

  const existingEmail = await db.select().from(usersTable).where(eq(usersTable.email, ownerEmail)).limit(1);
  if (existingEmail.length > 0) return res.status(409).json({ error: "ConflictError", message: "Owner email already in use" });

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") + "-" + Date.now().toString(36);

  const [company] = await db.insert(companiesTable).values({
    name, slug, email, phone: phone ?? null, address: address ?? null, city: city ?? null, state: state ?? null, zip: zip ?? null,
    subscriptionPlan: plan, subscriptionStatus: "active", isActive: true,
  }).returning();

  const passwordHash = await hashPassword(ownerPassword);
  const [owner] = await db.insert(usersTable).values({
    companyId: company.id, firstName: ownerFirstName, lastName: ownerLastName, email: ownerEmail,
    passwordHash, role: "owner", isActive: true,
  }).returning();

  await logActivity({ adminId: req.admin.adminId, action: "admin.company_created", entityType: "company", entityId: company.id });
  return res.status(201).json({ company, owner: { id: owner.id, email: owner.email, firstName: owner.firstName, lastName: owner.lastName } });
});

// Add user to company
const addCompanyUserSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().transform((s) => s.trim().toLowerCase()),
  password: z.string().min(8),
  role: z.enum(["admin", "staff"]).default("staff"),
});

router.post("/companies/:id/users", async (req: any, res) => {
  const companyId = Number(req.params.id);
  const parsed = addCompanyUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "ValidationError", message: parsed.error.message });

  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
  if (!company) return res.status(404).json({ error: "NotFound" });

  const existing = await db.select().from(usersTable).where(eq(usersTable.email, parsed.data.email)).limit(1);
  if (existing.length > 0) return res.status(409).json({ error: "ConflictError", message: "Email already in use" });

  const passwordHash = await hashPassword(parsed.data.password);
  const [user] = await db.insert(usersTable).values({
    companyId, firstName: parsed.data.firstName, lastName: parsed.data.lastName, email: parsed.data.email,
    passwordHash, role: parsed.data.role, isActive: true,
  }).returning();

  await logActivity({ adminId: req.admin.adminId, action: "admin.user_created", entityType: "user", entityId: user.id, metadata: { companyId } });
  return res.status(201).json({ id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, isActive: user.isActive, createdAt: user.createdAt });
});

// Toggle user active status
router.put("/companies/:id/users/:userId/toggle", async (req: any, res) => {
  const companyId = Number(req.params.id);
  const userId = Number(req.params.userId);
  const [user] = await db.select().from(usersTable).where(and(eq(usersTable.id, userId), eq(usersTable.companyId, companyId))).limit(1);
  if (!user) return res.status(404).json({ error: "NotFound" });
  if (user.role === "owner") return res.status(400).json({ error: "Cannot deactivate the company owner" });
  const [updated] = await db.update(usersTable).set({ isActive: !user.isActive, updatedAt: new Date() }).where(eq(usersTable.id, userId)).returning();
  await logActivity({ adminId: req.admin.adminId, action: `admin.user_${updated.isActive ? "activated" : "deactivated"}`, entityType: "user", entityId: userId });
  return res.json({ success: true, isActive: updated.isActive });
});

// Delete user from company
router.delete("/companies/:id/users/:userId", async (req: any, res) => {
  const companyId = Number(req.params.id);
  const userId = Number(req.params.userId);
  const [user] = await db.select().from(usersTable).where(and(eq(usersTable.id, userId), eq(usersTable.companyId, companyId))).limit(1);
  if (!user) return res.status(404).json({ error: "NotFound" });
  if (user.role === "owner") return res.status(400).json({ error: "Cannot delete the company owner" });
  await db.delete(usersTable).where(and(eq(usersTable.id, userId), eq(usersTable.companyId, companyId)));
  await logActivity({ adminId: req.admin.adminId, action: "admin.user_deleted", entityType: "user", entityId: userId });
  return res.json({ success: true });
});

// Reset owner password
router.post("/companies/:id/owner/reset-password", async (req: any, res) => {
  const companyId = Number(req.params.id);
  const password = req.body?.password;
  if (!password || password.length < 8) return res.status(400).json({ error: "PasswordTooShort", message: "Password must be at least 8 characters" });
  const [owner] = await db.select().from(usersTable).where(and(eq(usersTable.companyId, companyId), eq(usersTable.role, "owner"))).limit(1);
  if (!owner) return res.status(404).json({ error: "NotFound", message: "Owner not found" });
  const passwordHash = await hashPassword(password);
  await db.update(usersTable).set({ passwordHash, updatedAt: new Date() }).where(eq(usersTable.id, owner.id));
  await logActivity({ adminId: req.admin.adminId, action: "admin.owner_password_reset", entityType: "user", entityId: owner.id, metadata: { companyId } });
  return res.json({ success: true });
});

// ─── Activity Logs ────────────────────────────────────────────────────────────
router.get("/activity", async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 50;
  const offset = (page - 1) * limit;
  const search = req.query.search as string;
  const entityType = req.query.entityType as string;
  const companyId = req.query.companyId ? Number(req.query.companyId) : undefined;

  const conditions: any[] = [];
  if (search) conditions.push(ilike(activityLogsTable.action, `%${search}%`));
  if (entityType) conditions.push(eq(activityLogsTable.entityType, entityType));
  if (companyId) conditions.push(eq(activityLogsTable.companyId, companyId));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [logs, total] = await Promise.all([
    db.select().from(activityLogsTable).where(whereClause).orderBy(desc(activityLogsTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(activityLogsTable).where(whereClause),
  ]);

  const userIds = [...new Set(logs.map(l => l.userId).filter(Boolean))] as number[];
  const companyIds = [...new Set(logs.map(l => l.companyId).filter(Boolean))] as number[];

  const [users, companies] = await Promise.all([
    userIds.length > 0 ? db.select().from(usersTable).where(inArray(usersTable.id, userIds)) : Promise.resolve([]),
    companyIds.length > 0 ? db.select({ id: companiesTable.id, name: companiesTable.name }).from(companiesTable).where(inArray(companiesTable.id, companyIds)) : Promise.resolve([]),
  ]);

  const userMap = Object.fromEntries(users.map(u => [u.id, `${u.firstName} ${u.lastName}`]));
  const companyMap = Object.fromEntries(companies.map(c => [c.id, c.name]));

  return res.json({
    logs: logs.map(l => ({
      ...l,
      userName: l.userId ? userMap[l.userId] ?? null : null,
      companyName: l.companyId ? companyMap[l.companyId] ?? null : null,
    })),
    total: Number(total[0].count),
    page,
    limit,
  });
});

// ─── Admin Users ──────────────────────────────────────────────────────────────
router.get("/admins", async (_req, res) => {
  const admins = await db.select({
    id: platformAdminsTable.id, email: platformAdminsTable.email, firstName: platformAdminsTable.firstName,
    lastName: platformAdminsTable.lastName, role: platformAdminsTable.role, isActive: platformAdminsTable.isActive,
    lastLoginAt: platformAdminsTable.lastLoginAt, createdAt: platformAdminsTable.createdAt,
  }).from(platformAdminsTable).orderBy(desc(platformAdminsTable.createdAt));
  return res.json({ admins });
});

const createAdminSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.string().optional(),
});

router.post("/admins", async (req: any, res) => {
  const parsed = createAdminSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "ValidationError", message: parsed.error.message });

  const existing = await db.select().from(platformAdminsTable).where(eq(platformAdminsTable.email, parsed.data.email)).limit(1);
  if (existing.length > 0) return res.status(409).json({ error: "ConflictError", message: "Email already in use" });

  const passwordHash = await hashPassword(parsed.data.password);
  const [admin] = await db.insert(platformAdminsTable).values({
    firstName: parsed.data.firstName, lastName: parsed.data.lastName, email: parsed.data.email,
    passwordHash, role: parsed.data.role ?? "admin", isActive: true,
  }).returning();

  await logActivity({ adminId: req.admin.adminId, action: "admin.admin_created", entityType: "admin", entityId: admin.id });
  return res.status(201).json({ id: admin.id, email: admin.email, firstName: admin.firstName, lastName: admin.lastName, role: admin.role, isActive: admin.isActive, createdAt: admin.createdAt });
});

const updateAdminSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  role: z.enum(["admin", "superadmin"]).optional(),
  isActive: z.boolean().optional(),
  // Optional free-text note the acting admin can include when deactivating
  // another admin. Surfaced in the deactivation email and stored on the
  // activity log for auditing. Ignored for any non-deactivation update.
  note: z.string().trim().max(500).optional(),
});

router.put("/admins/:id", async (req: any, res) => {
  const id = Number(req.params.id);
  const parsed = updateAdminSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "ValidationError", message: parsed.error.message });
  // Guard against an admin locking themselves out by deactivating their own account.
  if (id === req.admin.adminId && parsed.data.isActive === false) {
    return res.status(400).json({ error: "CannotDeactivateSelf", message: "You cannot deactivate your own account" });
  }
  const { password, note, ...rest } = parsed.data;
  const fields: Record<string, any> = { ...rest, updatedAt: new Date() };
  if (password) fields.passwordHash = await hashPassword(password);
  if (Object.keys(fields).length === 1) return res.status(400).json({ error: "NoFields", message: "No fields to update" });
  const [updated] = await db.update(platformAdminsTable).set(fields).where(eq(platformAdminsTable.id, id)).returning();
  const action = "isActive" in rest
    ? (rest.isActive ? "admin.admin_reactivated" : "admin.admin_deactivated")
    : "admin.admin_updated";
  // The optional note only applies to a manual deactivation; record it on the
  // audit entry so reviewers can see why access was disabled.
  const deactivatingWithNote = rest.isActive === false && !!note;
  await logActivity({
    adminId: req.admin.adminId,
    action,
    entityType: "admin",
    entityId: id,
    metadata: deactivatingWithNote ? { note } : undefined,
  });

  // Give the affected admin a heads-up that their access changed. Best-effort:
  // sendEmail swallows its own errors, so this never blocks the response.
  if ("isActive" in rest && updated?.email) {
    if (rest.isActive === false) {
      await sendAdminDeactivationEmail({
        to: updated.email,
        firstName: updated.firstName,
        reason: "manual",
        note: note || undefined,
        supportEmail: resolveAdminSupportEmail(),
      });
    } else if (rest.isActive === true) {
      await sendAdminReactivationEmail({
        to: updated.email,
        firstName: updated.firstName,
        loginUrl: `${resolveBaseUrl()}/admin/login`,
        supportEmail: resolveAdminSupportEmail(),
      });
    }
  }

  return res.json({ id: updated.id, email: updated.email, firstName: updated.firstName, lastName: updated.lastName, role: updated.role, isActive: updated.isActive });
});

// ─── Platform settings ────────────────────────────────────────────────────────
// Read the platform-wide settings (currently the dormant-admin lockout policy).
router.get("/settings", async (_req: any, res) => {
  const settings = await getPlatformSettings();
  return res.json({
    staleAdminDays: settings.staleAdminDays,
    staleAdminSweepEnabled: settings.staleAdminSweepEnabled,
    bounds: { minStaleAdminDays: MIN_STALE_ADMIN_DAYS, maxStaleAdminDays: MAX_STALE_ADMIN_DAYS },
  });
});

const updatePlatformSettingsSchema = z.object({
  staleAdminDays: z.coerce.number().int().min(MIN_STALE_ADMIN_DAYS).max(MAX_STALE_ADMIN_DAYS).optional(),
  staleAdminSweepEnabled: z.boolean().optional(),
});

// Update the platform settings. Records an activity-log entry so the change is
// auditable alongside other admin actions.
router.put("/settings", async (req: any, res) => {
  const parsed = updatePlatformSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "ValidationError", message: "Invalid settings", details: parsed.error.flatten() });
  }
  const before = await getPlatformSettings();
  const updated = await updatePlatformSettings(parsed.data);

  const changed =
    before.staleAdminDays !== updated.staleAdminDays ||
    before.staleAdminSweepEnabled !== updated.staleAdminSweepEnabled;
  if (changed) {
    await logActivity({
      adminId: req.admin.adminId,
      action: "admin.platform_settings_updated",
      entityType: "settings",
      metadata: {
        staleAdminDays: { from: before.staleAdminDays, to: updated.staleAdminDays },
        staleAdminSweepEnabled: { from: before.staleAdminSweepEnabled, to: updated.staleAdminSweepEnabled },
      },
    });
  }

  return res.json({
    staleAdminDays: updated.staleAdminDays,
    staleAdminSweepEnabled: updated.staleAdminSweepEnabled,
    bounds: { minStaleAdminDays: MIN_STALE_ADMIN_DAYS, maxStaleAdminDays: MAX_STALE_ADMIN_DAYS },
  });
});

// Bulk-deactivate every admin that has gone dormant (no sign-in for the
// configured inactivity threshold, or never signed in). The acting admin is
// always excluded so they can't lock themselves out. Shares its dormancy logic
// with the recurring background sweep.
router.post("/admins/deactivate-stale", async (req: any, res) => {
  const { deactivatedCount, deactivatedIds, thresholdDays } = await deactivateStaleAdmins({
    excludeAdminId: req.admin.adminId,
    actorAdminId: req.admin.adminId,
    trigger: "manual",
  });
  return res.json({ success: true, deactivatedCount, deactivatedIds, thresholdDays });
});

router.delete("/admins/:id", async (req: any, res) => {
  const id = Number(req.params.id);
  if (id === req.admin.adminId) return res.status(400).json({ error: "Cannot delete yourself" });
  await db.delete(platformAdminsTable).where(eq(platformAdminsTable.id, id));
  await logActivity({ adminId: req.admin.adminId, action: "admin.admin_deleted", entityType: "admin", entityId: id });
  return res.json({ success: true });
});

// ─── Seed ─────────────────────────────────────────────────────────────────────
router.post("/seed", async (req: any, res) => {
  try {
    const existingDemo = await db.select().from(companiesTable).where(eq(companiesTable.slug, "greenscapes-demo")).limit(1);
    if (existingDemo.length > 0) return res.json({ success: true, message: "Demo data already seeded" });

    const [company] = await db.insert(companiesTable).values({
      name: "GreenScapes Pro", slug: "greenscapes-demo", phone: "555-123-4567", email: "demo@greenscapes.com",
      address: "123 Lawn Lane", city: "Austin", state: "TX", zip: "78701",
      subscriptionPlan: "growth", subscriptionStatus: "active", isActive: true,
    }).returning();

    const passwordHash = await hashPassword("Demo1234!");
    const [owner] = await db.insert(usersTable).values({
      companyId: company.id, firstName: "Alex", lastName: "Green", email: "alex@greenscapes.com",
      passwordHash, role: "owner", isActive: true,
    }).returning();

    logger.info({ companyId: company.id, userId: owner.id }, "Demo data seeded");
    return res.json({ success: true, message: "Demo data seeded", credentials: { email: "alex@greenscapes.com", password: "Demo1234!" } });
  } catch (err) {
    logger.error({ err }, "Error seeding demo data");
    return res.status(500).json({ error: "SeedError", message: "Failed to seed demo data" });
  }
});

export default router;
