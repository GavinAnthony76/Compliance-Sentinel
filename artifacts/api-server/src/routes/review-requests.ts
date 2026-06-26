import { Router } from "express";
import { db, reviewRequestsTable, customersTable, companiesTable } from "@workspace/db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { requireActiveSubscription } from "../lib/subscription";
import { requireFeature } from "../lib/features";
import { logActivity } from "../lib/activity";
import { logCommunicationEvent } from "../lib/communications";
import { sendReviewRequestNotification } from "../lib/notifications";

const router = Router();
router.use(requireAuth);
router.use(requireActiveSubscription);
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
  // Default to the in-app GreenSynk review page unless the company configured an
  // external review URL (e.g. Google). The in-app page is /review/:slug.
  const baseUrl = process.env.APP_BASE_URL || `https://${process.env.REPLIT_DOMAINS?.split(",")[0]}` || "http://localhost:3000";
  const reviewUrl = company?.reviewUrl || `${baseUrl}/review/${company?.slug}`;

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
    companyEmail: company?.email ?? undefined,
    channel,
    consent: { customerId: customer.id, companyId },
    logoUrl: company?.logoUrl ?? null,
    primaryColor: company?.primaryColor ?? null,
  });

  await logCommunicationEvent({
    companyId,
    customerId,
    appointmentId: appointmentId ?? null,
    channel: channel === "sms" ? "sms" : "email",
    subject: "Review request",
    bodyPreview: `Review request sent to ${customer.firstName} ${customer.lastName}`,
    status: "sent",
    createdByUserId: userId,
  });

  await logActivity({ companyId, userId, action: "review_request.sent", entityType: "review_request", entityId: request.id });
  return res.status(201).json({ ...request, customerName: `${customer.firstName} ${customer.lastName}` });
});

export default router;
