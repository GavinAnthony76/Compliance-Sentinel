import { Router } from "express";
import { db, estimatesTable, customersTable } from "@workspace/db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { requireFeature } from "../lib/features";
import { logActivity } from "../lib/activity";
import crypto from "crypto";

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
  const customers = customerIds.length > 0 ? await db.select().from(customersTable).where(inArray(customersTable.id, customerIds)) : [];
  const customerMap = Object.fromEntries(customers.map(c => [c.id, `${c.firstName} ${c.lastName}`]));

  return res.json({ estimates: estimates.map(e => ({ ...e, total: Number(e.total), customerName: customerMap[e.customerId] ?? null })), total: Number(total[0].count), page, limit });
});

router.post("/", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const estimateNumber = await nextEstimateNumber(companyId);
  const publicToken = crypto.randomBytes(32).toString("hex");
  const [est] = await db.insert(estimatesTable).values({
    companyId,
    customerId: req.body.customerId,
    propertyId: req.body.propertyId ?? null,
    estimateNumber,
    status: req.body.status ?? "draft",
    total: String(req.body.total ?? 0),
    notes: req.body.notes ?? null,
    publicToken,
  }).returning();
  await logActivity({ companyId, userId, action: "estimate.created", entityType: "estimate", entityId: est.id });
  return res.status(201).json({ ...est, total: Number(est.total) });
});

// POST /estimates/:id/send-for-signature — send estimate link to customer for e-signing
router.post("/:id/send-for-signature", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const [est] = await db.select().from(estimatesTable).where(and(eq(estimatesTable.id, id), eq(estimatesTable.companyId, companyId))).limit(1);
  if (!est) return res.status(404).json({ error: "NotFound" });

  // Ensure publicToken exists
  let token = est.publicToken;
  if (!token) {
    token = crypto.randomBytes(32).toString("hex");
    await db.update(estimatesTable).set({ publicToken: token, updatedAt: new Date() }).where(eq(estimatesTable.id, id));
  }

  // Update status to "sent"
  await db.update(estimatesTable).set({ status: "sent", updatedAt: new Date() }).where(eq(estimatesTable.id, id));

  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, est.customerId)).limit(1);
  const { sendEmail, sendSMS } = await import("../lib/notifications");
  const { companiesTable } = await import("@workspace/db");
  const { eq: deq } = await import("drizzle-orm");
  const [company] = await db.select().from(companiesTable).where(deq(companiesTable.id, companyId)).limit(1);

  const baseUrl = process.env.APP_BASE_URL || `https://${process.env.REPLIT_DOMAINS?.split(",")[0]}` || "http://localhost:3000";
  const signUrl = `${baseUrl}/estimates/${token}/sign`;

  if (customer?.email) {
    await sendEmail({
      to: customer.email,
      subject: `Estimate ${est.estimateNumber} from ${company?.name || "Your Service Provider"} — Ready to Sign`,
      body: `Hi ${customer.firstName},\n\nYour estimate ${est.estimateNumber} for $${Number(est.total).toFixed(2)} is ready for your review and signature.\n\nView and sign: ${signUrl}\n\nThank you!`,
    });
  }
  if (customer?.phone) {
    await sendSMS({ to: customer.phone, body: `${company?.name || "Your service provider"} sent estimate ${est.estimateNumber} for $${Number(est.total).toFixed(2)}. Review & sign: ${signUrl}` });
  }

  await logActivity({ companyId, userId, action: "estimate.sent_for_signature", entityType: "estimate", entityId: id });
  return res.json({ success: true, signUrl });
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
