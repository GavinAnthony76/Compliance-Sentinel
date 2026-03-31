import { Router } from "express";
import { z } from "zod";
import { db, automationRulesTable, appointmentsTable, invoicesTable, customersTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { requireFeature } from "../lib/features";
import { logActivity } from "../lib/activity";

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

// POST /automations/:id/test — dry-run: describe what would happen without actually sending
router.post("/:id/test", async (req: any, res) => {
  const { companyId } = req.user;
  const id = Number(req.params.id);
  const [rule] = await db.select().from(automationRulesTable).where(and(eq(automationRulesTable.id, id), eq(automationRulesTable.companyId, companyId))).limit(1);
  if (!rule) return res.status(404).json({ error: "NotFound" });

  // Find the most recent eligible entity for this trigger
  let entityDescription = "";
  let eligible = false;

  try {
    if (rule.triggerType === "appointment_completed" || rule.triggerType === "appointment_upcoming_24h") {
      const [appt] = await db.select().from(appointmentsTable)
        .where(eq(appointmentsTable.companyId, companyId))
        .orderBy(desc(appointmentsTable.createdAt))
        .limit(1);
      if (appt) {
        const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, appt.customerId)).limit(1);
        entityDescription = `appointment #${appt.id} for ${customer ? (customer.firstName || customer.phone) : "customer"}`;
        eligible = true;
      } else {
        entityDescription = "no appointments found";
      }
    } else if (rule.triggerType === "invoice_sent" || rule.triggerType === "invoice_overdue") {
      const [inv] = await db.select().from(invoicesTable)
        .where(eq(invoicesTable.companyId, companyId))
        .orderBy(desc(invoicesTable.createdAt))
        .limit(1);
      if (inv) {
        entityDescription = `invoice ${inv.invoiceNumber} ($${Number(inv.total).toFixed(2)})`;
        eligible = true;
      } else {
        entityDescription = "no invoices found";
      }
    } else if (rule.triggerType === "customer_created") {
      const [cust] = await db.select().from(customersTable)
        .where(eq(customersTable.companyId, companyId))
        .orderBy(desc(customersTable.createdAt))
        .limit(1);
      if (cust) {
        entityDescription = `customer ${cust.firstName || cust.phone}`;
        eligible = true;
      } else {
        entityDescription = "no customers found";
      }
    }
  } catch {
    entityDescription = "unknown entity";
  }

  const actionDescriptions: Record<string, string> = {
    send_review_request: "would send a review request SMS/email",
    send_follow_up_email: "would send a follow-up thank-you email",
    create_invoice: "would auto-create and send an invoice",
    send_sms_reminder: "would send an SMS reminder",
  };

  const actionDesc = actionDescriptions[rule.actionType] ?? `would execute action: ${rule.actionType}`;
  const wouldHave = eligible
    ? `[DRY RUN] "${rule.name}": For ${entityDescription} — ${actionDesc}. No actual message was sent.`
    : `[DRY RUN] "${rule.name}": ${entityDescription} — nothing to test against.`;

  return res.json({ success: true, wouldHave, eligible });
});

export default router;
