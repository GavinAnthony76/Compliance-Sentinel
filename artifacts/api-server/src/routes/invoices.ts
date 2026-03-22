import { Router } from "express";
import { db, invoicesTable, customersTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { logActivity } from "../lib/activity";

const router = Router();
router.use(requireAuth);

function fmt(inv: any, customerName?: string) {
  return {
    ...inv,
    subtotal: Number(inv.subtotal),
    tax: Number(inv.tax),
    total: Number(inv.total),
    customerName: customerName ?? null,
  };
}

async function nextInvoiceNumber(companyId: number): Promise<string> {
  const [result] = await db.select({ count: sql<number>`count(*)` }).from(invoicesTable).where(eq(invoicesTable.companyId, companyId));
  const num = Number(result.count) + 1;
  return `INV-${String(num).padStart(4, "0")}`;
}

router.get("/", async (req: any, res) => {
  const { companyId } = req.user;
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const conditions: any[] = [eq(invoicesTable.companyId, companyId)];
  if (req.query.status) conditions.push(eq(invoicesTable.status, req.query.status as string));
  if (req.query.customerId) conditions.push(eq(invoicesTable.customerId, Number(req.query.customerId)));

  const [invoices, total] = await Promise.all([
    db.select().from(invoicesTable).where(and(...conditions)).orderBy(desc(invoicesTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(invoicesTable).where(and(...conditions)),
  ]);

  const customerIds = [...new Set(invoices.map(i => i.customerId))];
  const customers = customerIds.length > 0 ? await db.select().from(customersTable).where(sql`${customersTable.id} = ANY(${customerIds})`) : [];
  const customerMap = Object.fromEntries(customers.map(c => [c.id, `${c.firstName} ${c.lastName}`]));

  return res.json({ invoices: invoices.map(i => fmt(i, customerMap[i.customerId])), total: Number(total[0].count), page, limit });
});

router.post("/", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const invoiceNumber = await nextInvoiceNumber(companyId);
  const [inv] = await db.insert(invoicesTable).values({
    companyId,
    customerId: req.body.customerId,
    appointmentId: req.body.appointmentId ?? null,
    invoiceNumber,
    subtotal: String(req.body.subtotal ?? 0),
    tax: String(req.body.tax ?? 0),
    total: String(req.body.total ?? 0),
    status: req.body.status ?? "draft",
    dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
    notes: req.body.notes ?? null,
  }).returning();
  await logActivity({ companyId, userId, action: "invoice.created", entityType: "invoice", entityId: inv.id });
  return res.status(201).json(fmt(inv));
});

router.get("/:id", async (req: any, res) => {
  const { companyId } = req.user;
  const id = Number(req.params.id);
  const [inv] = await db.select().from(invoicesTable).where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId))).limit(1);
  if (!inv) return res.status(404).json({ error: "NotFound" });
  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, inv.customerId)).limit(1);
  return res.json(fmt(inv, customer ? `${customer.firstName} ${customer.lastName}` : undefined));
});

router.put("/:id", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(invoicesTable).where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });

  const updates: any = { updatedAt: new Date() };
  if (req.body.subtotal != null) updates.subtotal = String(req.body.subtotal);
  if (req.body.tax != null) updates.tax = String(req.body.tax);
  if (req.body.total != null) updates.total = String(req.body.total);
  if (req.body.status) updates.status = req.body.status;
  if (req.body.dueDate) updates.dueDate = new Date(req.body.dueDate);
  if (req.body.notes !== undefined) updates.notes = req.body.notes;
  if (req.body.paidAt) updates.paidAt = new Date(req.body.paidAt);

  const [updated] = await db.update(invoicesTable).set(updates).where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId))).returning();
  await logActivity({ companyId, userId, action: "invoice.updated", entityType: "invoice", entityId: id });
  return res.json(fmt(updated));
});

router.delete("/:id", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(invoicesTable).where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });
  await db.delete(invoicesTable).where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId)));
  await logActivity({ companyId, userId, action: "invoice.deleted", entityType: "invoice", entityId: id });
  return res.json({ success: true });
});

router.post("/:id/send", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(invoicesTable).where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });
  const [updated] = await db.update(invoicesTable).set({ status: "sent", updatedAt: new Date() }).where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId))).returning();
  await logActivity({ companyId, userId, action: "invoice.sent", entityType: "invoice", entityId: id });
  return res.json(fmt(updated));
});

router.post("/:id/mark-paid", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(invoicesTable).where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });
  const [updated] = await db.update(invoicesTable).set({ status: "paid", paidAt: new Date(), updatedAt: new Date() }).where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId))).returning();
  await logActivity({ companyId, userId, action: "invoice.paid", entityType: "invoice", entityId: id });
  return res.json(fmt(updated));
});

export default router;
