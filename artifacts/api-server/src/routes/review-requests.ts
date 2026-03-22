import { Router } from "express";
import { db, reviewRequestsTable, customersTable, companiesTable } from "@workspace/db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { requireFeature } from "../lib/features";
import { logActivity } from "../lib/activity";
import { sendReviewRequestNotification } from "../lib/notifications";

const router = Router();
router.use(requireAuth);
router.use(requireFeature("review_requests"));

router.get("/", async (req: any, res) => {
  const { companyId } = req.user;
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const offset = (page - 1) * limit;

  const [requests, total] = await Promise.all([
    db.select().from(reviewRequestsTable).where(eq(reviewRequestsTable.companyId, companyId)).orderBy(desc(reviewRequestsTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(reviewRequestsTable).where(eq(reviewRequestsTable.companyId, companyId)),
  ]);

  const customerIds = [...new Set(requests.map(r => r.customerId))];
  const customers = customerIds.length > 0 ? await db.select().from(customersTable).where(inArray(customersTable.id, customerIds)) : [];
  const customerMap = Object.fromEntries(customers.map(c => [c.id, `${c.firstName} ${c.lastName}`]));

  return res.json({ reviewRequests: requests.map(r => ({ ...r, customerName: customerMap[r.customerId] ?? null })), total: Number(total[0].count), page, limit });
});

router.post("/", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const { customerId, appointmentId, channel } = req.body;

  const [customer] = await db.select().from(customersTable).where(and(eq(customersTable.id, customerId), eq(customersTable.companyId, companyId))).limit(1);
  if (!customer) return res.status(404).json({ error: "NotFound", message: "Customer not found" });

  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
  const reviewUrl = company?.reviewUrl || "https://g.page/review";

  const [request] = await db.insert(reviewRequestsTable).values({
    companyId,
    customerId,
    appointmentId: appointmentId ?? null,
    channel,
    status: "sent",
    reviewUrl,
    sentAt: new Date(),
  }).returning();

  await sendReviewRequestNotification({
    customerName: `${customer.firstName} ${customer.lastName}`,
    customerEmail: customer.email ?? undefined,
    customerPhone: customer.phone ?? undefined,
    reviewUrl,
    companyName: company?.name ?? "Lawn Care",
    channel,
  });

  await logActivity({ companyId, userId, action: "review_request.sent", entityType: "review_request", entityId: request.id });
  return res.status(201).json({ ...request, customerName: `${customer.firstName} ${customer.lastName}` });
});

export default router;
