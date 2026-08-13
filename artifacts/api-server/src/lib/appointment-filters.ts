import { appointmentsTable } from "@workspace/db";
import { eq, gte, lte } from "drizzle-orm";

/**
 * Build the WHERE conditions for listing/exporting a company's appointments.
 * Shared by GET /appointments and GET /export/appointments so the CSV export
 * always matches exactly what the appointments screen shows for the same
 * query params.
 *
 * Supported params: status, customerId, assignedUserId, startDate, endDate
 * (dates filter on scheduled_start, same as the list endpoint).
 *
 * Staff users are always restricted to their own assigned appointments,
 * regardless of any assignedUserId param.
 */
export function buildAppointmentFilterConditions(
  user: { companyId: number; userId: number; role: string },
  query: Record<string, unknown>,
): any[] {
  const conditions: any[] = [eq(appointmentsTable.companyId, user.companyId)];
  // Staff only ever see the appointments assigned to them.
  if (user.role === "staff") conditions.push(eq(appointmentsTable.assignedUserId, user.userId));
  if (query.status) conditions.push(eq(appointmentsTable.status, query.status as string));
  if (query.customerId) conditions.push(eq(appointmentsTable.customerId, Number(query.customerId)));
  if (query.assignedUserId && user.role !== "staff") {
    conditions.push(eq(appointmentsTable.assignedUserId, Number(query.assignedUserId)));
  }
  if (query.startDate) {
    const d = new Date(String(query.startDate));
    if (!isNaN(d.getTime())) conditions.push(gte(appointmentsTable.scheduledStart, d));
  }
  if (query.endDate) {
    const d = new Date(String(query.endDate));
    if (!isNaN(d.getTime())) conditions.push(lte(appointmentsTable.scheduledStart, d));
  }
  return conditions;
}
