import { invoicesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

/**
 * Build the WHERE conditions for listing/exporting a company's invoices.
 * Shared by GET /invoices and GET /export/invoices so the CSV export always
 * matches exactly what the invoices screen shows for the same query params.
 *
 * Supported params: status, paymentMethod, customerId, from, to.
 *
 * Date-range semantics: paid invoices are bucketed by when the money arrived
 * (paid_at, falling back to created_at); everything else by creation date —
 * keyed on status (not paid_at presence) so a stale paid_at on a reverted
 * invoice can't shift its bucket. `to` is inclusive: a date-only value covers
 * the whole day (exclusive upper bound of the next midnight).
 */
export function buildInvoiceFilterConditions(
  companyId: number,
  query: Record<string, unknown>,
): any[] {
  const conditions: any[] = [eq(invoicesTable.companyId, companyId)];
  if (query.status) conditions.push(eq(invoicesTable.status, query.status as string));
  if (query.paymentMethod) conditions.push(eq(invoicesTable.paymentMethod, query.paymentMethod as string));
  if (query.customerId) conditions.push(eq(invoicesTable.customerId, Number(query.customerId)));

  const effectiveDate = sql`(case when ${invoicesTable.status} = 'paid' then coalesce(${invoicesTable.paidAt}, ${invoicesTable.createdAt}) else ${invoicesTable.createdAt} end)`;
  if (query.from) {
    const from = new Date(String(query.from));
    if (!isNaN(from.getTime())) conditions.push(sql`${effectiveDate} >= ${from.toISOString()}`);
  }
  if (query.to) {
    const raw = String(query.to);
    const to = new Date(raw);
    if (!isNaN(to.getTime())) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        const upper = new Date(to.getTime() + 24 * 60 * 60 * 1000);
        conditions.push(sql`${effectiveDate} < ${upper.toISOString()}`);
      } else {
        conditions.push(sql`${effectiveDate} <= ${to.toISOString()}`);
      }
    }
  }
  return conditions;
}
