import { db, invoicesTable, invoiceLineItemsTable, customersTable, companiesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { sendInvoiceEmail, resolveBaseUrl } from "./notifications";
import { hasFeature } from "./features";
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
    // Online payment + the customer portal are Growth/Pro features. On Starter the
    // portal login is a dead end for customers, so only surface "Pay Now" when the
    // plan includes the portal; otherwise show the company's manual payment instructions.
    const hasPortal = hasFeature(company?.subscriptionPlan, "customer_portal");
    const payNowUrl = hasPortal && companySlug ? `${baseUrl}/portal/${companySlug}/invoices` : null;
    const paymentInstructions: string[] = [];
    if (company?.paymentInstructions) paymentInstructions.push(company.paymentInstructions);
    if (company?.checkPayableTo) paymentInstructions.push(`Check payable to: ${company.checkPayableTo}`);
    if (company?.zelleInfo) paymentInstructions.push(`Zelle: ${company.zelleInfo}`);
    if (company?.venmoHandle) paymentInstructions.push(`Venmo: ${company.venmoHandle}`);
    if (company?.cashAppTag) paymentInstructions.push(`Cash App: ${company.cashAppTag}`);
    const customerName = `${customer.firstName} ${customer.lastName}`.trim() || customer.email;
    await sendInvoiceEmail({
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
    await logCommunicationEvent({
      companyId,
      customerId: inv.customerId,
      invoiceId: inv.id,
      channel: "email",
      subject: `Invoice ${inv.invoiceNumber}`,
      bodyPreview: `Invoice ${inv.invoiceNumber} for $${Number(inv.total).toFixed(2)} sent to ${customerName}`,
      status: "sent",
    });
    return true;
  } catch (err) {
    logger.error({ err, invoiceId, companyId }, "Failed to dispatch invoice email");
    return false;
  }
}
