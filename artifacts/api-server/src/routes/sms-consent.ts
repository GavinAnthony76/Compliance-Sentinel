/**
 * SMS consent + preferences API.
 *
 * Customer-facing endpoints (portal auth):
 *   GET  /sms-consent/portal/preferences     — load current opt-in + category prefs
 *   POST /sms-consent/portal/opt-in           — explicit opt-in
 *   POST /sms-consent/portal/opt-out          — explicit opt-out
 *   PATCH /sms-consent/portal/preferences     — update per-category toggles
 *
 * Company/owner endpoint (company JWT — called at registration):
 *   POST /sms-consent/company/opt-in          — record owner consent at signup
 *
 * Internal STOP/START/HELP recording (called by the inbound webhook handler):
 *   POST /sms-consent/internal/record-keyword — not exposed publicly; used server-side
 */

import { Router } from "express";
import { z } from "zod";
import { db, customersTable, companiesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { appendSmsConsentEvent } from "../lib/sms-consent";
import { logger } from "../lib/logger";

const router = Router();

// Portal tokens are signed in customer-portal.ts with this exact secret.
// Keep the derivation identical or token verification silently breaks.
const PORTAL_JWT_SECRET = process.env.SESSION_SECRET || process.env.JWT_SECRET;
if (!PORTAL_JWT_SECRET) {
  throw new Error("Missing required environment variable: SESSION_SECRET or JWT_SECRET");
}

// ─── Portal (customer) endpoints ─────────────────────────────────────────────

// Minimal portal auth middleware: validates Bearer token against portal sessions.
// We inline a lightweight version here so this file stays self-contained.
async function requirePortalAuth(req: any, res: any, next: any) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
  const token = auth.slice(7);
  try {
    const jwt = await import("jsonwebtoken");
    const secret = PORTAL_JWT_SECRET + "portal:";
    const payload = jwt.default.verify(token, secret) as any;
    if (payload.type !== "portal") return res.status(401).json({ error: "Unauthorized" });
    req.portalCustomerId = payload.customerId;
    req.portalCompanyId = payload.companyId;
    next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

// GET /sms-consent/portal/preferences
router.get("/portal/preferences", requirePortalAuth, async (req: any, res) => {
  const { portalCustomerId, portalCompanyId } = req;
  const [customer] = await db
    .select({
      smsOptIn: customersTable.smsOptIn,
      smsOptOut: customersTable.smsOptOut,
      smsPrefAppointments: customersTable.smsPrefAppointments,
      smsPrefEstimates: customersTable.smsPrefEstimates,
      smsPrefInvoices: customersTable.smsPrefInvoices,
      smsPrefServiceUpdates: customersTable.smsPrefServiceUpdates,
    })
    .from(customersTable)
    .where(and(eq(customersTable.id, portalCustomerId), eq(customersTable.companyId, portalCompanyId)))
    .limit(1);
  if (!customer) return res.status(404).json({ error: "NotFound" });
  return res.json({
    smsEnabled: customer.smsOptIn && !customer.smsOptOut,
    categories: {
      appointments: customer.smsPrefAppointments,
      estimates: customer.smsPrefEstimates,
      invoices: customer.smsPrefInvoices,
      serviceUpdates: customer.smsPrefServiceUpdates,
    },
  });
});

// POST /sms-consent/portal/opt-in
router.post("/portal/opt-in", requirePortalAuth, async (req: any, res) => {
  const { portalCustomerId, portalCompanyId } = req;
  const [customer] = await db
    .select({ id: customersTable.id, phone: customersTable.phone })
    .from(customersTable)
    .where(and(eq(customersTable.id, portalCustomerId), eq(customersTable.companyId, portalCompanyId)))
    .limit(1);
  if (!customer) return res.status(404).json({ error: "NotFound" });

  await db
    .update(customersTable)
    .set({ smsOptIn: true, smsOptInAt: new Date(), smsOptInSource: "portal_prefs", smsOptOut: false, smsOptOutAt: null, smsOptOutReason: null, updatedAt: new Date() })
    .where(eq(customersTable.id, customer.id));

  await appendSmsConsentEvent({
    subjectType: "customer",
    subjectId: customer.id,
    phone: customer.phone,
    eventType: "opt_in",
    source: "portal_prefs",
    ipAddress: req.ip ?? null,
    userAgent: req.headers["user-agent"] ?? null,
  });

  return res.json({ success: true });
});

// POST /sms-consent/portal/opt-out
router.post("/portal/opt-out", requirePortalAuth, async (req: any, res) => {
  const { portalCustomerId, portalCompanyId } = req;
  const [customer] = await db
    .select({ id: customersTable.id, phone: customersTable.phone })
    .from(customersTable)
    .where(and(eq(customersTable.id, portalCustomerId), eq(customersTable.companyId, portalCompanyId)))
    .limit(1);
  if (!customer) return res.status(404).json({ error: "NotFound" });

  await db
    .update(customersTable)
    .set({ smsOptOut: true, smsOptIn: false, smsOptOutAt: new Date(), smsOptOutReason: "manual", updatedAt: new Date() })
    .where(eq(customersTable.id, customer.id));

  await appendSmsConsentEvent({
    subjectType: "customer",
    subjectId: customer.id,
    phone: customer.phone,
    eventType: "opt_out",
    source: "portal_prefs",
    ipAddress: req.ip ?? null,
    userAgent: req.headers["user-agent"] ?? null,
  });

  return res.json({ success: true });
});

const prefsSchema = z.object({
  appointments: z.boolean().optional(),
  estimates: z.boolean().optional(),
  invoices: z.boolean().optional(),
  serviceUpdates: z.boolean().optional(),
});

// PATCH /sms-consent/portal/preferences
router.patch("/portal/preferences", requirePortalAuth, async (req: any, res) => {
  const { portalCustomerId, portalCompanyId } = req;
  const parsed = prefsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "ValidationError", message: parsed.error.message });

  const { appointments, estimates, invoices, serviceUpdates } = parsed.data;
  const updates: Record<string, any> = { updatedAt: new Date() };
  if (appointments !== undefined) updates.smsPrefAppointments = appointments;
  if (estimates !== undefined) updates.smsPrefEstimates = estimates;
  if (invoices !== undefined) updates.smsPrefInvoices = invoices;
  if (serviceUpdates !== undefined) updates.smsPrefServiceUpdates = serviceUpdates;

  await db.update(customersTable).set(updates).where(and(eq(customersTable.id, portalCustomerId), eq(customersTable.companyId, portalCompanyId)));

  // Append one audit event per changed category
  const [customer] = await db.select({ phone: customersTable.phone }).from(customersTable).where(eq(customersTable.id, portalCustomerId)).limit(1);
  const categoryMap: Record<string, boolean | undefined> = { appointments, estimates, invoices, service_updates: serviceUpdates };
  for (const [cat, val] of Object.entries(categoryMap)) {
    if (val !== undefined) {
      await appendSmsConsentEvent({
        subjectType: "customer",
        subjectId: portalCustomerId,
        phone: customer?.phone ?? null,
        eventType: "pref_update",
        source: "portal_prefs",
        prefCategory: cat,
        prefValue: String(val),
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });
    }
  }

  return res.json({ success: true });
});

