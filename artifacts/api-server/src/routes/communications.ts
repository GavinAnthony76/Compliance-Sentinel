import { Router } from "express";
import { z } from "zod";
import { db, communicationEventsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { requireFeature } from "../lib/features";
import { logActivity } from "../lib/activity";
import { logCommunicationEvent } from "../lib/communications";

const CHANNELS = ["email", "sms", "phone", "note", "system"] as const;
const DIRECTIONS = ["outbound", "inbound"] as const;

const router = Router();
router.use(requireAuth);
router.use(requireFeature("communication_timeline"));

// GET /api/communications?customerId= | leadId= — communication timeline
router.get("/", async (req: any, res) => {
  const { companyId } = req.user;
  const customerId = req.query.customerId ? Number(req.query.customerId) : undefined;
  const leadId = req.query.leadId ? Number(req.query.leadId) : undefined;
  const limit = Math.min(Number(req.query.limit) || 100, 200);

  const conditions = [eq(communicationEventsTable.companyId, companyId)];
  if (customerId) conditions.push(eq(communicationEventsTable.customerId, customerId));
  if (leadId) conditions.push(eq(communicationEventsTable.leadId, leadId));

  const events = await db
    .select()
    .from(communicationEventsTable)
    .where(and(...conditions))
    .orderBy(desc(communicationEventsTable.createdAt))
    .limit(limit);

  return res.json({ events });
});

const logBodySchema = z.object({
  customerId: z.number().int().positive().optional().nullable(),
  leadId: z.number().int().positive().optional().nullable(),
  appointmentId: z.number().int().positive().optional().nullable(),
  estimateId: z.number().int().positive().optional().nullable(),
  invoiceId: z.number().int().positive().optional().nullable(),
  channel: z.enum(CHANNELS),
  direction: z.enum(DIRECTIONS).optional(),
  subject: z.string().max(200).optional().nullable(),
  bodyPreview: z.string().max(2000).optional().nullable(),
});

// POST /api/communications — manually log a communication (e.g. phone call, note)
router.post("/", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const parsed = logBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "ValidationError", message: parsed.error.issues[0]?.message ?? "Invalid input" });
  }
  const d = parsed.data;
  if (!d.customerId && !d.leadId) {
    return res.status(400).json({ error: "ValidationError", message: "customerId or leadId is required" });
  }

  await logCommunicationEvent({
    companyId,
    customerId: d.customerId,
    leadId: d.leadId,
    appointmentId: d.appointmentId,
    estimateId: d.estimateId,
    invoiceId: d.invoiceId,
    channel: d.channel,
    direction: d.direction ?? "outbound",
    subject: d.subject,
    bodyPreview: d.bodyPreview,
    status: "logged",
    createdByUserId: userId,
  });

  await logActivity({ companyId, userId, action: "communication.logged", entityType: "communication", metadata: { channel: d.channel, customerId: d.customerId, leadId: d.leadId } });

  return res.status(201).json({ success: true });
});

export default router;
