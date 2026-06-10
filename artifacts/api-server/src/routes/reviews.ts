import { Router } from "express";
import { db, reviewsTable, customersTable } from "@workspace/db";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { requireActiveSubscription } from "../lib/subscription";
import { logActivity } from "../lib/activity";
import { z } from "zod";

const router = Router();
router.use(requireAuth);
router.use(requireActiveSubscription);
// Review moderation is a manager capability — staff have no access.
router.use(requireRole("owner", "admin"));

// GET /reviews — list a company's reviews, optionally filtered by status.
router.get("/", async (req: any, res) => {
  const { companyId } = req.user;
  const conditions: any[] = [eq(reviewsTable.companyId, companyId)];
  if (req.query.status) conditions.push(eq(reviewsTable.status, req.query.status as string));

  const reviews = await db.select().from(reviewsTable).where(and(...conditions)).orderBy(desc(reviewsTable.createdAt));

  const customerIds = [...new Set(reviews.map(r => r.customerId).filter(Boolean))] as number[];
  const customers = customerIds.length > 0 ? await db.select().from(customersTable).where(inArray(customersTable.id, customerIds)) : [];
  const customerMap = Object.fromEntries(customers.map(c => [c.id, `${c.firstName} ${c.lastName}`]));

  const counts = await db
    .select({ status: reviewsTable.status, count: sql<number>`count(*)` })
    .from(reviewsTable)
    .where(eq(reviewsTable.companyId, companyId))
    .groupBy(reviewsTable.status);

  return res.json({
    reviews: reviews.map(r => ({ ...r, customerName: r.customerId ? customerMap[r.customerId] ?? null : null })),
    counts: Object.fromEntries(counts.map(c => [c.status, Number(c.count)])),
  });
});

const statusSchema = z.object({ status: z.enum(["pending", "approved", "hidden"]) });

// PUT /reviews/:id — approve or hide a review.
router.put("/:id", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "ValidationError", message: "status must be pending, approved or hidden" });
  }
  const [existing] = await db.select().from(reviewsTable).where(and(eq(reviewsTable.id, id), eq(reviewsTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });

  const [updated] = await db.update(reviewsTable).set({ status: parsed.data.status, updatedAt: new Date() }).where(and(eq(reviewsTable.id, id), eq(reviewsTable.companyId, companyId))).returning();
  await logActivity({ companyId, userId, action: `review.${parsed.data.status}`, entityType: "review", entityId: id });
  return res.json(updated);
});

// DELETE /reviews/:id — remove a review permanently.
router.delete("/:id", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(reviewsTable).where(and(eq(reviewsTable.id, id), eq(reviewsTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });
  await db.delete(reviewsTable).where(and(eq(reviewsTable.id, id), eq(reviewsTable.companyId, companyId)));
  await logActivity({ companyId, userId, action: "review.deleted", entityType: "review", entityId: id });
  return res.json({ success: true });
});

export default router;
