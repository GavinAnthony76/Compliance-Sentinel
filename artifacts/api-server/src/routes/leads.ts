import { Router } from "express";
import { z } from "zod";
import {
  db,
  leadsTable,
  customersTable,
  estimatesTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { requireFeature } from "../lib/features";
import { logActivity } from "../lib/activity";
import { enqueueFollowUps } from "../lib/follow-ups";

const LEAD_SOURCES = ["public_booking", "manual", "referral", "website", "phone", "other"] as const;
const LEAD_STATUSES = ["new", "contacted", "site_visit_scheduled", "estimate_sent", "won", "lost"] as const;

const leadBodySchema = z.object({
  customerId: z.number().int().positive().optional().nullable(),
  propertyId: z.number().int().positive().optional().nullable(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().max(100).optional().default(""),
  email: z.string().email().max(255).optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  source: z.enum(LEAD_SOURCES).optional().default("manual"),
  status: z.enum(LEAD_STATUSES).optional().default("new"),
  estimatedValue: z.union([z.string(), z.number()]).optional().nullable(),
  assignedUserId: z.number().int().positive().optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  nextFollowUpAt: z.coerce.date().optional().nullable(),
  lostReason: z.string().max(1000).optional().nullable(),
});

function normalizeValue(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  return String(v);
}

const router = Router();
router.use(requireAuth);
router.use(requireFeature("lead_pipeline"));

function isManager(role: string): boolean {
  return role === "owner" || role === "admin";
}

// GET /api/leads — list (staff see only assigned)
router.get("/", async (req: any, res) => {
  const { companyId, userId, role } = req.user;
  const status = req.query.status as string | undefined;

  const conditions = [eq(leadsTable.companyId, companyId)];
  if (!isManager(role)) conditions.push(eq(leadsTable.assignedUserId, userId));
  if (status && (LEAD_STATUSES as readonly string[]).includes(status)) {
    conditions.push(eq(leadsTable.status, status));
  }

  const leads = await db
    .select()
    .from(leadsTable)
    .where(and(...conditions))
    .orderBy(desc(leadsTable.updatedAt));

  return res.json({ leads });
});

// POST /api/leads — create (managers only)
router.post("/", requireRole("owner", "admin"), async (req: any, res) => {
  const parsed = leadBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "ValidationError", message: parsed.error.message });
  }
  const { companyId, userId } = req.user;
  const data = parsed.data;
  const [lead] = await db
    .insert(leadsTable)
    .values({
      companyId,
      customerId: data.customerId ?? null,
      propertyId: data.propertyId ?? null,
      firstName: data.firstName,
      lastName: data.lastName ?? "",
      email: data.email ?? null,
      phone: data.phone ?? null,
      address: data.address ?? null,
      source: data.source,
      status: data.status,
      estimatedValue: normalizeValue(data.estimatedValue),
      assignedUserId: data.assignedUserId ?? null,
      notes: data.notes ?? null,
      nextFollowUpAt: data.nextFollowUpAt ?? null,
      lostReason: data.lostReason ?? null,
    })
    .returning();
  await logActivity({ companyId, userId, action: "lead.created", entityType: "lead", entityId: lead.id });
  await enqueueFollowUps(companyId, "lead_created", { entityType: "lead", entityId: lead.id, leadId: lead.id });
  return res.status(201).json(lead);
});

// GET /api/leads/:id
router.get("/:id", async (req: any, res) => {
  const { companyId, userId, role } = req.user;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ValidationError", message: "Invalid id" });

  const [lead] = await db
    .select()
    .from(leadsTable)
    .where(and(eq(leadsTable.id, id), eq(leadsTable.companyId, companyId)))
    .limit(1);
  if (!lead) return res.status(404).json({ error: "NotFound" });
  if (!isManager(role) && lead.assignedUserId !== userId) {
    return res.status(403).json({ error: "Forbidden", message: "Lead not assigned to you" });
  }
  return res.json(lead);
});

// PUT /api/leads/:id — managers, or assigned staff
router.put("/:id", async (req: any, res) => {
  const parsed = leadBodySchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "ValidationError", message: parsed.error.message });
  }
  const { companyId, userId, role } = req.user;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ValidationError", message: "Invalid id" });

  const [existing] = await db
    .select()
    .from(leadsTable)
    .where(and(eq(leadsTable.id, id), eq(leadsTable.companyId, companyId)))
    .limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });
  if (!isManager(role) && existing.assignedUserId !== userId) {
    return res.status(403).json({ error: "Forbidden", message: "Lead not assigned to you" });
  }

  const data = parsed.data;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of ["customerId", "propertyId", "firstName", "lastName", "email", "phone", "address", "source", "status", "assignedUserId", "notes", "nextFollowUpAt", "lostReason"] as const) {
    if (k in data) updates[k] = (data as any)[k];
  }
  if ("estimatedValue" in data) updates.estimatedValue = normalizeValue(data.estimatedValue);

  const [updated] = await db
    .update(leadsTable)
    .set(updates)
    .where(and(eq(leadsTable.id, id), eq(leadsTable.companyId, companyId)))
    .returning();
  await logActivity({ companyId, userId, action: "lead.updated", entityType: "lead", entityId: id, metadata: { status: updated.status } });
  return res.json(updated);
});

