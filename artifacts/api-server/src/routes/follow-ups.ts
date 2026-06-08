import { Router } from "express";
import { z } from "zod";
import { db, followUpCampaignsTable, followUpLogsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { requireFeature } from "../lib/features";
import { logActivity } from "../lib/activity";
import { FOLLOW_UP_TRIGGERS, sendTestFollowUp } from "../lib/follow-ups";

const CHANNELS = ["email", "sms"] as const;

const router = Router();
router.use(requireAuth);
router.use(requireFeature("follow_ups"));

const campaignSchema = z.object({
  name: z.string().min(1).max(150),
  triggerType: z.enum(FOLLOW_UP_TRIGGERS),
  delayHours: z.number().int().min(0).max(8760).default(0),
  channel: z.enum(CHANNELS).default("email"),
  subject: z.string().max(200).optional().nullable(),
  messageTemplate: z.string().min(1).max(5000),
  isActive: z.boolean().optional(),
});

router.get("/", async (req: any, res) => {
  const { companyId } = req.user;
  const campaigns = await db.select().from(followUpCampaignsTable)
    .where(eq(followUpCampaignsTable.companyId, companyId))
    .orderBy(desc(followUpCampaignsTable.createdAt));
  return res.json({ campaigns });
});

router.post("/", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const parsed = campaignSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "ValidationError", message: parsed.error.issues[0]?.message ?? "Invalid input" });
  }
  if (parsed.data.channel === "email" && !parsed.data.subject) {
    return res.status(400).json({ error: "ValidationError", message: "Email campaigns require a subject" });
  }
  const [campaign] = await db.insert(followUpCampaignsTable).values({
    companyId,
    name: parsed.data.name,
    triggerType: parsed.data.triggerType,
    delayHours: parsed.data.delayHours,
    channel: parsed.data.channel,
    subject: parsed.data.subject ?? null,
    messageTemplate: parsed.data.messageTemplate,
    isActive: parsed.data.isActive ?? false,
  }).returning();
  await logActivity({ companyId, userId, action: "follow_up_campaign.created", entityType: "follow_up_campaign", entityId: campaign.id });
  return res.status(201).json(campaign);
});

router.put("/:id", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(followUpCampaignsTable)
    .where(and(eq(followUpCampaignsTable.id, id), eq(followUpCampaignsTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });
  const parsed = campaignSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "ValidationError", message: parsed.error.issues[0]?.message ?? "Invalid input" });
  }
  const [updated] = await db.update(followUpCampaignsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(followUpCampaignsTable.id, id), eq(followUpCampaignsTable.companyId, companyId)))
    .returning();
  await logActivity({ companyId, userId, action: "follow_up_campaign.updated", entityType: "follow_up_campaign", entityId: id });
  return res.json(updated);
});

router.post("/:id/toggle", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(followUpCampaignsTable)
    .where(and(eq(followUpCampaignsTable.id, id), eq(followUpCampaignsTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });
  const [updated] = await db.update(followUpCampaignsTable)
    .set({ isActive: !existing.isActive, updatedAt: new Date() })
    .where(and(eq(followUpCampaignsTable.id, id), eq(followUpCampaignsTable.companyId, companyId)))
    .returning();
  await logActivity({ companyId, userId, action: "follow_up_campaign.toggled", entityType: "follow_up_campaign", entityId: id, metadata: { isActive: updated.isActive } });
  return res.json(updated);
});

const testSchema = z.object({
  email: z.string().email().optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  firstName: z.string().max(100).optional().nullable(),
});

router.post("/:id/test", async (req: any, res) => {
  const { companyId } = req.user;
  const id = Number(req.params.id);
  const [campaign] = await db.select().from(followUpCampaignsTable)
    .where(and(eq(followUpCampaignsTable.id, id), eq(followUpCampaignsTable.companyId, companyId))).limit(1);
  if (!campaign) return res.status(404).json({ error: "NotFound" });
  const parsed = testSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "ValidationError", message: parsed.error.issues[0]?.message ?? "Invalid input" });
  }
  const result = await sendTestFollowUp(campaign, parsed.data);
  if (!result.ok) return res.status(400).json({ error: "SendFailed", message: result.error });
  return res.json({ success: true });
});

router.get("/:id/logs", async (req: any, res) => {
  const { companyId } = req.user;
  const id = Number(req.params.id);
  const [campaign] = await db.select().from(followUpCampaignsTable)
    .where(and(eq(followUpCampaignsTable.id, id), eq(followUpCampaignsTable.companyId, companyId))).limit(1);
  if (!campaign) return res.status(404).json({ error: "NotFound" });
  const logs = await db.select().from(followUpLogsTable)
    .where(and(eq(followUpLogsTable.campaignId, id), eq(followUpLogsTable.companyId, companyId)))
    .orderBy(desc(followUpLogsTable.createdAt))
    .limit(200);
  return res.json({ logs });
});

router.delete("/:id", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(followUpCampaignsTable)
    .where(and(eq(followUpCampaignsTable.id, id), eq(followUpCampaignsTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });
  await db.delete(followUpCampaignsTable).where(and(eq(followUpCampaignsTable.id, id), eq(followUpCampaignsTable.companyId, companyId)));
  await logActivity({ companyId, userId, action: "follow_up_campaign.deleted", entityType: "follow_up_campaign", entityId: id });
  return res.json({ success: true });
});

export default router;
