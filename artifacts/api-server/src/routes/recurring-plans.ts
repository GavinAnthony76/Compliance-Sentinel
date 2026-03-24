import { Router } from "express";
import { db, recurringPlansTable, customersTable, servicesTable } from "@workspace/db";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { requireFeature } from "../lib/features";
import { logActivity } from "../lib/activity";

const router = Router();
router.use(requireAuth);
router.use(requireFeature("recurring_plans"));

router.get("/", async (req: any, res) => {
  const { companyId } = req.user;
  const plans = await db.select().from(recurringPlansTable).where(eq(recurringPlansTable.companyId, companyId)).orderBy(desc(recurringPlansTable.createdAt));

  const customerIds = [...new Set(plans.map(p => p.customerId))];
  const serviceIds = [...new Set(plans.map(p => p.serviceId).filter(Boolean))] as number[];

  const [customers, services] = await Promise.all([
    customerIds.length > 0 ? db.select().from(customersTable).where(inArray(customersTable.id, customerIds)) : [],
    serviceIds.length > 0 ? db.select().from(servicesTable).where(inArray(servicesTable.id, serviceIds)) : [],
  ]);

  const customerMap = Object.fromEntries(customers.map(c => [c.id, `${c.firstName} ${c.lastName}`]));
  const serviceMap = Object.fromEntries(services.map(s => [s.id, s.name]));

  return res.json({
    plans: plans.map(p => ({
      ...p,
      price: p.price ? Number(p.price) : null,
      customerName: customerMap[p.customerId] ?? null,
      serviceName: p.serviceId ? serviceMap[p.serviceId] ?? null : null,
    })),
  });
});

router.post("/", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const [plan] = await db.insert(recurringPlansTable).values({
    companyId,
    customerId: req.body.customerId,
    propertyId: req.body.propertyId ?? null,
    serviceId: req.body.serviceId ?? null,
    frequencyType: req.body.frequencyType,
    intervalValue: req.body.intervalValue ?? null,
    dayOfWeek: req.body.dayOfWeek ?? null,
    dayOfMonth: req.body.dayOfMonth ?? null,
    nextRunAt: req.body.nextRunAt ? new Date(req.body.nextRunAt) : null,
    isActive: req.body.isActive ?? true,
    price: req.body.price != null ? String(req.body.price) : null,
  }).returning();
  await logActivity({ companyId, userId, action: "recurring_plan.created", entityType: "recurring_plan", entityId: plan.id });
  return res.status(201).json({ ...plan, price: plan.price ? Number(plan.price) : null });
});

router.put("/:id", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(recurringPlansTable).where(and(eq(recurringPlansTable.id, id), eq(recurringPlansTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });
  const updates: any = { updatedAt: new Date() };
  if (req.body.customerId !== undefined) updates.customerId = req.body.customerId;
  if (req.body.frequencyType) updates.frequencyType = req.body.frequencyType;
  if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;
  if (req.body.price != null) updates.price = String(req.body.price);
  if (req.body.nextRunAt) updates.nextRunAt = new Date(req.body.nextRunAt);
  if (req.body.serviceId !== undefined) updates.serviceId = req.body.serviceId;
  if (req.body.propertyId !== undefined) updates.propertyId = req.body.propertyId;
  const [updated] = await db.update(recurringPlansTable).set(updates).where(and(eq(recurringPlansTable.id, id), eq(recurringPlansTable.companyId, companyId))).returning();
  await logActivity({ companyId, userId, action: "recurring_plan.updated", entityType: "recurring_plan", entityId: id });
  return res.json({ ...updated, price: updated.price ? Number(updated.price) : null });
});

router.delete("/:id", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(recurringPlansTable).where(and(eq(recurringPlansTable.id, id), eq(recurringPlansTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });
  await db.delete(recurringPlansTable).where(and(eq(recurringPlansTable.id, id), eq(recurringPlansTable.companyId, companyId)));
  await logActivity({ companyId, userId, action: "recurring_plan.deleted", entityType: "recurring_plan", entityId: id });
  return res.json({ success: true });
});

export default router;
