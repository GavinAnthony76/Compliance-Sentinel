import { Router } from "express";
import { z } from "zod";
import { db, automationRulesTable, appointmentsTable, invoicesTable, customersTable } from "@workspace/db";
import { eq, and, desc, gte, lte, between } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { requireActiveSubscription } from "../lib/subscription";
import { requireFeature } from "../lib/features";
import { logActivity } from "../lib/activity";
import { executeActionDryRun } from "../lib/automations";

const router = Router();
router.use(requireAuth);
router.use(requireActiveSubscription);
// Generic rule-based automation engine — Pro's "Advanced Automation Engine"
router.use(requireFeature("advanced_automations"));

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
    if (rule.triggerType === "appointment_completed") {
      // Select most recently completed appointment
      const [appt] = await db.select().from(appointmentsTable)
        .where(and(eq(appointmentsTable.companyId, companyId), eq(appointmentsTable.status, "completed")))
        .orderBy(desc(appointmentsTable.updatedAt))
        .limit(1);
      if (appt) {
        ctx = { customerId: appt.customerId, appointmentId: appt.id, appointmentPrice: appt.price ? Number(appt.price) : undefined, appointmentServiceId: appt.serviceId ?? undefined };
        entityLabel = `completed appointment #${appt.id}`;
      }
    } else if (rule.triggerType === "appointment_upcoming_24h") {
      // Prefer appointment in the 24h scheduling window; fall back to nearest upcoming
      const now = new Date();
      const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const candidates = await db.select().from(appointmentsTable)
        .where(and(eq(appointmentsTable.companyId, companyId), gte(appointmentsTable.scheduledStart, now.toISOString())))
        .orderBy(appointmentsTable.scheduledStart)
        .limit(5);
      const inWindow = candidates.find(a => new Date(a.scheduledStart) <= in24h);
      const appt = inWindow ?? candidates[0] ?? null;
      if (appt) {
        const isEligible = new Date(appt.scheduledStart) <= in24h;
        ctx = { customerId: appt.customerId, appointmentId: appt.id, appointmentPrice: appt.price ? Number(appt.price) : undefined, appointmentServiceId: appt.serviceId ?? undefined };
        entityLabel = isEligible ? `upcoming appointment #${appt.id} (within 24h)` : `nearest upcoming appointment #${appt.id} (outside 24h window — dry run only)`;
      }
    } else if (rule.triggerType === "invoice_overdue") {
      // Select most recent overdue invoice
      const [inv] = await db.select().from(invoicesTable)
        .where(and(eq(invoicesTable.companyId, companyId), eq(invoicesTable.status, "overdue")))
        .orderBy(desc(invoicesTable.updatedAt))
        .limit(1);
      if (inv) {
        ctx = { customerId: inv.customerId };
        entityLabel = `overdue invoice ${inv.invoiceNumber}`;
      }
    } else if (rule.triggerType === "invoice_sent") {
      // Select most recently sent invoice
      const [inv] = await db.select().from(invoicesTable)
        .where(and(eq(invoicesTable.companyId, companyId), eq(invoicesTable.status, "sent")))
        .orderBy(desc(invoicesTable.updatedAt))
        .limit(1);
      if (inv) {
        ctx = { customerId: inv.customerId };
        entityLabel = `sent invoice ${inv.invoiceNumber}`;
      }
    } else if (rule.triggerType === "customer_created") {
      // Select newest customer
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
