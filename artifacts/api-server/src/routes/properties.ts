import { Router } from "express";
import { db, propertiesTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { requireActiveSubscription } from "../lib/subscription";
import { logActivity } from "../lib/activity";
import { z } from "zod";

const createPropertySchema = z.object({
  customerId: z.number().int(),
  propertyName: z.string().max(200).optional().nullable(),
  addressLine1: z.string().min(1).max(500),
  addressLine2: z.string().max(200).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(100).optional().nullable(),
  zip: z.string().max(20).optional().nullable(),
  gateNotes: z.string().max(1000).optional().nullable(),
  yardSize: z.string().max(50).optional().nullable(),
  propertyNotes: z.string().max(2000).optional().nullable(),
});

const updatePropertySchema = createPropertySchema.partial().omit({ customerId: true });

const router = Router();
router.use(requireAuth);
router.use(requireActiveSubscription);

router.get("/", async (req: any, res) => {
  const { companyId } = req.user;
  const customerId = req.query.customerId ? Number(req.query.customerId) : undefined;
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const offset = (page - 1) * limit;

  const conditions = [eq(propertiesTable.companyId, companyId)];
  if (customerId) conditions.push(eq(propertiesTable.customerId, customerId));

  const [properties, totalResult] = await Promise.all([
    db.select().from(propertiesTable).where(and(...conditions)).orderBy(desc(propertiesTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(propertiesTable).where(and(...conditions)),
  ]);

  return res.json({ properties, total: Number(totalResult[0].count), page, limit });
});

router.post("/", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const parsed = createPropertySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "ValidationError", message: parsed.error.message });
  const [property] = await db.insert(propertiesTable).values({ companyId, ...parsed.data }).returning();
  await logActivity({ companyId, userId, action: "property.created", entityType: "property", entityId: property.id });
  return res.status(201).json(property);
});

router.get("/:id", async (req: any, res) => {
  const { companyId } = req.user;
  const id = Number(req.params.id);
  const [property] = await db.select().from(propertiesTable).where(and(eq(propertiesTable.id, id), eq(propertiesTable.companyId, companyId))).limit(1);
  if (!property) return res.status(404).json({ error: "NotFound" });
  return res.json(property);
});

router.put("/:id", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(propertiesTable).where(and(eq(propertiesTable.id, id), eq(propertiesTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });
  const bodyParsed = updatePropertySchema.safeParse(req.body);
  if (!bodyParsed.success) return res.status(400).json({ error: "ValidationError", message: bodyParsed.error.message });
  const [updated] = await db.update(propertiesTable).set({ ...bodyParsed.data, updatedAt: new Date() }).where(and(eq(propertiesTable.id, id), eq(propertiesTable.companyId, companyId))).returning();
  await logActivity({ companyId, userId, action: "property.updated", entityType: "property", entityId: id });
  return res.json(updated);
});

router.delete("/:id", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(propertiesTable).where(and(eq(propertiesTable.id, id), eq(propertiesTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });
  await db.delete(propertiesTable).where(and(eq(propertiesTable.id, id), eq(propertiesTable.companyId, companyId)));
  await logActivity({ companyId, userId, action: "property.deleted", entityType: "property", entityId: id });
  return res.json({ success: true });
});

export default router;
