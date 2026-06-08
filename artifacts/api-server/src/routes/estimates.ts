import { Router } from "express";
import { db, estimatesTable, estimateLineItemsTable, customersTable } from "@workspace/db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { requireActiveSubscription } from "../lib/subscription";
import { requireFeature, requireWithinPlanLimit, hasFeature } from "../lib/features";
import { logActivity } from "../lib/activity";
import { generateEstimateDraft } from "../lib/ai-estimate";
import { z } from "zod";
import crypto from "crypto";

const router = Router();
router.use(requireAuth);
router.use(requireActiveSubscription);
// Estimates are available on every plan (Starter included), gated only by monthly count limits.

const aiDraftSchema = z.object({
  jobDescription: z.string().min(3).max(2000),
  propertySize: z.string().max(120).optional().nullable(),
  services: z.array(z.string().max(120)).max(20).optional().nullable(),
});

// POST /api/estimates/ai-draft — AI Estimate Builder is a Pro-only feature
router.post("/ai-draft", requireFeature("ai_estimate_builder"), async (req: any, res) => {
  const { companyId, userId } = req.user;
  const parsed = aiDraftSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "ValidationError", message: parsed.error.issues[0]?.message ?? "Invalid input" });
  }

  const { companiesTable } = await import("@workspace/db");
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);

  const draft = await generateEstimateDraft({
    jobDescription: parsed.data.jobDescription,
    propertySize: parsed.data.propertySize,
    services: parsed.data.services,
    companyName: company?.name ?? null,
  });

  const subtotal = draft.lineItems.reduce((s, li) => s + li.quantity * li.unitPrice, 0);
  await logActivity({ companyId, userId, action: "estimate.ai_drafted", entityType: "estimate", metadata: { source: draft.source, lineItems: draft.lineItems.length } });
  return res.json({ ...draft, subtotal: Math.round(subtotal * 100) / 100 });
});

async function nextEstimateNumber(companyId: number): Promise<string> {
  const [result] = await db.select({ count: sql<number>`count(*)` }).from(estimatesTable).where(eq(estimatesTable.companyId, companyId));
  return `EST-${String(Number(result.count) + 1).padStart(4, "0")}`;
}

async function getLineItems(estimateId: number) {
  return db.select().from(estimateLineItemsTable).where(eq(estimateLineItemsTable.estimateId, estimateId)).orderBy(estimateLineItemsTable.sortOrder);
}

async function replaceLineItems(estimateId: number, companyId: number, lineItems: any[]) {
  await db.delete(estimateLineItemsTable).where(eq(estimateLineItemsTable.estimateId, estimateId));
  if (lineItems.length > 0) {
    await db.insert(estimateLineItemsTable).values(
      lineItems.map((li, i) => ({
        estimateId,
        companyId,
        description: li.description,
        quantity: String(li.quantity ?? 1),
        unitPrice: String(li.unitPrice ?? 0),
        total: String(Number(li.quantity ?? 1) * Number(li.unitPrice ?? 0)),
        sortOrder: i,
      }))
    );
  }
}

function fmtEst(est: any, lineItems: any[] = []) {
  return {
    ...est,
    subtotal: Number(est.subtotal),
    tax: Number(est.tax),
    total: Number(est.total),
    lineItems: lineItems.map(li => ({
      ...li,
      quantity: Number(li.quantity),
      unitPrice: Number(li.unitPrice),
      total: Number(li.total),
    })),
  };
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

  return res.json({
    estimates: estimates.map(e => fmtEst({ ...e, customerName: customerMap[e.customerId] ?? null })),
    total: Number(total[0].count),
    page,
    limit,
  });
});

router.post("/", requireWithinPlanLimit("estimates"), async (req: any, res) => {
  const { companyId, userId } = req.user;
  const estimateNumber = await nextEstimateNumber(companyId);
  const publicToken = crypto.randomBytes(32).toString("hex");
  const lineItems: any[] = req.body.lineItems ?? [];
  const subtotal = lineItems.length > 0
    ? lineItems.reduce((s: number, li: any) => s + Number(li.quantity ?? 1) * Number(li.unitPrice ?? 0), 0)
    : Number(req.body.subtotal ?? req.body.total ?? 0);
  const tax = Number(req.body.tax ?? 0);
  const total = subtotal + tax;

  const [est] = await db.insert(estimatesTable).values({
    companyId,
    customerId: req.body.customerId,
    propertyId: req.body.propertyId ?? null,
    estimateNumber,
    status: req.body.status ?? "draft",
    subtotal: String(subtotal),
    tax: String(tax),
    total: String(total),
    validUntil: req.body.validUntil ? new Date(req.body.validUntil) : null,
    notes: req.body.notes ?? null,
    publicToken,
  }).returning();

  if (lineItems.length > 0) {
    await replaceLineItems(est.id, companyId, lineItems);
  }

  const items = await getLineItems(est.id);
  await logActivity({ companyId, userId, action: "estimate.created", entityType: "estimate", entityId: est.id });
  return res.status(201).json(fmtEst(est, items));
});

// POST /estimates/:id/send-for-signature
router.post("/:id/send-for-signature", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const [est] = await db.select().from(estimatesTable).where(and(eq(estimatesTable.id, id), eq(estimatesTable.companyId, companyId))).limit(1);
  if (!est) return res.status(404).json({ error: "NotFound" });

  let token = est.publicToken;
  if (!token) {
    token = crypto.randomBytes(32).toString("hex");
    await db.update(estimatesTable).set({ publicToken: token, updatedAt: new Date() }).where(eq(estimatesTable.id, id));
  }

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
  if (customer?.phone && hasFeature(company?.subscriptionPlan, "sms_notifications")) {
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
  const items = await getLineItems(id);
  return res.json(fmtEst({ ...est, customerName: customer ? `${customer.firstName} ${customer.lastName}` : null }, items));
});

router.put("/:id", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(estimatesTable).where(and(eq(estimatesTable.id, id), eq(estimatesTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });

  const updates: any = { updatedAt: new Date() };
  if (req.body.status) updates.status = req.body.status;
  if (req.body.notes !== undefined) updates.notes = req.body.notes;
  if (req.body.validUntil !== undefined) updates.validUntil = req.body.validUntil ? new Date(req.body.validUntil) : null;

  // Recalculate totals if line items or amounts provided
  const lineItems: any[] | undefined = req.body.lineItems;
  if (lineItems !== undefined) {
    const subtotal = lineItems.reduce((s: number, li: any) => s + Number(li.quantity ?? 1) * Number(li.unitPrice ?? 0), 0);
    const tax = Number(req.body.tax ?? existing.tax ?? 0);
    updates.subtotal = String(subtotal);
    updates.tax = String(tax);
    updates.total = String(subtotal + tax);
    await replaceLineItems(id, companyId, lineItems);
  } else {
    if (req.body.subtotal != null) updates.subtotal = String(req.body.subtotal);
    if (req.body.tax != null) updates.tax = String(req.body.tax);
    if (req.body.total != null) updates.total = String(req.body.total);
  }

  const [updated] = await db.update(estimatesTable).set(updates).where(and(eq(estimatesTable.id, id), eq(estimatesTable.companyId, companyId))).returning();
  await logActivity({ companyId, userId, action: "estimate.updated", entityType: "estimate", entityId: id });
  const items = await getLineItems(id);
  return res.json(fmtEst(updated, items));
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
