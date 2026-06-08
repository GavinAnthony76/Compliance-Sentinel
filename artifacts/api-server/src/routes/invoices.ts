import { Router } from "express";
import { db, invoicesTable, invoiceLineItemsTable, customersTable, appointmentsTable, servicesTable, companiesTable } from "@workspace/db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { logActivity } from "../lib/activity";
import { fireAutomations } from "../lib/automations";
import { sendInvoiceEmail, resolveBaseUrl, dispatchPaymentReceiptEmail } from "../lib/notifications";
import { logger } from "../lib/logger";

const router = Router();
router.use(requireAuth);

function fmt(inv: any, customerName?: string, lineItems?: any[]) {
  return {
    ...inv,
    subtotal: Number(inv.subtotal),
    tax: Number(inv.tax),
    total: Number(inv.total),
    customerName: customerName ?? null,
    lineItems: lineItems ?? [],
  };
}

function fmtLineItem(li: any) {
  return {
    ...li,
    quantity: Number(li.quantity),
    unitPrice: Number(li.unitPrice),
    lineTotal: Number(li.lineTotal),
  };
}

async function dispatchInvoiceEmail(invoiceId: number, companyId: number): Promise<void> {
  try {
    const [inv] = await db.select().from(invoicesTable).where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.companyId, companyId))).limit(1);
    if (!inv) return;
    const [customer] = await db.select().from(customersTable).where(and(eq(customersTable.id, inv.customerId), eq(customersTable.companyId, companyId))).limit(1);
    if (!customer?.email) return;
    const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
    const lineItems = await db.select().from(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, invoiceId)).orderBy(invoiceLineItemsTable.sortOrder);
    const companyName = company?.name || "Your Service Provider";
    const companySlug = company?.slug || "";
    const baseUrl = resolveBaseUrl();
    const portalUrl = companySlug ? `${baseUrl}/portal/${companySlug}/invoices` : baseUrl;
    const customerName = `${customer.firstName} ${customer.lastName}`.trim() || customer.email;
    await sendInvoiceEmail({
      customerEmail: customer.email,
      customerName,
      companyName,
      invoiceNumber: inv.invoiceNumber,
      dueDate: inv.dueDate ? new Date(inv.dueDate) : null,
      lineItems: lineItems.map(li => ({
        description: li.description,
        quantity: Number(li.quantity),
        unitPrice: Number(li.unitPrice),
        lineTotal: Number(li.lineTotal),
      })),
      total: Number(inv.total),
      portalUrl,
      logoUrl: company?.logoUrl ?? null,
      primaryColor: company?.primaryColor ?? null,
    });
  } catch (err) {
    logger.error({ err, invoiceId, companyId }, "Failed to dispatch invoice email");
  }
}

async function nextInvoiceNumber(companyId: number): Promise<string> {
  const [result] = await db.select({ count: sql<number>`count(*)` }).from(invoicesTable).where(eq(invoicesTable.companyId, companyId));
  const num = Number(result.count) + 1;
  return `INV-${String(num).padStart(4, "0")}`;
}

async function upsertLineItems(invoiceId: number, lineItems: any[]) {
  await db.delete(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, invoiceId));
  if (!lineItems || lineItems.length === 0) return;
  await db.insert(invoiceLineItemsTable).values(
    lineItems.map((li: any, i: number) => {
      const qty = Number(li.quantity ?? 1);
      const unitPrice = Number(li.unitPrice ?? 0);
      const lineTotal = Number((qty * unitPrice).toFixed(2));
      return {
        invoiceId,
        description: String(li.description ?? "Service"),
        quantity: String(qty),
        unitPrice: String(unitPrice),
        lineTotal: String(lineTotal),
        sortOrder: i,
      };
    })
  );
}

