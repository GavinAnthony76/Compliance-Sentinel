import { db, activityLogsTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * Card-payment verification and reconciliation flagging shared by the paid
 * paths (portal Checkout webhook / confirm fallback, autopay).
 *
 * A payment that cannot be applied to its invoice — wrong amount, currency,
 * company or invoice, or a second successful payment for an invoice that is
 * already paid — is NEVER silently dropped and NEVER refunded automatically:
 * it is recorded durably in the company's activity log (action
 * "invoice.payment_flagged") and logged as an error for manual reconciliation.
 */

export const PAYMENT_FLAGGED_ACTION = "invoice.payment_flagged";

export type PaymentFlagReason =
  | "amount_mismatch"
  | "currency_mismatch"
  | "company_mismatch"
  | "invoice_mismatch"
  | "invoice_not_found"
  | "additional_payment";

export interface InvoiceForVerification {
  id: number;
  companyId: number;
  total: string | number;
}

/** Invoice total in the smallest currency unit, as charged everywhere else. */
export function invoiceAmountCents(invoice: { total: string | number }): number {
  return Math.round(Number(invoice.total) * 100);
}

/**
 * Check a paid Checkout session against the invoice it claims to pay. Returns
 * the first mismatch, or null when the session pays exactly this invoice.
 */
export function checkoutSessionMismatch(
  invoice: InvoiceForVerification | undefined,
  session: { amount_total?: number | null; currency?: string | null; metadata?: Record<string, string> | null },
  expected: { invoiceId: number; companyId: number },
): PaymentFlagReason | null {
  if (!invoice) return "invoice_not_found";
  if (invoice.id !== expected.invoiceId || Number(session.metadata?.invoiceId) !== invoice.id) return "invoice_mismatch";
  if (invoice.companyId !== expected.companyId || Number(session.metadata?.companyId) !== invoice.companyId) return "company_mismatch";
  if (String(session.currency ?? "").toLowerCase() !== "usd") return "currency_mismatch";
  if (session.amount_total !== invoiceAmountCents(invoice)) return "amount_mismatch";
  return null;
}

export async function flagPaymentForReconciliation(opts: {
  companyId: number;
  invoiceId: number;
  reason: PaymentFlagReason;
  source: "portal_webhook" | "portal_confirm" | "autopay";
  paymentIntentId?: string | null;
  checkoutSessionId?: string | null;
  amountCents?: number | null;
  currency?: string | null;
  recordedPaymentIntentId?: string | null;
}): Promise<void> {
  const { companyId, invoiceId, ...metadata } = opts;
  logger.error({ companyId, invoiceId, ...metadata }, "Card payment flagged for manual reconciliation");
  // Written directly (not via the best-effort logActivity, which swallows
  // errors): if this record cannot be persisted the caller must fail so the
  // event is retried rather than acknowledged with no trace of the payment.
  await db.insert(activityLogsTable).values({
    companyId,
    action: PAYMENT_FLAGGED_ACTION,
    entityType: "invoice",
    entityId: invoiceId,
    metadataJson: metadata,
  });
}
