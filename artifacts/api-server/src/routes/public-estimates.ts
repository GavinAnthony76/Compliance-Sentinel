import { Router } from "express";
import { db, estimatesTable, estimateLineItemsTable, customersTable, companiesTable } from "@workspace/db";
import { eq, and, ne, isNull } from "drizzle-orm";
import { z } from "zod";
import crypto from "crypto";
import { sendEmail, resolveBaseUrl, resolveCompanyNotificationEmail } from "../lib/notifications";
import { buildEstimatePdf } from "../lib/estimate-pdf";
import { logActivity } from "../lib/activity";
import { logger } from "../lib/logger";

const router = Router();

// Share tokens are stored only as a SHA-256 hash (see routes/estimates.ts), so
// every public lookup must hash the raw token from the URL. Comparing the raw
// value would never match — and would let a leaked stored hash act as a link.
function hashShareToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Generate the signed-estimate PDF and email a copy to the customer, plus
// notify the business that the estimate was accepted. Never fails the signing
// response: all errors are caught and logged. Resolves to whether the
// customer's copy was actually delivered.
async function dispatchSignedEstimateEmails(token: string): Promise<boolean> {
  try {
    const [estimate] = await db.select().from(estimatesTable).where(eq(estimatesTable.publicToken, hashShareToken(token))).limit(1);
    if (!estimate) return false;
    const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, estimate.customerId)).limit(1);
    const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, estimate.companyId)).limit(1);
    const lineItems = await db
      .select()
      .from(estimateLineItemsTable)
      .where(eq(estimateLineItemsTable.estimateId, estimate.id))
      .orderBy(estimateLineItemsTable.sortOrder);

    const companyName = company?.name || "Your Service Provider";
    const total = Number(estimate.total).toFixed(2);
    const viewUrl = `${resolveBaseUrl()}/estimates/${token}/sign`;

    let pdfBuffer: Buffer | null = null;
    try {
      pdfBuffer = await buildEstimatePdf({
        estimate: {
          estimateNumber: estimate.estimateNumber,
          status: estimate.status,
          subtotal: estimate.subtotal,
          tax: estimate.tax,
          total: estimate.total,
          validUntil: estimate.validUntil,
          notes: estimate.notes,
          signedAt: estimate.signedAt,
          signerName: estimate.signerName,
          signatureData: estimate.signatureData,
        },
        customer,
        company,
        lineItems: lineItems.map(li => ({
          description: li.description,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          total: li.total,
        })),
      });
    } catch (err) {
      logger.error({ err, estimateId: estimate.id }, "Failed to build signed estimate PDF");
    }

    const attachments = pdfBuffer
      ? [{ filename: `estimate-${estimate.estimateNumber}-signed.pdf`, content: pdfBuffer }]
      : undefined;

    // Customer confirmation with a signed copy attached
    let customerEmailed = false;
    if (customer?.email) {
      const firstName = customer.firstName || "there";
      const body = [
        `Hi ${firstName},`,
        "",
        `Thank you for accepting estimate ${estimate.estimateNumber} for $${total} from ${companyName}.`,
        "",
        pdfBuffer
          ? "A signed copy of your estimate is attached to this email for your records."
          : "Your estimate has been signed and accepted.",
        "",
        `You can also view it online anytime here: ${viewUrl}`,
        "",
        `Thank you,`,
        companyName,
      ].join("\n");

      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#111;">
          <h2 style="color:#16a34a;margin:0 0 12px;">Estimate accepted</h2>
          <p>Hi ${firstName},</p>
          <p>Thank you for accepting estimate <strong>${estimate.estimateNumber}</strong> for
          <strong>$${total}</strong> from <strong>${companyName}</strong>.</p>
          <p>${pdfBuffer
            ? "A signed copy of your estimate is <strong>attached to this email</strong> for your records — feel free to keep it."
            : "Your estimate has been signed and accepted."}</p>
          <p style="margin:24px 0;">
            <a href="${viewUrl}" style="background:#16a34a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block;">View estimate online</a>
          </p>
          <p style="color:#555;">Thank you,<br/>${companyName}</p>
        </div>`;

      const result = await sendEmail({
        to: customer.email,
        subject: `Your signed estimate ${estimate.estimateNumber} — ${companyName}`,
        body,
        html,
        attachments,
      });
      customerEmailed = result.delivered;
    }

    // Business notification: company contact email, falling back to the owner
    // (the same recipient rule as booking/cancellation notices).
    const businessEmail = company ? await resolveCompanyNotificationEmail(company.id, company.email) : null;
    if (businessEmail) {
      const customerName = customer
        ? (`${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim() || customer.email || "A customer")
        : "A customer";
      const signedDate = estimate.signedAt
        ? new Date(estimate.signedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
        : "";
      const body = [
        `${customerName} accepted estimate ${estimate.estimateNumber} for $${total}.`,
        estimate.signerName ? `Signed by: ${estimate.signerName}` : "",
        signedDate ? `Date: ${signedDate}` : "",
        pdfBuffer ? "\nA signed copy is attached." : "",
      ].filter(Boolean).join("\n");

      await sendEmail({
        to: businessEmail,
        subject: `Estimate ${estimate.estimateNumber} accepted by ${customerName}`,
        body,
        attachments,
      });
    }
    return customerEmailed;
  } catch (err) {
    logger.error({ err, token: "[redacted]" }, "Failed to dispatch signed estimate emails");
    return false;
  }
}