function calcTotalsFromLineItems(lineItems: any[], taxOverride?: number) {
  const subtotal = lineItems.reduce((sum, li) => sum + Number(li.quantity ?? 1) * Number(li.unitPrice ?? 0), 0);
  const tax = taxOverride ?? 0;
  return { subtotal: Number(subtotal.toFixed(2)), tax: Number(tax.toFixed(2)), total: Number((subtotal + tax).toFixed(2)) };
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
  const customers = customerIds.length > 0 ? await db.select().from(customersTable).where(inArray(customersTable.id, customerIds)) : [];
  const customerMap = Object.fromEntries(customers.map(c => [c.id, c.firstName || c.phone ? `${c.firstName} ${c.lastName}`.trim() || c.phone : "Customer"]));

  return res.json({ invoices: invoices.map(i => fmt(i, customerMap[i.customerId])), total: Number(total[0].count), page, limit });
});

// Shared handler for GET and POST /invoices/from-appointment/:appointmentId
// Returns pre-filled invoice data for an appointment (not saved). POST alias added per spec.
async function handleFromAppointment(req: any, res: any) {
  const { companyId } = req.user;
  const appointmentId = Number(req.params.appointmentId);

  const [appt] = await db.select().from(appointmentsTable)
    .where(and(eq(appointmentsTable.id, appointmentId), eq(appointmentsTable.companyId, companyId)))
    .limit(1);
  if (!appt) return res.status(404).json({ error: "NotFound", message: "Appointment not found" });

  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, appt.customerId)).limit(1);
  let service: any = null;
  if (appt.serviceId) {
    [service] = await db.select().from(servicesTable).where(eq(servicesTable.id, appt.serviceId)).limit(1);
  }

  const price = appt.price ? Number(appt.price) : (service?.basePrice ? Number(service.basePrice) : 0);
  const lineItems = [{
    description: service?.name ?? "Service Rendered",
    quantity: 1,
    unitPrice: price,
    lineTotal: price,
  }];
  const { subtotal, tax, total } = calcTotalsFromLineItems(lineItems);

  const [existingInv] = await db.select({ id: invoicesTable.id }).from(invoicesTable)
    .where(and(eq(invoicesTable.appointmentId, appointmentId), eq(invoicesTable.companyId, companyId)))
    .limit(1);

  return res.json({
    existingInvoiceId: existingInv?.id ?? null,
    customerId: appt.customerId,
    customerName: customer ? (`${customer.firstName} ${customer.lastName}`.trim() || customer.phone) : null,
    appointmentId,
    lineItems,
    subtotal,
    tax,
    total,
    notes: `Services rendered on ${new Date(appt.scheduledStart).toLocaleDateString()}`,
  });
}

router.get("/from-appointment/:appointmentId", handleFromAppointment);
router.post("/from-appointment/:appointmentId", handleFromAppointment);

router.post("/", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const lineItems: any[] = req.body.lineItems ?? [];

  let subtotal = Number(req.body.subtotal ?? 0);
  let tax = Number(req.body.tax ?? 0);
  let total = Number(req.body.total ?? 0);

  if (lineItems.length > 0) {
    const calc = calcTotalsFromLineItems(lineItems, tax);
    subtotal = calc.subtotal;
    tax = calc.tax;
    total = calc.total;
  }

  const invoiceNumber = await nextInvoiceNumber(companyId);
  const [inv] = await db.insert(invoicesTable).values({
    companyId,
    customerId: req.body.customerId,
    appointmentId: req.body.appointmentId ?? null,
    invoiceNumber,
    subtotal: String(subtotal),
    tax: String(tax),
    total: String(total),
    status: req.body.status ?? "draft",
    dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
    notes: req.body.notes ?? null,
  }).returning();

  if (lineItems.length > 0) {
    await upsertLineItems(inv.id, lineItems);
  }

  await logActivity({ companyId, userId, action: "invoice.created", entityType: "invoice", entityId: inv.id });
  if (inv.status === "sent") {
    dispatchInvoiceEmail(inv.id, companyId);
  }
  const savedLineItems = await db.select().from(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, inv.id)).orderBy(invoiceLineItemsTable.sortOrder);
  return res.status(201).json(fmt(inv, undefined, savedLineItems.map(fmtLineItem)));
});

