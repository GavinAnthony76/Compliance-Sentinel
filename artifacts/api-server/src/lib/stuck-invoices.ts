/**
 * Stuck-invoice sweep.
 *
 * The autopay charge handler (routes/autopay.ts) briefly flips an invoice to a
 * transient "processing" status while it talks to Stripe, then reverts it on any
 * non-success. If the server crashes or is restarted at exactly that moment, the
 * in-memory revert never runs and the invoice is left stuck in "processing"
 * forever — its owner can never charge it again and it won't show as paid.
 *
 * This sweep finds invoices that have been "processing" longer than a safe
 * window and releases them. It reconciles with Stripe FIRST: if a charge for the
 * invoice actually succeeded before the interruption, it records the invoice as
 * paid (and fires the receipt/owner notifications) rather than wrongly reopening
 * it. Only when no successful charge is found does it revert the invoice to an
 * unpaid state so it can be charged again.
 */
import { db, invoicesTable } from "@workspace/db";
import { and, eq, lt } from "drizzle-orm";
import { logger } from "./logger";
import { logActivity } from "./activity";
import { dispatchPaymentReceiptEmail, dispatchOwnerPaymentNotification } from "./notifications";

// Only release invoices that have been "processing" for longer than this. A
// single charge round-trip to Stripe completes in seconds, so anything stuck
// for minutes is the result of an interruption, not an in-flight charge.
const STUCK_THRESHOLD_MS = 5 * 60 * 1000;

// The invoice schema has no column recording the status held before the charge
// claim, so reconstruct a sensible unpaid state: overdue if past its due date,
// otherwise sent. (Autopay charges are only ever initiated against unpaid,
// already-sent invoices.)
function revertStatusFor(invoice: typeof invoicesTable.$inferSelect): "sent" | "overdue" {
  if (invoice.dueDate && new Date(invoice.dueDate).getTime() < Date.now()) return "overdue";
  return "sent";
}

export async function releaseStuckProcessingInvoices(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);
    const stuck = await db.select().from(invoicesTable)
      .where(and(eq(invoicesTable.status, "processing"), lt(invoicesTable.updatedAt, cutoff)));
    if (stuck.length === 0) return;

    // Reconciliation REQUIRES Stripe. We must never release an invoice without
    // first confirming no charge actually succeeded, or we risk reopening (and
    // re-charging) an invoice that was already paid. If billing is unavailable,
    // defer the entire sweep to the next pass rather than reopen blindly.
    let stripe: any;
    try {
      const { getUncachableStripeClient } = await import("./stripe");
      stripe = await getUncachableStripeClient();
    } catch (err) {
      logger.warn({ err }, "Stuck-invoice sweep: Stripe unavailable; deferring release (cannot reconcile)");
      return;
    }

    for (const invoice of stuck) {
      try {
        // 1. Reconcile with the card processor first.
        let succeededIntent: { id: string } | null = null;
        try {
          const search = await stripe.paymentIntents.search({
            query: `metadata['invoiceId']:'${invoice.id}'`,
            limit: 20,
          });
          succeededIntent = (search.data || []).find((pi: any) => pi.status === "succeeded") ?? null;
        } catch (err) {
          // Stripe search is eventually consistent and can transiently fail.
          // Skip this invoice this pass rather than risk reopening a paid one.
          logger.warn({ err, invoiceId: invoice.id }, "Stuck-invoice reconcile: Stripe search failed; deferring");
          continue;
        }

        if (succeededIntent) {
          // The charge actually went through. Record it as paid, guarded so we
          // only act on the row we still own (status === processing).
          const transitioned = await db.update(invoicesTable).set({
            status: "paid",
            paidAt: new Date(),
            paymentMethod: "card",
            stripePaymentIntentId: succeededIntent.id,
            updatedAt: new Date(),
          }).where(and(eq(invoicesTable.id, invoice.id), eq(invoicesTable.status, "processing")))
            .returning({ id: invoicesTable.id });

          if (transitioned.length > 0) {
            await logActivity({ companyId: invoice.companyId, action: "invoice.autopay_reconciled_paid", entityType: "invoice", entityId: invoice.id });
            dispatchPaymentReceiptEmail(invoice.id, invoice.companyId);
            dispatchOwnerPaymentNotification(invoice.id, invoice.companyId);
            logger.info({ invoiceId: invoice.id, paymentIntentId: succeededIntent.id }, "Stuck invoice reconciled as paid");
          }
          continue;
        }

        // 2. No successful charge — release back to an unpaid, chargeable state.
        const next = revertStatusFor(invoice);
        const released = await db.update(invoicesTable).set({ status: next, updatedAt: new Date() })
          .where(and(eq(invoicesTable.id, invoice.id), eq(invoicesTable.status, "processing")))
          .returning({ id: invoicesTable.id });

        if (released.length > 0) {
          await logActivity({ companyId: invoice.companyId, action: "invoice.processing_released", entityType: "invoice", entityId: invoice.id, metadata: { releasedTo: next } });
          logger.info({ invoiceId: invoice.id, releasedTo: next }, "Released stuck processing invoice");
        }
      } catch (err) {
        logger.warn({ err, invoiceId: invoice.id }, "Failed to release stuck processing invoice");
      }
    }
  } catch (err) {
    logger.warn({ err }, "Stuck-invoice sweep failed");
  }
}
