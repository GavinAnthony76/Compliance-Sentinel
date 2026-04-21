import { Router } from "express";
import { z } from "zod";
import { db, automationRulesTable, appointmentsTable, invoicesTable, customersTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { requireFeature } from "../lib/features";
import { logActivity } from "../lib/activity";
import { executeActionDryRun } from "../lib/automations";

const router = Router();
router.use(requireAuth);
router.use(requireFeature("automations"));

const createAutomationSchema = z.object({
  name: z.string().min(1).max(255),
  triggerType: z.string().min(1).max(100),
  actionType: z.string().min(1).max(100),
  configJson: z.record(z.unknown()).optional().nullable(),
  isActive: z.boolean().optional(),
});

const updateAutomationSchema = createAutomationSchema.partial();

router.get("/", async (req: any, res) => {
  const { companyId } = req.user;
  const automations = await db.select().from(automationRulesTable).where(eq(automationRulesTable.companyId, companyId)).orderBy(desc(automationRulesTable.createdAt));
  return res.json({ automations });
});

router.post("/", async (req: any, res) => {
  const parsed = createAutomationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "ValidationError", message: parsed.error.message });
  }
  const { companyId, userId } = req.user;
  const [automation] = await db.insert(automationRulesTable).values({
    companyId,
    name: parsed.data.name,
    triggerType: parsed.data.triggerType,
    actionType: parsed.data.actionType,
    configJson: parsed.data.configJson ?? null,
    isActive: parsed.data.isActive ?? true,
  }).returning();
  await logActivity({ companyId, userId, action: "automation.created", entityType: "automation", entityId: automation.id });
  return res.status(201).json(automation);
});

router.put("/:id", async (req: any, res) => {
  const parsed = updateAutomationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "ValidationError", message: parsed.error.message });
  }
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(automationRulesTable).where(and(eq(automationRulesTable.id, id), eq(automationRulesTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });
  const [updated] = await db.update(automationRulesTable).set({ ...parsed.data, updatedAt: new Date() }).where(and(eq(automationRulesTable.id, id), eq(automationRulesTable.companyId, companyId))).returning();
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

// POST /automations/:id/test — real dry-run: evaluates rule against most recent entity,
// executes all logic (data loading, condition checks, message composition) but skips sends.
router.post("/:id/test", async (req: any, res) => {
  const { companyId } = req.user;
  const id = Number(req.params.id);
  const [rule] = await db.select().from(automationRulesTable).where(and(eq(automationRulesTable.id, id), eq(automationRulesTable.companyId, companyId))).limit(1);
  if (!rule) return res.status(404).json({ error: "NotFound" });

  // Build an AutomationContext from the most recent entity matching the trigger type
  let ctx: { customerId: number; appointmentId?: number; appointmentPrice?: number; appointmentServiceId?: number } | null = null;
  let entityLabel = "";

  try {
    if (rule.triggerType === "appointment_completed" || rule.triggerType === "appointment_upcoming_24h") {
      const [appt] = await db.select().from(appointmentsTable)
        .where(eq(appointmentsTable.companyId, companyId))
        .orderBy(desc(appointmentsTable.createdAt))
        .limit(1);
      if (appt) {
        ctx = {
          customerId: appt.customerId,
          appointmentId: appt.id,
          appointmentPrice: appt.price ? Number(appt.price) : undefined,
          appointmentServiceId: (appt as any).serviceId ?? undefined,
        };
        entityLabel = `appointment #${appt.id}`;
      }
    } else if (rule.triggerType === "invoice_sent" || rule.triggerType === "invoice_overdue") {
      const [inv] = await db.select().from(invoicesTable)
        .where(eq(invoicesTable.companyId, companyId))
        .orderBy(desc(invoicesTable.createdAt))
        .limit(1);
      if (inv) {
        ctx = { customerId: inv.customerId };
        entityLabel = `invoice ${inv.invoiceNumber}`;
      }
    } else if (rule.triggerType === "customer_created") {
      const [cust] = await db.select().from(customersTable)
        .where(eq(customersTable.companyId, companyId))
        .orderBy(desc(customersTable.createdAt))
        .limit(1);
      if (cust) {
        ctx = { customerId: cust.id };
        entityLabel = `customer ${cust.firstName || cust.phone}`;
      }
    }
  } catch {
    return res.status(500).json({ error: "Failed to load entity context" });
  }

  if (!ctx) {
    return res.json({
      success: true,
      eligible: false,
      entityLabel: null,
      wouldHave: `[DRY RUN] No ${rule.triggerType.replace(/_/g, " ")} entity found to test against.`,
      outcome: "No entity available",
      details: {},
    });
  }

  try {
    const result = await executeActionDryRun(rule, companyId, ctx);
    return res.json({
      success: true,
      eligible: result.eligible,
      entityLabel,
      wouldHave: `[DRY RUN] "${rule.name}" tested against ${entityLabel}: ${result.outcome}. No actual message was sent.`,
      outcome: result.outcome,
      details: result.details,
    });
  } catch (err: any) {
    return res.status(500).json({ error: "DryRunFailed", message: err?.message });
  }
});

export default router;