// GET /public/estimates/:token — get estimate for signing
router.get("/estimates/:token", async (req, res) => {
  const { token } = req.params;
  const [estimate] = await db.select().from(estimatesTable).where(eq(estimatesTable.publicToken, hashShareToken(token))).limit(1);
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
  const tokenHash = hashShareToken(token);
  const parsed = z.object({
    // 200 chars is generous for a full name; prevents DB bloat from crafted payloads.
    signerName: z.string().min(1).max(200).trim(),
    // base64 PNG from canvas. A typical 400×150 signature canvas is ~15–40 KB
    // base64-encoded (~20–55 KB text). 200 KB is a safe ceiling that blocks
    // oversized payloads while comfortably fitting any real signature image.
    signatureData: z.string().min(1).max(204_800).refine(
      (v) => v.startsWith("data:image/png;base64,") || v.startsWith("data:image/jpeg;base64,"),
      { message: "signatureData must be a base64-encoded PNG or JPEG data URL" },
    ),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "ValidationError", message: parsed.error.message });

  const [estimate] = await db.select().from(estimatesTable).where(eq(estimatesTable.publicToken, tokenHash)).limit(1);
  if (!estimate) return res.status(404).json({ error: "NotFound" });
  if (estimate.signedAt) return res.status(400).json({ error: "AlreadySigned", message: "This estimate has already been signed" });
  if (estimate.status === "rejected") return res.status(400).json({ error: "Rejected", message: "This estimate has been rejected" });

  // Guarded update: only an unsigned, non-rejected row is accepted, so a repeat
  // or concurrent submission that passed the checks above cannot sign twice.
  const [updated] = await db.update(estimatesTable).set({
    status: "accepted",
    signedAt: new Date(),
    signerName: parsed.data.signerName,
    signatureData: parsed.data.signatureData,
    updatedAt: new Date(),
  }).where(and(
    eq(estimatesTable.publicToken, tokenHash),
    isNull(estimatesTable.signedAt),
    ne(estimatesTable.status, "rejected"),
  )).returning();
  if (!updated) {
    const [current] = await db.select({ status: estimatesTable.status }).from(estimatesTable).where(eq(estimatesTable.publicToken, tokenHash)).limit(1);
    if (!current) return res.status(404).json({ error: "NotFound" });
    if (current.status === "rejected") return res.status(400).json({ error: "Rejected", message: "This estimate has been rejected" });
    return res.status(400).json({ error: "AlreadySigned", message: "This estimate has already been signed" });
  }

  // Record activity so the company's in-app activity indicator surfaces the signing.
  await logActivity({
    companyId: updated.companyId,
    action: "estimate.signed",
    entityType: "estimate",
    entityId: updated.id,
    metadata: { estimateNumber: updated.estimateNumber, signerName: parsed.data.signerName },
  });

  // Awaited: on Autoscale, work started after the response is sent gets
  // CPU-throttled and can be silently dropped. The dispatcher catches its own
  // errors, so awaiting never fails the signing; it reports whether the
  // customer's copy was delivered so the message below never over-promises.
  const customerEmailed = await dispatchSignedEstimateEmails(token);

  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, updated.customerId)).limit(1);
  const message = customerEmailed
    ? "Thank you! Your estimate has been signed and accepted. A signed copy has been emailed to you."
    : "Thank you! Your estimate has been signed and accepted. You can download a signed copy below.";

  // signedCopyEmailed is the confirmed delivery outcome; the signing page shows
  // "emailed" only when it is true (an address on file is not proof of delivery).
  return res.json({
    success: true,
    signedAt: updated.signedAt,
    signerName: updated.signerName,
    customerHasEmail: Boolean(customer?.email),
    signedCopyEmailed: customerEmailed,
    message,
  });
});

// GET /public/estimates/:token/pdf — download the estimate (signed copy when signed)
router.get("/estimates/:token/pdf", async (req, res) => {
  const { token } = req.params;
  const [estimate] = await db.select().from(estimatesTable).where(eq(estimatesTable.publicToken, hashShareToken(token))).limit(1);
  if (!estimate) return res.status(404).json({ error: "NotFound", message: "Estimate not found" });

  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, estimate.customerId)).limit(1);
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, estimate.companyId)).limit(1);
  const lineItems = await db
    .select()
    .from(estimateLineItemsTable)
    .where(eq(estimateLineItemsTable.estimateId, estimate.id))
    .orderBy(estimateLineItemsTable.sortOrder);

  try {
    const pdfBuffer = await buildEstimatePdf({
      estimate: {
        estimateNumber: estimate.estimateNumber,
        status: estimate.status,
        subtotal: estimate.subtotal,
        tax: estimate.tax,
        total: estimate.total,
        validUntil: estimate.validUntil,
        notes: estimate.notes,
        signedAt: estimate.signedAt,
        signerName: estimate.signerName,
        signatureData: estimate.signatureData,
      },
      customer,
      company,
      lineItems: lineItems.map(li => ({
        description: li.description,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        total: li.total,
      })),
    });
    const suffix = estimate.signedAt ? "-signed" : "";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="estimate-${estimate.estimateNumber}${suffix}.pdf"`);
    return res.send(pdfBuffer);
  } catch (err) {
    logger.error({ err, estimateId: estimate.id }, "Failed to generate estimate PDF");
    return res.status(500).json({ error: "PdfError", message: "Could not generate the estimate PDF" });
  }
});

export default router;
