import { Router } from "express";
import { db, companiesTable, usersTable, platformAdminsTable, appointmentsTable, invoicesTable, activityLogsTable } from "@workspace/db";
import { eq, sql, desc, ilike, and } from "drizzle-orm";
import { requireAdminAuth, hashPassword } from "../lib/auth";
import { logActivity } from "../lib/activity";
import { logger } from "../lib/logger";
import { z } from "zod";

const router = Router();
router.use(requireAdminAuth);

router.get("/dashboard", async (_req, res) => {
  const [
    totalCompanies,
    activeSubscriptions,
    trialingAccounts,
    canceledAccounts,
    totalAppointments,
    totalInvoices,
    recentSignups,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(companiesTable),
    db.select({ count: sql<number>`count(*)` }).from(companiesTable).where(eq(companiesTable.subscriptionStatus, "active")),
    db.select({ count: sql<number>`count(*)` }).from(companiesTable).where(eq(companiesTable.subscriptionStatus, "trialing")),
    db.select({ count: sql<number>`count(*)` }).from(companiesTable).where(eq(companiesTable.subscriptionStatus, "canceled")),
    db.select({ count: sql<number>`count(*)` }).from(appointmentsTable),
    db.select({ count: sql<number>`count(*)` }).from(invoicesTable),
    db.select().from(companiesTable).orderBy(desc(companiesTable.createdAt)).limit(5),
  ]);

  return res.json({
    totalCompanies: Number(totalCompanies[0].count),
    activeSubscriptions: Number(activeSubscriptions[0].count),
    trialingAccounts: Number(trialingAccounts[0].count),
    canceledAccounts: Number(canceledAccounts[0].count),
    totalAppointments: Number(totalAppointments[0].count),
    totalInvoices: Number(totalInvoices[0].count),
    recentSignups,
    mrr: Number(activeSubscriptions[0].count) * 99,
  });
});

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
      db.select({ count: sql<number>`count(*)` }).from(usersTable).where(eq(usersTable.companyId, c.id)),
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

  const [custCount, apptCount, owner] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(usersTable).where(eq(usersTable.companyId, id)),
    db.select({ count: sql<number>`count(*)` }).from(appointmentsTable).where(eq(appointmentsTable.companyId, id)),
    db.select().from(usersTable).where(and(eq(usersTable.companyId, id), eq(usersTable.role, "owner"))).limit(1),
  ]);

  return res.json({
    company: {
      ...company,
      ownerName: owner[0] ? `${owner[0].firstName} ${owner[0].lastName}` : null,
      ownerEmail: owner[0]?.email ?? null,
      customersCount: Number(custCount[0].count),
      appointmentsCount: Number(apptCount[0].count),
    },
    users,
    recentActivity,
  });
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
  await db.update(companiesTable).set({ subscriptionPlan: plan, updatedAt: new Date() }).where(eq(companiesTable.id, id));
  await logActivity({ adminId: req.admin.adminId, action: "admin.company_plan_changed", entityType: "company", entityId: id, metadata: { plan } });
  return res.json({ success: true });
});

router.put("/companies/:id/notes", async (req: any, res) => {
  const id = Number(req.params.id);
  const notes = req.body?.notes ?? null;
  await db.update(companiesTable).set({ internalNotes: notes, updatedAt: new Date() }).where(eq(companiesTable.id, id));
  return res.json({ success: true });
});

router.get("/activity", async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 50;
  const offset = (page - 1) * limit;

  const [logs, total] = await Promise.all([
    db.select().from(activityLogsTable).orderBy(desc(activityLogsTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(activityLogsTable),
  ]);

  const userIds = [...new Set(logs.map(l => l.userId).filter(Boolean))] as number[];
  const users = userIds.length > 0 ? await db.select().from(usersTable).where(sql`${usersTable.id} = ANY(${userIds})`) : [];
  const userMap = Object.fromEntries(users.map(u => [u.id, `${u.firstName} ${u.lastName}`]));

  return res.json({ logs: logs.map(l => ({ ...l, userName: l.userId ? userMap[l.userId] ?? null : null })), total: Number(total[0].count), page, limit });
});

router.get("/admins", async (_req, res) => {
  const admins = await db.select({ id: platformAdminsTable.id, email: platformAdminsTable.email, firstName: platformAdminsTable.firstName, lastName: platformAdminsTable.lastName, role: platformAdminsTable.role, isActive: platformAdminsTable.isActive, createdAt: platformAdminsTable.createdAt }).from(platformAdminsTable).orderBy(desc(platformAdminsTable.createdAt));
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
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
    email: parsed.data.email,
    passwordHash,
    role: parsed.data.role ?? "admin",
    isActive: true,
  }).returning();

  await logActivity({ adminId: req.admin.adminId, action: "admin.admin_created", entityType: "admin", entityId: admin.id });
  return res.status(201).json({ id: admin.id, email: admin.email, firstName: admin.firstName, lastName: admin.lastName, role: admin.role, isActive: admin.isActive, createdAt: admin.createdAt });
});

router.delete("/admins/:id", async (req: any, res) => {
  const id = Number(req.params.id);
  if (id === req.admin.adminId) return res.status(400).json({ error: "Cannot delete yourself" });
  await db.delete(platformAdminsTable).where(eq(platformAdminsTable.id, id));
  return res.json({ success: true });
});

router.post("/seed", async (req: any, res) => {
  try {
    const existingDemo = await db.select().from(companiesTable).where(eq(companiesTable.slug, "greenscapes-demo")).limit(1);
    if (existingDemo.length > 0) {
      return res.json({ success: true, message: "Demo data already seeded" });
    }

    const [company] = await db.insert(companiesTable).values({
      name: "GreenScapes Pro",
      slug: "greenscapes-demo",
      phone: "555-123-4567",
      email: "demo@greenscapes.com",
      address: "123 Lawn Lane",
      city: "Austin",
      state: "TX",
      zip: "78701",
      subscriptionPlan: "growth",
      subscriptionStatus: "active",
      isActive: true,
    }).returning();

    const passwordHash = await hashPassword("Demo1234!");
    const [owner] = await db.insert(usersTable).values({
      companyId: company.id,
      firstName: "Alex",
      lastName: "Green",
      email: "alex@greenscapes.com",
      passwordHash,
      role: "owner",
      isActive: true,
    }).returning();

    logger.info({ companyId: company.id, userId: owner.id }, "Demo data seeded");
    return res.json({ success: true, message: "Demo data seeded", credentials: { email: "alex@greenscapes.com", password: "Demo1234!" } });
  } catch (err) {
    logger.error({ err }, "Error seeding demo data");
    return res.status(500).json({ error: "SeedError", message: "Failed to seed demo data" });
  }
});

export default router;
