import { Router } from "express";
import { db, invoicesTable, invoiceLineItemsTable, customersTable, appointmentsTable, servicesTable, companiesTable } from "@workspace/db";
import { eq, and, ne, sql, desc, inArray } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { requireActiveSubscription } from "../lib/subscription";
import { requireWithinPlanLimit, hasFeature } from "../lib/features";
import { logActivity } from "../lib/activity";
import { fireAutomations } from "../lib/automations";
import { dispatchPaymentReceiptEmail, dispatchOwnerPaymentNotification } from "../lib/notifications";
import { dispatchInvoiceEmail } from "../lib/invoice-email";
import { logger } from "../lib/logger";
import { fetchImageBufferSafe } from "../lib/safe-fetch";
import PDFDocument from "pdfkit";

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

  return res.json({ invoices: invoices.map(i => fmt(i, customerMap[i.customerId] ?? undefined)), total: Number(total[0].count), page, limit });
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

  const customerName = customer ? (`${customer.firstName} ${customer.lastName}`.trim() || customer.phone || "Customer") : "Customer";
  const companyName = company?.name || "Your Service Provider";

  function isValidHex(hex: string): boolean {
    return /^#[0-9a-fA-F]{6}$/.test(hex);
  }

  function hexToRgb(hex: string): [number, number, number] {
    const cleaned = hex.replace("#", "");
    const bigint = parseInt(cleaned, 16);
    return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
  }

  const rawColor = company?.primaryColor ?? "";
  const primaryHex = isValidHex(rawColor) ? rawColor : "#16a34a";
  const [pr, pg, pb] = hexToRgb(primaryHex);

  // Fetch company logo if available (SSRF-guarded against tenant-supplied URLs)
  const logoBuffer: Buffer | null = company?.logoUrl ? await fetchImageBufferSafe(company.logoUrl) : null;

  const doc = new PDFDocument({ margin: 50, size: "LETTER" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="invoice-${inv.invoiceNumber}.pdf"`);
  doc.pipe(res);

  const pageWidth = doc.page.width;
  const margin = 50;
  const contentWidth = pageWidth - margin * 2;

  // Header band
  doc.rect(0, 0, pageWidth, 110).fill(primaryHex);

  // Logo or company name in header
  const logoMaxH = 54;
  const logoMaxW = contentWidth * 0.35;
  if (logoBuffer) {
    try {
      doc.image(logoBuffer, margin, 28, { fit: [logoMaxW, logoMaxH], valign: "center" });
    } catch {
      // If pdfkit can't render the logo format, fall back to text
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(22).text(companyName, margin, 28, { width: contentWidth * 0.6 });
    }
  } else {
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(22).text(companyName, margin, 28, { width: contentWidth * 0.6 });
  }

  // Company contact info (always shown, even when logo is present)
  const contactLines: string[] = [];
  if (company?.address) {
    const cityStateZip = [company.city, company.state, company.zip].filter(Boolean).join(", ");
    contactLines.push(company.address + (cityStateZip ? `, ${cityStateZip}` : ""));
  }
  if (company?.phone) contactLines.push(company.phone);
  if (company?.email) contactLines.push(company.email);
  if (contactLines.length > 0) {
    const contactY = logoBuffer ? 86 : 58;
    doc.font("Helvetica").fontSize(9).fillColor("#ffffff").text(contactLines.join("  ·  "), margin, contactY, { width: contentWidth * 0.65 });
  }

  // INVOICE label top-right
  doc.font("Helvetica-Bold").fontSize(28).fillColor("#ffffff").text("INVOICE", margin + contentWidth * 0.6, 22, { width: contentWidth * 0.4, align: "right" });
  doc.font("Helvetica").fontSize(10).fillColor("#ffffffcc").text(inv.invoiceNumber, margin + contentWidth * 0.6, 56, { width: contentWidth * 0.4, align: "right" });

  // Below header: bill to + invoice meta
  const infoY = 130;
  doc.fillColor("#111111");

  // Bill To
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#888888").text("BILL TO", margin, infoY);
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#111111").text(customerName, margin, infoY + 14);
  if (customer?.email) doc.font("Helvetica").fontSize(10).fillColor("#555555").text(customer.email, margin, infoY + 30);
  if (customer?.phone && customer.email !== customer.phone) doc.font("Helvetica").fontSize(10).fillColor("#555555").text(customer.phone, margin, infoY + (customer.email ? 44 : 30));

  // Invoice meta (right side)
  const metaX = margin + contentWidth * 0.6;
  const metaLabelW = 80;
  const metaValueW = contentWidth * 0.4 - metaLabelW;

  function metaRow(label: string, value: string, y: number) {
    doc.font("Helvetica").fontSize(10).fillColor("#888888").text(label, metaX, y, { width: metaLabelW, align: "left" });
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#111111").text(value, metaX + metaLabelW, y, { width: metaValueW, align: "right" });
  }

  metaRow("Invoice #", inv.invoiceNumber, infoY);
  if (inv.dueDate) {
    metaRow("Due Date", new Date(inv.dueDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }), infoY + 18);
  }
  metaRow("Status", inv.status.charAt(0).toUpperCase() + inv.status.slice(1), infoY + (inv.dueDate ? 36 : 18));

  // Line items table
  const tableY = infoY + 90;
  const colDesc = margin;
  const colQty = margin + contentWidth * 0.55;
  const colUnit = margin + contentWidth * 0.7;
  const colTotal = margin + contentWidth * 0.85;
  const colWidths = { desc: contentWidth * 0.55, qty: contentWidth * 0.15, unit: contentWidth * 0.15, total: contentWidth * 0.15 };

  // Table header
  doc.rect(margin, tableY, contentWidth, 24).fill(`rgb(${pr},${pg},${pb})`);
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff");
  doc.text("DESCRIPTION", colDesc + 6, tableY + 7, { width: colWidths.desc });
  doc.text("QTY", colQty, tableY + 7, { width: colWidths.qty, align: "center" });
  doc.text("UNIT PRICE", colUnit, tableY + 7, { width: colWidths.unit, align: "right" });
  doc.text("TOTAL", colTotal, tableY + 7, { width: colWidths.total, align: "right" });

  let rowY = tableY + 24;
  lineItems.forEach((li, i) => {
    const rowH = 28;
    if (i % 2 === 1) doc.rect(margin, rowY, contentWidth, rowH).fill("#f9fafb");
    doc.font("Helvetica").fontSize(10).fillColor("#111111");
    doc.text(li.description || "—", colDesc + 6, rowY + 8, { width: colWidths.desc - 10 });
    doc.text(String(Number(li.quantity)), colQty, rowY + 8, { width: colWidths.qty, align: "center" });
    doc.text(`$${Number(li.unitPrice).toFixed(2)}`, colUnit, rowY + 8, { width: colWidths.unit, align: "right" });
    doc.text(`$${Number(li.lineTotal).toFixed(2)}`, colTotal, rowY + 8, { width: colWidths.total, align: "right" });
    rowY += rowH;
  });

  // Border around table
  doc.rect(margin, tableY, contentWidth, rowY - tableY).strokeColor("#e5e7eb").lineWidth(1).stroke();

  // Totals block
  rowY += 12;
  const totalsX = margin + contentWidth * 0.6;
  const totalsW = contentWidth * 0.4;

  function totalRow(label: string, value: string, y: number, bold = false) {
    const font = bold ? "Helvetica-Bold" : "Helvetica";
    doc.font(font).fontSize(10).fillColor(bold ? "#111111" : "#555555").text(label, totalsX, y, { width: totalsW * 0.55 });
    doc.font(font).fontSize(10).fillColor(bold ? "#111111" : "#555555").text(value, totalsX + totalsW * 0.55, y, { width: totalsW * 0.45, align: "right" });
  }

  totalRow("Subtotal", `$${Number(inv.subtotal).toFixed(2)}`, rowY);
  totalRow("Tax", `$${Number(inv.tax).toFixed(2)}`, rowY + 18);

  // Total divider
  rowY += 36;
  doc.moveTo(totalsX, rowY).lineTo(totalsX + totalsW, rowY).strokeColor("#e5e7eb").lineWidth(1).stroke();
  rowY += 6;

  doc.font("Helvetica-Bold").fontSize(13).fillColor(`rgb(${pr},${pg},${pb})`).text("Total Due", totalsX, rowY, { width: totalsW * 0.55 });
  doc.font("Helvetica-Bold").fontSize(13).fillColor(`rgb(${pr},${pg},${pb})`).text(`$${Number(inv.total).toFixed(2)}`, totalsX + totalsW * 0.55, rowY, { width: totalsW * 0.45, align: "right" });

  // Notes
  if (inv.notes) {
    rowY += 50;
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#888888").text("NOTES", margin, rowY);
    doc.font("Helvetica").fontSize(10).fillColor("#333333").text(inv.notes, margin, rowY + 14, { width: contentWidth * 0.55 });
  }

  // Payment instructions
  const paymentLines: string[] = [];
  if (company?.paymentInstructions) paymentLines.push(company.paymentInstructions);
  if (company?.checkPayableTo) paymentLines.push(`Check payable to: ${company.checkPayableTo}`);
  if (company?.zelleInfo) paymentLines.push(`Zelle: ${company.zelleInfo}`);
  if (company?.venmoHandle) paymentLines.push(`Venmo: ${company.venmoHandle}`);
  if (company?.cashAppTag) paymentLines.push(`Cash App: ${company.cashAppTag}`);

  if (paymentLines.length > 0) {
    const payY = inv.notes ? rowY + 70 : rowY + 50;
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#888888").text("PAYMENT INSTRUCTIONS", margin, payY);
    doc.font("Helvetica").fontSize(10).fillColor("#333333").text(paymentLines.join("\n"), margin, payY + 14, { width: contentWidth });
  }

  // Footer
  const footerY = doc.page.height - 50;
  doc.moveTo(margin, footerY).lineTo(pageWidth - margin, footerY).strokeColor("#e5e7eb").lineWidth(1).stroke();
  doc.font("Helvetica").fontSize(8).fillColor("#aaaaaa").text(`Thank you for your business — ${companyName}`, margin, footerY + 10, { width: contentWidth, align: "center" });

  doc.end();
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
