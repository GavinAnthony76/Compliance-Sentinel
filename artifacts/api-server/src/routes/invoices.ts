import { Router } from "express";
import { db, invoicesTable, invoiceLineItemsTable, customersTable, appointmentsTable, servicesTable, companiesTable, propertiesTable } from "@workspace/db";
import { eq, and, ne, sql, desc, inArray } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { requireActiveSubscription } from "../lib/subscription";
import { requireWithinPlanLimit, hasFeature } from "../lib/features";
import { logActivity } from "../lib/activity";
import { fireAutomations } from "../lib/automations";
import { dispatchPaymentReceiptEmail, dispatchOwnerPaymentNotification } from "../lib/notifications";
import { dispatchInvoiceEmail } from "../lib/invoice-email";
import { logger } from "../lib/logger";
import { buildInvoicePdf } from "../lib/invoice-pdf";
import { insertInvoiceWithNumber } from "../lib/invoice-number";

const router = Router();
router.use(requireAuth);
router.use(requireActiveSubscription);
// Invoicing is a manager capability — staff have no access.
router.use(requireRole("owner", "admin"));

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
  if (req.query.paymentMethod) conditions.push(eq(invoicesTable.paymentMethod, req.query.paymentMethod as string));
  if (req.query.customerId) conditions.push(eq(invoicesTable.customerId, Number(req.query.customerId)));

  // Aggregate payment-method totals across the FULL filtered set (not just the current page).
  // Online = paymentMethod 'card', or legacy null method with a Stripe payment intent; everything else is offline.
  const onlineExpr = sql`(${invoicesTable.paymentMethod} = 'card' OR (${invoicesTable.paymentMethod} IS NULL AND ${invoicesTable.stripePaymentIntentId} IS NOT NULL))`;
  const [invoices, total, summaryRows] = await Promise.all([
    db.select().from(invoicesTable).where(and(...conditions)).orderBy(desc(invoicesTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(invoicesTable).where(and(...conditions)),
    db.select({
      outstanding: sql<string>`coalesce(sum(${invoicesTable.total}) filter (where ${invoicesTable.status} in ('sent', 'overdue')), 0)`,
      paidTotal: sql<string>`coalesce(sum(${invoicesTable.total}) filter (where ${invoicesTable.status} = 'paid'), 0)`,
      paidOnline: sql<string>`coalesce(sum(${invoicesTable.total}) filter (where ${invoicesTable.status} = 'paid' and ${onlineExpr}), 0)`,
    }).from(invoicesTable).where(and(...conditions)),
  ]);

  const outstanding = Number(summaryRows[0].outstanding);
  const paidTotal = Number(summaryRows[0].paidTotal);
  const paidOnline = Number(summaryRows[0].paidOnline);
  const summary = {
    outstanding,
    paidTotal,
    paidOnline,
    paidOffline: Number((paidTotal - paidOnline).toFixed(2)),
  };

  const customerIds = [...new Set(invoices.map(i => i.customerId))];
  const customers = customerIds.length > 0 ? await db.select().from(customersTable).where(inArray(customersTable.id, customerIds)) : [];
  const customerMap = Object.fromEntries(customers.map(c => [c.id, c.firstName || c.phone ? `${c.firstName} ${c.lastName}`.trim() || c.phone : "Customer"]));

  return res.json({ invoices: invoices.map(i => fmt(i, customerMap[i.customerId] ?? undefined)), summary, total: Number(total[0].count), page, limit });
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

router.post("/", requireWithinPlanLimit("invoices"), async (req: any, res) => {
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

  // A "sent" status must reflect a real email send. Persist as "draft" first and
  // only promote to "sent" once the invoice email is actually delivered, so an
  // invoice can never surface as sent when no email ever went out.
  const requestedStatus = req.body.status ?? "draft";
  const initialStatus = requestedStatus === "sent" ? "draft" : requestedStatus;
  const inv = await insertInvoiceWithNumber(companyId, {
    customerId: req.body.customerId,
    appointmentId: req.body.appointmentId ?? null,
    subtotal: String(subtotal),
    tax: String(tax),
    total: String(total),
    status: initialStatus,
    dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
    notes: req.body.notes ?? null,
  });

  if (lineItems.length > 0) {
    await upsertLineItems(inv.id, lineItems);
  }

  await logActivity({ companyId, userId, action: "invoice.created", entityType: "invoice", entityId: inv.id });

  let finalInv = inv;
  if (requestedStatus === "sent") {
    const emailed = await dispatchInvoiceEmail(inv.id, companyId);
    if (emailed) {
      const [updated] = await db.update(invoicesTable)
        .set({ status: "sent", updatedAt: new Date() })
        .where(and(eq(invoicesTable.id, inv.id), eq(invoicesTable.companyId, companyId)))
        .returning();
      finalInv = updated ?? inv;
      await logActivity({ companyId, userId, action: "invoice.sent", entityType: "invoice", entityId: inv.id });
      fireAutomations(companyId, "invoice_sent", { customerId: finalInv.customerId, userId, invoiceId: inv.id });
    }
  }

  const savedLineItems = await db.select().from(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, inv.id)).orderBy(invoiceLineItemsTable.sortOrder);
  return res.status(201).json(fmt(finalInv, undefined, savedLineItems.map(fmtLineItem)));
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

  // A "sent" status must reflect a real email send. Defer any draft->sent
  // transition until the invoice email is confirmed delivered (handled below),
  // so an update can never falsely flip an invoice to "sent".
  const wantsSentTransition = req.body.status === "sent" && existing.status !== "sent";
  if (req.body.status && !wantsSentTransition) updates.status = req.body.status;
  if (req.body.dueDate) updates.dueDate = new Date(req.body.dueDate);
  if (req.body.notes !== undefined) updates.notes = req.body.notes;
  if (req.body.paidAt) updates.paidAt = new Date(req.body.paidAt);

  let [updated] = await db.update(invoicesTable).set(updates).where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId))).returning();
  if (lineItems) {
    await upsertLineItems(id, lineItems);
  }
  await logActivity({ companyId, userId, action: "invoice.updated", entityType: "invoice", entityId: id });
  if (updates.status === "overdue" && existing.status !== "overdue") {
    fireAutomations(companyId, "invoice_overdue", { customerId: existing.customerId, userId, invoiceId: id });
  }
  if (wantsSentTransition) {
    const emailed = await dispatchInvoiceEmail(id, companyId);
    if (emailed) {
      const [promoted] = await db.update(invoicesTable)
        .set({ status: "sent", updatedAt: new Date() })
        .where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId)))
        .returning();
      updated = promoted ?? updated;
      await logActivity({ companyId, userId, action: "invoice.sent", entityType: "invoice", entityId: id });
      fireAutomations(companyId, "invoice_sent", { customerId: existing.customerId, userId, invoiceId: id });
    }
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
  // Attempt delivery FIRST so the invoice is only marked "sent" when the email
  // actually went out — status must reflect real sends, never an assumed one.
  const emailed = await dispatchInvoiceEmail(id, companyId);
  if (!emailed) {
    return res.status(502).json({
      error: "EmailDeliveryFailed",
      message:
        "The invoice email could not be sent, so the invoice was not marked as sent. Check the customer's email address and your email settings, then try again.",
    });
  }
  const [updated] = await db.update(invoicesTable).set({ status: "sent", updatedAt: new Date() }).where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId))).returning();
  await logActivity({ companyId, userId, action: "invoice.sent", entityType: "invoice", entityId: id });
  fireAutomations(companyId, "invoice_sent", { customerId: existing.customerId, userId, invoiceId: id });
  const lineItems = await db.select().from(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, id)).orderBy(invoiceLineItemsTable.sortOrder);
  return res.json(fmt(updated, undefined, lineItems.map(fmtLineItem)));
});