// DELETE /api/leads/:id — managers only
router.delete("/:id", requireRole("owner", "admin"), async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ValidationError", message: "Invalid id" });

  const [existing] = await db
    .select()
    .from(leadsTable)
    .where(and(eq(leadsTable.id, id), eq(leadsTable.companyId, companyId)))
    .limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });

  await db.delete(leadsTable).where(and(eq(leadsTable.id, id), eq(leadsTable.companyId, companyId)));
  await logActivity({ companyId, userId, action: "lead.deleted", entityType: "lead", entityId: id });
  return res.json({ success: true });
});

// POST /api/leads/:id/convert-to-customer — managers only
router.post("/:id/convert-to-customer", requireRole("owner", "admin"), async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ValidationError", message: "Invalid id" });

  const [lead] = await db
    .select()
    .from(leadsTable)
    .where(and(eq(leadsTable.id, id), eq(leadsTable.companyId, companyId)))
    .limit(1);
  if (!lead) return res.status(404).json({ error: "NotFound" });
  if (lead.customerId) {
    return res.status(409).json({ error: "Conflict", message: "Lead already linked to a customer" });
  }
  if (!lead.phone) {
    return res.status(400).json({ error: "ValidationError", message: "A phone number is required to create a customer" });
  }

  const [customer] = await db
    .insert(customersTable)
    .values({
      companyId,
      firstName: lead.firstName,
      lastName: lead.lastName || "",
      email: lead.email,
      phone: lead.phone,
      addressLine1: lead.address,
      leadSource: lead.source,
      tags: [],
    })
    .returning();

  const [updatedLead] = await db
    .update(leadsTable)
    .set({ customerId: customer.id, status: "won", updatedAt: new Date() })
    .where(and(eq(leadsTable.id, id), eq(leadsTable.companyId, companyId)))
    .returning();

  await logActivity({ companyId, userId, action: "lead.converted", entityType: "lead", entityId: id, metadata: { customerId: customer.id } });
  return res.status(201).json({ customer, lead: updatedLead });
});

// POST /api/leads/:id/create-estimate — managers only
router.post("/:id/create-estimate", requireRole("owner", "admin"), async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ValidationError", message: "Invalid id" });

  const [lead] = await db
    .select()
    .from(leadsTable)
    .where(and(eq(leadsTable.id, id), eq(leadsTable.companyId, companyId)))
    .limit(1);
  if (!lead) return res.status(404).json({ error: "NotFound" });

  let customerId = lead.customerId;
  if (!customerId) {
    if (!lead.phone) {
      return res.status(400).json({ error: "ValidationError", message: "Convert the lead to a customer first (phone required)" });
    }
    const [customer] = await db
      .insert(customersTable)
      .values({
        companyId,
        firstName: lead.firstName,
        lastName: lead.lastName || "",
        email: lead.email,
        phone: lead.phone,
        addressLine1: lead.address,
        leadSource: lead.source,
        tags: [],
      })
      .returning();
    customerId = customer.id;
    await db.update(leadsTable).set({ customerId, updatedAt: new Date() }).where(eq(leadsTable.id, id));
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(estimatesTable)
    .where(eq(estimatesTable.companyId, companyId));
  const estimateNumber = `EST-${String(Number(count) + 1).padStart(4, "0")}`;

  const [estimate] = await db
    .insert(estimatesTable)
    .values({
      companyId,
      customerId,
      propertyId: lead.propertyId ?? null,
      estimateNumber,
      status: "draft",
      notes: lead.notes ?? null,
    })
    .returning();

  await db
    .update(leadsTable)
    .set({ status: "estimate_sent", customerId, updatedAt: new Date() })
    .where(and(eq(leadsTable.id, id), eq(leadsTable.companyId, companyId)));

  await logActivity({ companyId, userId, action: "lead.estimate_created", entityType: "estimate", entityId: estimate.id, metadata: { leadId: id } });
  return res.status(201).json({ estimate });
});

export default router;
