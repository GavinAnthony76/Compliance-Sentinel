import { Router } from "express";
import { db, customersTable, propertiesTable, appointmentsTable, invoicesTable } from "@workspace/db";
import { eq, and, ilike, sql, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { logActivity } from "../lib/activity";

const router = Router();
router.use(requireAuth);

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

router.post("/", async (req: any, res) => {
  const { companyId, userId } = req.user;

  const [customer] = await db.insert(customersTable).values({
    companyId,
    ...req.body,
    tags: req.body.tags ?? [],
  }).returning();

  await logActivity({ companyId, userId, action: "customer.created", entityType: "customer", entityId: customer.id });
  return res.status(201).json(customer);
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
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);

  const [existing] = await db.select().from(customersTable).where(and(eq(customersTable.id, id), eq(customersTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });

  const [updated] = await db.update(customersTable).set({ ...req.body, updatedAt: new Date() }).where(and(eq(customersTable.id, id), eq(customersTable.companyId, companyId))).returning();
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
