import { db, invoicesTable, invoiceLineItemsTable, customersTable, companiesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { sendInvoiceEmail, resolveBaseUrl } from "./notifications";
import { logCommunicationEvent } from "./communications";
import { logger } from "./logger";

/**
 * Build and send the branded invoice email with a payable link, mirroring the
 * manual send path. Returns true only when an email was actually dispatched so
 * callers can set invoice status to "sent" based on real delivery attempts.
 */
export async function dispatchInvoiceEmail(invoiceId: number, companyId: number): Promise<boolean> {
  try {
    const [inv] = await db.select().from(invoicesTable).where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.companyId, companyId))).limit(1);
    if (!inv) return false;
    const [customer] = await db.select().from(customersTable).where(and(eq(customersTable.id, inv.customerId), eq(customersTable.companyId, companyId))).limit(1);
    if (!customer?.email) return false;
    const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
    const lineItems = await db.select().from(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, invoiceId)).orderBy(invoiceLineItemsTable.sortOrder);
    const companyName = company?.name || "Your Service Provider";
    const companySlug = company?.slug || "";
    const baseUrl = resolveBaseUrl();
    // The customer portal is available on every plan, but online card payments
    // are a Growth/Pro capability (enforced in the portal pay endpoint). Only
    // surface the "Pay Now" link when the plan can actually accept online card
    // payments; otherwise show the company's manual payment instructions.
    const canAcceptOnlinePayments =
      company?.subscriptionPlan === "growth" || company?.subscriptionPlan === "pro";
    const payNowUrl = canAcceptOnlinePayments && companySlug ? `${baseUrl}/portal/${companySlug}/invoices` : null;
    const paymentInstructions: string[] = [];
    if (company?.paymentInstructions) paymentInstructions.push(company.paymentInstructions);
    if (company?.checkPayableTo) paymentInstructions.push(`Check payable to: ${company.checkPayableTo}`);
    if (company?.zelleInfo) paymentInstructions.push(`Zelle: ${company.zelleInfo}`);
    if (company?.venmoHandle) paymentInstructions.push(`Venmo: ${company.venmoHandle}`);
    if (company?.cashAppTag) paymentInstructions.push(`Cash App: ${company.cashAppTag}`);
    const customerName = `${customer.firstName} ${customer.lastName}`.trim() || customer.email;
    const result = await sendInvoiceEmail({
      customerEmail: customer.email,
      customerName,
      companyName,
      companyEmail: company?.email ?? undefined,
      invoiceNumber: inv.invoiceNumber,
      dueDate: inv.dueDate ? new Date(inv.dueDate) : null,
      lineItems: lineItems.map(li => ({
        description: li.description,
        quantity: Number(li.quantity),
        unitPrice: Number(li.unitPrice),
        lineTotal: Number(li.lineTotal),
      })),
      total: Number(inv.total),
      payNowUrl,
      paymentInstructions,
      logoUrl: company?.logoUrl ?? null,
      primaryColor: company?.primaryColor ?? null,
    });
    // Record the real outcome so the activity feed never claims a send that did
    // not happen, and so callers can trust the boolean to gate invoice status.
    await logCommunicationEvent({
      companyId,
      customerId: inv.customerId,
      invoiceId: inv.id,
      channel: "email",
      subject: `Invoice ${inv.invoiceNumber}`,
      bodyPreview: result.delivered
        ? `Invoice ${inv.invoiceNumber} for $${Number(inv.total).toFixed(2)} sent to ${customerName}`
        : `Invoice ${inv.invoiceNumber} email to ${customerName} was NOT delivered (${result.reason ?? "unknown"})`,
      status: result.delivered ? "sent" : "failed",
    });
    return result.delivered;
  } catch (err) {
    logger.error({ err, invoiceId, companyId }, "Failed to dispatch invoice email");
    return false;
  }
}
