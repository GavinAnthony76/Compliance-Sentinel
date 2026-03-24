import { Router } from "express";
import { z } from "zod";
import { db, servicesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { logActivity } from "../lib/activity";

const serviceBodySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional().nullable(),
  durationMinutes: z.number().int().positive().optional().nullable(),
  basePrice: z.number().nonnegative().optional().nullable(),
  isActive: z.boolean().optional(),
  category: z.string().max(100).optional().nullable(),
});

const router = Router();
router.use(requireAuth);

router.get("/", async (req: any, res) => {
  const { companyId } = req.user;
  const services = await db.select().from(servicesTable).where(eq(servicesTable.companyId, companyId)).orderBy(desc(servicesTable.createdAt));
  return res.json({ services });
});

router.post("/", async (req: any, res) => {
  const parsed = serviceBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "ValidationError", message: parsed.error.message });
  }
  const { companyId, userId } = req.user;
  const [service] = await db.insert(servicesTable).values({
    companyId,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    durationMinutes: parsed.data.durationMinutes ?? null,
    basePrice: parsed.data.basePrice != null ? String(parsed.data.basePrice) : null,
    isActive: parsed.data.isActive ?? true,
    category: parsed.data.category ?? null,
  }).returning();
  await logActivity({ companyId, userId, action: "service.created", entityType: "service", entityId: service.id });
  return res.status(201).json({ ...service, basePrice: service.basePrice ? Number(service.basePrice) : null });
});

router.put("/:id", async (req: any, res) => {
  const parsed = serviceBodySchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "ValidationError", message: parsed.error.message });
  }
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(servicesTable).where(and(eq(servicesTable.id, id), eq(servicesTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });
  const [updated] = await db.update(servicesTable).set({
    ...parsed.data,
    basePrice: parsed.data.basePrice != null ? String(parsed.data.basePrice) : existing.basePrice,
    updatedAt: new Date(),
  }).where(and(eq(servicesTable.id, id), eq(servicesTable.companyId, companyId))).returning();
  await logActivity({ companyId, userId, action: "service.updated", entityType: "service", entityId: id });
  return res.json({ ...updated, basePrice: updated.basePrice ? Number(updated.basePrice) : null });
});

router.delete("/:id", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(servicesTable).where(and(eq(servicesTable.id, id), eq(servicesTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });
  await db.delete(servicesTable).where(and(eq(servicesTable.id, id), eq(servicesTable.companyId, companyId)));
  await logActivity({ companyId, userId, action: "service.deleted", entityType: "service", entityId: id });
  return res.json({ success: true });
});

export default router;
