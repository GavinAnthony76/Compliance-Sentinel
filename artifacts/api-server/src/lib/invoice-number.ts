import { db, invoicesTable } from "@workspace/db";
import { sql } from "drizzle-orm";

type InvoiceInsert = typeof invoicesTable.$inferInsert;
type InvoiceRow = typeof invoicesTable.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Arbitrary constant namespace for invoice-number advisory locks. Combined with
// companyId as the second key, it keeps the per-company allocation lock from
// colliding with advisory locks taken anywhere else. Both args are int4.
const INVOICE_LOCK_NAMESPACE = 730119;

/**
 * Compute the next per-company invoice number as `INV-NNNN`.
 *
 * `NULLIF(REGEXP_REPLACE(...), '')::int` tolerates legacy/non-numeric invoice
 * numbers: a value with no digits becomes NULL (ignored by MAX) instead of
 * `CAST('' AS INTEGER)` throwing and breaking all future allocation. Runs
 * against either the pool (`db`) or a transaction handle (`tx`).
 */
async function computeNextNumber(executor: typeof db | Tx, companyId: number): Promise<string> {
  const result: any = await executor.execute(
    sql`SELECT COALESCE(MAX(NULLIF(REGEXP_REPLACE(invoice_number, '[^0-9]', '', 'g'), '')::int), 0) + 1 AS next_num
        FROM invoices
        WHERE company_id = ${companyId}`,
  );
  const rows = Array.isArray(result) ? result : (result?.rows ?? [result]);
  const num = Number(rows[0]?.next_num ?? 1);
  return `INV-${String(num).padStart(4, "0")}`;
}

/** Best-effort read of the next number (no lock) — for previews/UI only. */
export async function nextInvoiceNumber(companyId: number): Promise<string> {
  return computeNextNumber(db, companyId);
}

function isUniqueViolation(err: unknown): boolean {
  // Postgres unique_violation. node-postgres surfaces it as `.code`; drizzle may
  // wrap it, so also inspect nested `cause`/`original`.
  const code =
    (err as any)?.code ?? (err as any)?.cause?.code ?? (err as any)?.original?.code;
  return code === "23505";
}

/**
 * Insert an invoice, allocating its per-company invoice number atomically.
 *
 * Allocation runs inside a transaction that first takes a per-company advisory
 * lock (`pg_advisory_xact_lock`). The lock is held until COMMIT, so concurrent
 * creates for the same company serialize: each reads the latest MAX and inserts
 * before the next is allowed to read. This yields gap-free, collision-free
 * numbers under contention without spinning on retries. The
 * UNIQUE(company_id, invoice_number) constraint remains a final backstop, and a
 * small retry covers the (practically unreachable) case of a backstop trip.
 */
export async function insertInvoiceWithNumber(
  companyId: number,
  values: Omit<InvoiceInsert, "companyId" | "invoiceNumber">,
): Promise<InvoiceRow> {
  const MAX_ATTEMPTS = 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(${INVOICE_LOCK_NAMESPACE}, ${companyId})`,
        );
        const invoiceNumber = await computeNextNumber(tx, companyId);
        const [inv] = await tx
          .insert(invoicesTable)
          .values({ ...values, companyId, invoiceNumber })
          .returning();
        return inv;
      });
    } catch (err) {
      lastErr = err;
      if (isUniqueViolation(err)) continue;
      throw err;
    }
  }
  throw new Error(
    `Could not allocate a unique invoice number for company ${companyId} after ${MAX_ATTEMPTS} attempts`,
    { cause: lastErr },
  );
}