// ─── Company / owner consent (called at registration) ────────────────────────

const companyOptInSchema = z.object({
  companyId: z.number().int().positive(),
  phone: z.string().optional(),
});

// POST /sms-consent/company/opt-in
// Called server-side from auth.ts after successful registration when the owner
// checked the SMS consent checkbox. IP and UA are captured from the request.
router.post("/company/opt-in", requireAuth, async (req: any, res) => {
  const { companyId: jwtCompanyId } = req.user;
  const parsed = companyOptInSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "ValidationError", message: parsed.error.message });

  // The company must match the JWT — owners can only consent for their own company.
  if (parsed.data.companyId !== jwtCompanyId) return res.status(403).json({ error: "Forbidden" });

  await db
    .update(companiesTable)
    .set({ smsOptIn: true, smsOptInAt: new Date(), smsOptInSource: "registration_form", smsOptOut: false, updatedAt: new Date() })
    .where(eq(companiesTable.id, jwtCompanyId));

  await appendSmsConsentEvent({
    subjectType: "company",
    subjectId: jwtCompanyId,
    phone: parsed.data.phone ?? null,
    eventType: "opt_in",
    source: "registration_form",
    ipAddress: req.ip ?? null,
    userAgent: req.headers["user-agent"] ?? null,
  });

  logger.info({ companyId: jwtCompanyId }, "[SMS] Company owner opted in at registration");
  return res.json({ success: true });
});

export default router;
