import { customersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

/**
 * Build the WHERE conditions for listing/exporting a company's customers.
 * Shared by GET /customers and GET /export/customers so the CSV export
 * always matches exactly what the customers screen shows for the same
 * query params.
 *
 * Supported params: search (matches name, email, or phone — same ILIKE
 * semantics as the customers page search box).
 */
export function buildCustomerFilterConditions(
  companyId: number,
  query: Record<string, unknown>,
): any[] {
  const conditions: any[] = [eq(customersTable.companyId, companyId)];
  if (query.search) {
    const term = `%${String(query.search)}%`;
    conditions.push(
      sql`(${customersTable.firstName} || ' ' || ${customersTable.lastName} ilike ${term} OR ${customersTable.email} ilike ${term} OR ${customersTable.phone} ilike ${term})`
    );
  }
  return conditions;
}
