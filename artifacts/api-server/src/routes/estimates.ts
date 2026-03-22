import { Router } from "express";
import { db, estimatesTable, customersTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { requireFeature } from "../lib/features";
import { logActivity } from "../lib/activity";

const router = Router();
router.use(requireAuth);
router.use(requireFeature("estimates"));

async function nextEstimateNumber(companyId: number): Promise<string> {
  const [result] = await db.select({ count: sql<number>`count(*)` }).from(estimatesTable).where(eq(estimatesTable.companyId, companyId));
  return `EST-${String(Number(result.count) + 1).padStart(4, "0")}`;
}

router.get("/", async (req: any, res) => {
  const { companyId } = req.user;
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const conditions: any[] = [eq(estimatesTable.companyId, companyId)];
  if (req.query.status) conditions.push(eq(estimatesTable.status, req.query.status as string));
  if (req.query.customerId) conditions.push(eq(estimatesTable.customerId, Number(req.query.customerId)));

  const [estimates, total] = await Promise.all([
    db.select().from(estimatesTable).where(and(...conditions)).orderBy(desc(estimatesTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(estimatesTable).where(and(...conditions)),
  ]);

  const customerIds = [...new Set(estimates.map(e => e.customerId))];
  const customers = customerIds.length > 0 ? await db.select().from(customersTable).where(sql`${customersTable.id} = ANY(${customerIds})`) : [];
  const customerMap = Object.fromEntries(customers.map(c => [c.id, `${c.firstName} ${c.lastName}`]));

  return res.json({ estimates: estimates.map(e => ({ ...e, total: Number(e.total), customerName: customerMap[e.customerId] ?? null })), total: Number(total[0].count), page, limit });
});

router.post("/", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const estimateNumber = await nextEstimateNumber(companyId);
  const [est] = await db.insert(estimatesTable).values({
    companyId,
    customerId: req.body.customerId,
    propertyId: req.body.propertyId ?? null,
    estimateNumber,
    status: req.body.status ?? "draft",
    total: String(req.body.total ?? 0),
    notes: req.body.notes ?? null,
  }).returning();
  await logActivity({ companyId, userId, action: "estimate.created", entityType: "estimate", entityId: est.id });
  return res.status(201).json({ ...est, total: Number(est.total) });
});

router.get("/:id", async (req: any, res) => {
  const { companyId } = req.user;
  const id = Number(req.params.id);
  const [est] = await db.select().from(estimatesTable).where(and(eq(estimatesTable.id, id), eq(estimatesTable.companyId, companyId))).limit(1);
  if (!est) return res.status(404).json({ error: "NotFound" });
  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, est.customerId)).limit(1);
  return res.json({ ...est, total: Number(est.total), customerName: customer ? `${customer.firstName} ${customer.lastName}` : null });
});

router.put("/:id", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(estimatesTable).where(and(eq(estimatesTable.id, id), eq(estimatesTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });
  const updates: any = { updatedAt: new Date() };
  if (req.body.status) updates.status = req.body.status;
  if (req.body.total != null) updates.total = String(req.body.total);
  if (req.body.notes !== undefined) updates.notes = req.body.notes;
  const [updated] = await db.update(estimatesTable).set(updates).where(and(eq(estimatesTable.id, id), eq(estimatesTable.companyId, companyId))).returning();
  await logActivity({ companyId, userId, action: "estimate.updated", entityType: "estimate", entityId: id });
  return res.json({ ...updated, total: Number(updated.total) });
});

router.delete("/:id", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(estimatesTable).where(and(eq(estimatesTable.id, id), eq(estimatesTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });
  await db.delete(estimatesTable).where(and(eq(estimatesTable.id, id), eq(estimatesTable.companyId, companyId)));
  await logActivity({ companyId, userId, action: "estimate.deleted", entityType: "estimate", entityId: id });
  return res.json({ success: true });
});

export default router;
