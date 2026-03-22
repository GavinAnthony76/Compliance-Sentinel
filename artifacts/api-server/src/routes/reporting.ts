import { Router } from "express";
import { db, appointmentsTable, invoicesTable, customersTable, recurringPlansTable } from "@workspace/db";
import { eq, sql, and, gte, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { requireFeature } from "../lib/features";

const router = Router();
router.use(requireAuth);
router.use(requireFeature("reporting"));

router.get("/", async (req: any, res) => {
  const { companyId } = req.user;
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [
    totalRevenue,
    monthRevenue,
    totalAppts,
    completedAppts,
    totalCustomers,
    activeRecurring,
    pendingInvoicesAmt,
    monthlyAppts,
    revenueByMonth,
    topServices,
    recentPaidInvoices,
  ] = await Promise.all([
    db.select({ total: sql<string>`COALESCE(SUM(${invoicesTable.total}::numeric), 0)` })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.companyId, companyId), eq(invoicesTable.status, "paid"))),

    db.select({ total: sql<string>`COALESCE(SUM(${invoicesTable.total}::numeric), 0)` })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.companyId, companyId), eq(invoicesTable.status, "paid"), gte(invoicesTable.paidAt, monthStart))),

    db.select({ count: sql<number>`count(*)` })
      .from(appointmentsTable)
      .where(eq(appointmentsTable.companyId, companyId)),

    db.select({ count: sql<number>`count(*)` })
      .from(appointmentsTable)
      .where(and(eq(appointmentsTable.companyId, companyId), eq(appointmentsTable.status, "completed"))),

    db.select({ count: sql<number>`count(*)` })
      .from(customersTable)
      .where(eq(customersTable.companyId, companyId)),

    db.select({ count: sql<number>`count(*)` })
      .from(recurringPlansTable)
      .where(and(eq(recurringPlansTable.companyId, companyId), eq(recurringPlansTable.isActive, true))),

    db.select({ total: sql<string>`COALESCE(SUM(${invoicesTable.total}::numeric), 0)`, count: sql<number>`count(*)` })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.companyId, companyId), sql`${invoicesTable.status} IN ('sent','overdue')`)),

    db.select({
      month: sql<string>`to_char(${appointmentsTable.scheduledStart}, 'YYYY-MM')`,
      total: sql<number>`count(*)`,
      completed: sql<number>`count(*) filter (where ${appointmentsTable.status} = 'completed')`,
    })
      .from(appointmentsTable)
      .where(and(eq(appointmentsTable.companyId, companyId), gte(appointmentsTable.scheduledStart, sixMonthsAgo)))
      .groupBy(sql`to_char(${appointmentsTable.scheduledStart}, 'YYYY-MM')`)
      .orderBy(sql`to_char(${appointmentsTable.scheduledStart}, 'YYYY-MM')`),

    db.select({
      month: sql<string>`to_char(${invoicesTable.paidAt}, 'YYYY-MM')`,
      revenue: sql<string>`COALESCE(SUM(${invoicesTable.total}::numeric), 0)`,
    })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.companyId, companyId), eq(invoicesTable.status, "paid"), gte(invoicesTable.paidAt, sixMonthsAgo)))
      .groupBy(sql`to_char(${invoicesTable.paidAt}, 'YYYY-MM')`)
      .orderBy(sql`to_char(${invoicesTable.paidAt}, 'YYYY-MM')`),

    db.select({
      serviceId: appointmentsTable.serviceId,
      count: sql<number>`count(*)`,
    })
      .from(appointmentsTable)
      .where(and(eq(appointmentsTable.companyId, companyId), eq(appointmentsTable.status, "completed")))
      .groupBy(appointmentsTable.serviceId)
      .orderBy(desc(sql`count(*)`))
      .limit(5),

    db.select()
      .from(invoicesTable)
      .where(and(eq(invoicesTable.companyId, companyId), eq(invoicesTable.status, "paid")))
      .orderBy(desc(invoicesTable.paidAt))
      .limit(5),
  ]);

  const totalApptsNum = Number(totalAppts[0]?.count ?? 0);
  const completedApptsNum = Number(completedAppts[0]?.count ?? 0);

  return res.json({
    summary: {
      totalRevenue: Number(totalRevenue[0]?.total ?? 0),
      revenueThisMonth: Number(monthRevenue[0]?.total ?? 0),
      totalAppointments: totalApptsNum,
      completedAppointments: completedApptsNum,
      completionRate: totalApptsNum > 0 ? Math.round((completedApptsNum / totalApptsNum) * 100) : 0,
      totalCustomers: Number(totalCustomers[0]?.count ?? 0),
      activeRecurringPlans: Number(activeRecurring[0]?.count ?? 0),
      pendingInvoiceAmount: Number(pendingInvoicesAmt[0]?.total ?? 0),
      pendingInvoiceCount: Number(pendingInvoicesAmt[0]?.count ?? 0),
    },
    monthlyAppointments: monthlyAppts,
    monthlyRevenue: revenueByMonth.map(r => ({ month: r.month, revenue: Number(r.revenue) })),
    recentPaidInvoices,
  });
});

export default router;