router.get("/:id/pdf", async (req: any, res) => {
  const { companyId } = req.user;
  const id = Number(req.params.id);
  const [inv] = await db.select().from(invoicesTable).where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId))).limit(1);
  if (!inv) {
    res.status(404).json({ error: "NotFound" });
    return;
  }
  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, inv.customerId)).limit(1);
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
  const lineItems = await db.select().from(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, id)).orderBy(invoiceLineItemsTable.sortOrder);

  const pdfBuffer = await buildInvoicePdf({ invoice: inv, customer, company, lineItems });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="invoice-${inv.invoiceNumber}.pdf"`);
  res.send(pdfBuffer);
});

router.post("/:id/mark-paid", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(invoicesTable).where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });
  const updateData: any = { status: "paid", paidAt: new Date(), updatedAt: new Date() };
  if (req.body.paymentMethod) updateData.paymentMethod = req.body.paymentMethod;
  if (req.body.paymentMethodNote) updateData.paymentMethodNote = req.body.paymentMethodNote;
  // Transition-guarded update: only the request that actually flips status ->
  // paid notifies, so concurrent mark-paid calls can't double-send emails.
  const [transitioned] = await db.update(invoicesTable).set(updateData)
    .where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId), ne(invoicesTable.status, "paid")))
    .returning();
  const [updated] = transitioned
    ? [transitioned]
    : await db.select().from(invoicesTable).where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId))).limit(1);
  await logActivity({ companyId, userId, action: "invoice.paid", entityType: "invoice", entityId: id, metadata: { paymentMethod: req.body.paymentMethod } });
  if (transitioned) {
    dispatchPaymentReceiptEmail(id, companyId);
    dispatchOwnerPaymentNotification(id, companyId);
  }
  const lineItems = await db.select().from(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, id)).orderBy(invoiceLineItemsTable.sortOrder);
  return res.json(fmt(updated, undefined, lineItems.map(fmtLineItem)));
});

export default router;
