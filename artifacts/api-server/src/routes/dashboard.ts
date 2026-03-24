import { Router } from "express";
import { db, appointmentsTable, customersTable, invoicesTable, recurringPlansTable, reviewRequestsTable } from "@workspace/db";
import { eq, and, gte, lte, sql, desc, ne } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router = Router();
router.use(requireAuth);

router.get("/", async (req: any, res) => {
  const { companyId, userId, role } = req.user;
  const isStaff = role === "staff";
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const [
    todayAppointments,
    upcomingAppointments,
    recentCustomers,
    revenueResult,
    unpaidInvoices,
    recurringJobs,
    totalCustomers,
    pendingReviews,
  ] = await Promise.all([
    db.select().from(appointmentsTable).where(and(
      eq(appointmentsTable.companyId, companyId),
      gte(appointmentsTable.scheduledStart, todayStart),
      lte(appointmentsTable.scheduledStart, todayEnd),
      ...(isStaff ? [eq(appointmentsTable.assignedUserId, userId)] : []),
    )).orderBy(appointmentsTable.scheduledStart).limit(10),

    db.select().from(appointmentsTable).where(and(
      eq(appointmentsTable.companyId, companyId),
      gte(appointmentsTable.scheduledStart, todayEnd),
      lte(appointmentsTable.scheduledStart, nextWeek),
      ne(appointmentsTable.status, "cancelled"),
      ...(isStaff ? [eq(appointmentsTable.assignedUserId, userId)] : []),
    )).orderBy(appointmentsTable.scheduledStart).limit(10),

    db.select().from(customersTable).where(eq(customersTable.companyId, companyId)).orderBy(desc(customersTable.createdAt)).limit(5),

    db.select({ total: sql<number>`COALESCE(SUM(${invoicesTable.total}::numeric), 0)` }).from(invoicesTable).where(and(
      eq(invoicesTable.companyId, companyId),
      eq(invoicesTable.status, "paid"),
      gte(invoicesTable.paidAt, monthStart),
    )),

    db.select({ count: sql<number>`count(*)`, total: sql<number>`COALESCE(SUM(${invoicesTable.total}::numeric), 0)` }).from(invoicesTable).where(and(
      eq(invoicesTable.companyId, companyId),
      sql`${invoicesTable.status} IN ('sent', 'overdue')`,
    )),

    db.select({ count: sql<number>`count(*)` }).from(recurringPlansTable).where(and(
      eq(recurringPlansTable.companyId, companyId),
      eq(recurringPlansTable.isActive, true),
    )),

    db.select({ count: sql<number>`count(*)` }).from(customersTable).where(eq(customersTable.companyId, companyId)),

    db.select({ count: sql<number>`count(*)` }).from(reviewRequestsTable).where(and(
      eq(reviewRequestsTable.companyId, companyId),
      eq(reviewRequestsTable.status, "sent"),
    )),
  ]);

  return res.json({
    todayAppointments,
    upcomingAppointments,
    recentCustomers,
    revenueThisMonth: Number(revenueResult[0].total),
    unpaidInvoicesCount: Number(unpaidInvoices[0].count),
    unpaidInvoicesTotal: Number(unpaidInvoices[0].total),
    recurringJobsCount: Number(recurringJobs[0].count),
    totalCustomers: Number(totalCustomers[0].count),
    pendingReviewRequests: Number(pendingReviews[0].count),
  });
});

export default router;