router.get("/:id", async (req: any, res) => {
  const { companyId } = req.user;
  const id = Number(req.params.id);
  const [inv] = await db.select().from(invoicesTable).where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId))).limit(1);
  if (!inv) return res.status(404).json({ error: "NotFound" });
  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, inv.customerId)).limit(1);
  const lineItems = await db.select().from(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, id)).orderBy(invoiceLineItemsTable.sortOrder);
  const customerName = customer ? (`${customer.firstName} ${customer.lastName}`.trim() || customer.phone || undefined) : undefined;
  return res.json(fmt(inv, customerName, lineItems.map(fmtLineItem)));
});

router.put("/:id", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(invoicesTable).where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });

  const lineItems: any[] | undefined = req.body.lineItems;
  const updates: any = { updatedAt: new Date() };

  if (lineItems && lineItems.length > 0) {
    const tax = req.body.tax != null ? Number(req.body.tax) : 0;
    const calc = calcTotalsFromLineItems(lineItems, tax);
    updates.subtotal = String(calc.subtotal);
    updates.tax = String(calc.tax);
    updates.total = String(calc.total);
  } else {
    if (req.body.subtotal != null) updates.subtotal = String(req.body.subtotal);
    if (req.body.tax != null) updates.tax = String(req.body.tax);
    if (req.body.total != null) updates.total = String(req.body.total);
  }

  if (req.body.status) updates.status = req.body.status;
  if (req.body.dueDate) updates.dueDate = new Date(req.body.dueDate);
  if (req.body.notes !== undefined) updates.notes = req.body.notes;
  if (req.body.paidAt) updates.paidAt = new Date(req.body.paidAt);

  const [updated] = await db.update(invoicesTable).set(updates).where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId))).returning();
  if (lineItems) {
    await upsertLineItems(id, lineItems);
  }
  await logActivity({ companyId, userId, action: "invoice.updated", entityType: "invoice", entityId: id });
  if (updates.status === "overdue" && existing.status !== "overdue") {
    fireAutomations(companyId, "invoice_overdue", { customerId: existing.customerId, userId, invoiceId: id });
  }
  const savedLineItems = await db.select().from(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, id)).orderBy(invoiceLineItemsTable.sortOrder);
  return res.json(fmt(updated, undefined, savedLineItems.map(fmtLineItem)));
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
  fireAutomations(companyId, "invoice_sent", { customerId: existing.customerId, userId, invoiceId: id });
  dispatchInvoiceEmail(id, companyId);
  const lineItems = await db.select().from(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, id)).orderBy(invoiceLineItemsTable.sortOrder);
  return res.json(fmt(updated, undefined, lineItems.map(fmtLineItem)));
});

router.post("/:id/mark-paid", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(invoicesTable).where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });
  const updateData: any = { status: "paid", paidAt: new Date(), updatedAt: new Date() };
  if (req.body.paymentMethod) updateData.paymentMethod = req.body.paymentMethod;
  if (req.body.paymentMethodNote) updateData.paymentMethodNote = req.body.paymentMethodNote;
  const [updated] = await db.update(invoicesTable).set(updateData).where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId))).returning();
  await logActivity({ companyId, userId, action: "invoice.paid", entityType: "invoice", entityId: id, metadata: { paymentMethod: req.body.paymentMethod } });
  if (existing.status !== "paid") {
    dispatchPaymentReceiptEmail(id, companyId);
  }
  const lineItems = await db.select().from(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, id)).orderBy(invoiceLineItemsTable.sortOrder);
  return res.json(fmt(updated, undefined, lineItems.map(fmtLineItem)));
});

export default router;
