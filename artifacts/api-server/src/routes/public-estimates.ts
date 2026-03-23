import { Router } from "express";
import { db, estimatesTable, estimateLineItemsTable, customersTable, companiesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import crypto from "crypto";

const router = Router();

// GET /public/estimates/:token — get estimate for signing
router.get("/estimates/:token", async (req, res) => {
  const { token } = req.params;
  const [estimate] = await db.select().from(estimatesTable).where(eq(estimatesTable.publicToken, token)).limit(1);
  if (!estimate) return res.status(404).json({ error: "NotFound", message: "Estimate not found" });

  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, estimate.customerId)).limit(1);
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, estimate.companyId)).limit(1);
  const lineItems = await db.select().from(estimateLineItemsTable).where(eq(estimateLineItemsTable.estimateId, estimate.id)).orderBy(estimateLineItemsTable.sortOrder);

  return res.json({
    id: estimate.id,
    estimateNumber: estimate.estimateNumber,
    status: estimate.status,
    subtotal: Number(estimate.subtotal),
    tax: Number(estimate.tax),
    total: Number(estimate.total),
    validUntil: estimate.validUntil,
    notes: estimate.notes,
    signedAt: estimate.signedAt,
    signerName: estimate.signerName,
    lineItems: lineItems.map(li => ({ ...li, quantity: Number(li.quantity), unitPrice: Number(li.unitPrice), total: Number(li.total) })),
    customer: customer ? { firstName: customer.firstName, lastName: customer.lastName, email: customer.email } : null,
    company: company ? { name: company.name, logoUrl: company.logoUrl, primaryColor: company.primaryColor, phone: company.phone } : null,
  });
});

// POST /public/estimates/:token/sign — customer signs estimate
router.post("/estimates/:token/sign", async (req, res) => {
  const { token } = req.params;
  const parsed = z.object({
    signerName: z.string().min(1),
    signatureData: z.string().min(1), // base64 PNG from canvas
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "ValidationError", message: parsed.error.message });

  const [estimate] = await db.select().from(estimatesTable).where(eq(estimatesTable.publicToken, token)).limit(1);
  if (!estimate) return res.status(404).json({ error: "NotFound" });
  if (estimate.signedAt) return res.status(400).json({ error: "AlreadySigned", message: "This estimate has already been signed" });
  if (estimate.status === "rejected") return res.status(400).json({ error: "Rejected", message: "This estimate has been rejected" });

  const [updated] = await db.update(estimatesTable).set({
    status: "accepted",
    signedAt: new Date(),
    signerName: parsed.data.signerName,
    signatureData: parsed.data.signatureData,
    updatedAt: new Date(),
  }).where(eq(estimatesTable.publicToken, token)).returning();

  return res.json({ success: true, signedAt: updated.signedAt, message: "Thank you! Your estimate has been signed and accepted." });
});

export default router;
