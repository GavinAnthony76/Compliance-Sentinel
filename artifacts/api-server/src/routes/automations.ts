import { Router } from "express";
import { db, automationRulesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { requireFeature } from "../lib/features";
import { logActivity } from "../lib/activity";

const router = Router();
router.use(requireAuth);
router.use(requireFeature("automations"));

router.get("/", async (req: any, res) => {
  const { companyId } = req.user;
  const automations = await db.select().from(automationRulesTable).where(eq(automationRulesTable.companyId, companyId)).orderBy(desc(automationRulesTable.createdAt));
  return res.json({ automations });
});

router.post("/", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const [automation] = await db.insert(automationRulesTable).values({
    companyId,
    name: req.body.name,
    triggerType: req.body.triggerType,
    actionType: req.body.actionType,
    configJson: req.body.configJson ?? null,
    isActive: req.body.isActive ?? true,
  }).returning();
  await logActivity({ companyId, userId, action: "automation.created", entityType: "automation", entityId: automation.id });
  return res.status(201).json(automation);
});

router.put("/:id", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(automationRulesTable).where(and(eq(automationRulesTable.id, id), eq(automationRulesTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });
  const [updated] = await db.update(automationRulesTable).set({ ...req.body, updatedAt: new Date() }).where(and(eq(automationRulesTable.id, id), eq(automationRulesTable.companyId, companyId))).returning();
  await logActivity({ companyId, userId, action: "automation.updated", entityType: "automation", entityId: id });
  return res.json(updated);
});

router.delete("/:id", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(automationRulesTable).where(and(eq(automationRulesTable.id, id), eq(automationRulesTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });
  await db.delete(automationRulesTable).where(and(eq(automationRulesTable.id, id), eq(automationRulesTable.companyId, companyId)));
  await logActivity({ companyId, userId, action: "automation.deleted", entityType: "automation", entityId: id });
  return res.json({ success: true });
});

router.post("/:id/toggle", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(automationRulesTable).where(and(eq(automationRulesTable.id, id), eq(automationRulesTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });
  const [updated] = await db.update(automationRulesTable).set({ isActive: !existing.isActive, updatedAt: new Date() }).where(and(eq(automationRulesTable.id, id), eq(automationRulesTable.companyId, companyId))).returning();
  return res.json(updated);
});

export default router;
