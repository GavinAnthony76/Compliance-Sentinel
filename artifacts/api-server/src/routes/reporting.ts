import { Router } from "express";
import { db, appointmentsTable, invoicesTable, customersTable, recurringPlansTable, servicesTable, usersTable, companiesTable } from "@workspace/db";
import { eq, sql, and, gte, desc } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { requireFeature, hasFeature } from "../lib/features";

import { requireActiveSubscription } from "../lib/subscription";

const router = Router();
router.use(requireAuth);
router.use(requireActiveSubscription);
router.use(requireRole("owner", "admin"));
// Base reporting requires Growth's "growth_analytics"; deeper breakdowns below require Pro's "advanced_analytics"
router.use(requireFeature("growth_analytics"));

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

  // Advanced analytics — Pro plan only
  const [companyRow] = await db.select({ plan: companiesTable.subscriptionPlan })
    .from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
  const isPro = hasFeature(companyRow?.plan, "advanced_analytics");

  let advanced = null;
  if (isPro) {
    const [serviceBreakdown, staffPerformance, topCustomers, invoiceAging] = await Promise.all([
      // Service breakdown: revenue + job count per service
      db.select({
        serviceName: sql<string>`COALESCE(${servicesTable.name}, 'No Service')`,
        jobCount: sql<number>`count(*)::int`,
        revenue: sql<number>`COALESCE(SUM(${appointmentsTable.price}::numeric), 0)`,
      })
        .from(appointmentsTable)
        .leftJoin(servicesTable, eq(appointmentsTable.serviceId, servicesTable.id))
        .where(and(eq(appointmentsTable.companyId, companyId), eq(appointmentsTable.status, "completed")))
        .groupBy(appointmentsTable.serviceId, servicesTable.name)
        .orderBy(desc(sql`count(*)`))
        .limit(8),

      // Staff performance: completed jobs + revenue per team member
      db.select({
        staffName: sql<string>`COALESCE(${usersTable.firstName} || ' ' || ${usersTable.lastName}, 'Unassigned')`,
        jobCount: sql<number>`count(*)::int`,
        revenue: sql<number>`COALESCE(SUM(${appointmentsTable.price}::numeric), 0)`,
      })
        .from(appointmentsTable)
        .leftJoin(usersTable, eq(appointmentsTable.assignedUserId, usersTable.id))
        .where(and(
          eq(appointmentsTable.companyId, companyId),
          eq(appointmentsTable.status, "completed"),
          sql`${appointmentsTable.assignedUserId} IS NOT NULL`,
        ))
        .groupBy(appointmentsTable.assignedUserId, usersTable.firstName, usersTable.lastName)
        .orderBy(desc(sql`count(*)`)),

      // Top 5 customers by lifetime revenue
      db.select({
        customerName: sql<string>`${customersTable.firstName} || ' ' || ${customersTable.lastName}`,
        totalRevenue: sql<number>`COALESCE(SUM(${invoicesTable.total}::numeric), 0)`,
        invoiceCount: sql<number>`count(*)::int`,
      })
        .from(invoicesTable)
        .leftJoin(customersTable, eq(invoicesTable.customerId, customersTable.id))
        .where(and(eq(invoicesTable.companyId, companyId), eq(invoicesTable.status, "paid")))
        .groupBy(invoicesTable.customerId, customersTable.firstName, customersTable.lastName)
        .orderBy(desc(sql`SUM(${invoicesTable.total}::numeric)`))
        .limit(5),

      // Invoice aging buckets (open invoices)
      db.select({
        bucket: sql<string>`CASE
          WHEN NOW() - ${invoicesTable.createdAt} < INTERVAL '30 days' THEN 'current'
          WHEN NOW() - ${invoicesTable.createdAt} < INTERVAL '60 days' THEN '31_60'
          WHEN NOW() - ${invoicesTable.createdAt} < INTERVAL '90 days' THEN '61_90'
          ELSE '90_plus'
        END`,
        count: sql<number>`count(*)::int`,
        total: sql<number>`COALESCE(SUM(${invoicesTable.total}::numeric), 0)`,
      })
        .from(invoicesTable)
        .where(and(
          eq(invoicesTable.companyId, companyId),
          sql`${invoicesTable.status} IN ('sent', 'overdue')`,
        ))
        .groupBy(sql`CASE
          WHEN NOW() - ${invoicesTable.createdAt} < INTERVAL '30 days' THEN 'current'
          WHEN NOW() - ${invoicesTable.createdAt} < INTERVAL '60 days' THEN '31_60'
          WHEN NOW() - ${invoicesTable.createdAt} < INTERVAL '90 days' THEN '61_90'
          ELSE '90_plus'
        END`),
    ]);

    advanced = {
      serviceBreakdown: serviceBreakdown.map(r => ({ ...r, revenue: Number(r.revenue) })),
      staffPerformance: staffPerformance.map(r => ({ ...r, revenue: Number(r.revenue) })),
      topCustomers: topCustomers.map(r => ({ ...r, totalRevenue: Number(r.totalRevenue) })),
      invoiceAging: invoiceAging.map(r => ({ ...r, total: Number(r.total) })),
    };
  }

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
    advanced,
  });
});

export default router;
