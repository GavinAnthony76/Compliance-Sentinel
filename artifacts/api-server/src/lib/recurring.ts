import { db, recurringPlansTable, appointmentsTable } from "@workspace/db";
import { eq, and, lte, isNotNull } from "drizzle-orm";
import { logger } from "./logger";

// How far ahead we materialize recurring appointments so the customer portal shows
// upcoming visits.
const HORIZON_DAYS = 14;
// Safety cap so a badly-configured plan can't generate an unbounded number of rows.
const MAX_PER_PLAN_PER_RUN = 12;

export function computeNextRun(frequencyType: string, intervalValue: number | null | undefined, from: Date): Date {
  const d = new Date(from);
  switch (frequencyType) {
    case "weekly": d.setDate(d.getDate() + 7); break;
    case "biweekly": d.setDate(d.getDate() + 14); break;
    case "monthly": d.setMonth(d.getMonth() + 1); break;
    case "quarterly": d.setMonth(d.getMonth() + 3); break;
    default:
      // Treat anything else as a custom day interval.
      d.setDate(d.getDate() + (intervalValue && intervalValue > 0 ? intervalValue : 7));
  }
  return d;
}

// Materialize appointments for all due recurring plans (optionally scoped to one
// company), advancing each plan's nextRunAt past the horizon. Returns count created.
export async function generateDueRecurringAppointments(opts?: { companyId?: number }): Promise<number> {
  const now = new Date();
  const horizon = new Date(now.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000);

  const conditions: any[] = [
    eq(recurringPlansTable.isActive, true),
    isNotNull(recurringPlansTable.nextRunAt),
    lte(recurringPlansTable.nextRunAt, horizon),
  ];
  if (opts?.companyId) conditions.push(eq(recurringPlansTable.companyId, opts.companyId));

  const plans = await db.select().from(recurringPlansTable).where(and(...conditions));
  let created = 0;

  for (const plan of plans) {
    let next = plan.nextRunAt!;
    let guard = 0;
    while (next <= horizon && guard < MAX_PER_PLAN_PER_RUN) {
      // Avoid duplicating an appointment already created for this exact slot.
      const existing = await db.select({ id: appointmentsTable.id }).from(appointmentsTable)
        .where(and(
          eq(appointmentsTable.companyId, plan.companyId),
          eq(appointmentsTable.customerId, plan.customerId),
          eq(appointmentsTable.scheduledStart, next),
        )).limit(1);
      if (existing.length === 0) {
        await db.insert(appointmentsTable).values({
          companyId: plan.companyId,
          customerId: plan.customerId,
          propertyId: plan.propertyId ?? null,
          serviceId: plan.serviceId ?? null,
          status: "pending",
          scheduledStart: next,
          price: plan.price != null ? String(plan.price) : null,
          notes: "Auto-generated from recurring plan",
        });
        created++;
      }
      next = computeNextRun(plan.frequencyType, plan.intervalValue, next);
      guard++;
    }
    await db.update(recurringPlansTable).set({ nextRunAt: next, updatedAt: new Date() }).where(eq(recurringPlansTable.id, plan.id));
  }

  if (created > 0) logger.info({ created }, "Generated recurring appointments");
  return created;
}
