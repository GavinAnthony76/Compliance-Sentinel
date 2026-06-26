import { Router } from "express";
import { z } from "zod";
import { db, appointmentsTable, customersTable, servicesTable, usersTable, companiesTable, jobTrackingEventsTable } from "@workspace/db";
import { eq, and, gte, lte, sql, desc, asc, inArray, gt } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { requireActiveSubscription } from "../lib/subscription";
import { requireFeature, requireWithinPlanLimit, hasFeature } from "../lib/features";
import { logActivity } from "../lib/activity";
import { logCommunicationEvent } from "../lib/communications";
import { sendReminder, sendEmail, sendAppointmentStatusEmail, sendAppointmentConfirmationEmail, sendAppointmentRescheduledEmail } from "../lib/notifications";
import { sendSMSWithConsent } from "../lib/sms-consent";
import { fireAutomations } from "../lib/automations";

// ─── GPS job-tracking helpers ────────────────────────────────────────────────

const geoSchema = z.object({
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  accuracy: z.number().nonnegative().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

const TRACKING_EVENT_TYPES = ["check_in", "start", "complete", "location_ping", "note"] as const;

async function recordTrackingEvent(args: {
  companyId: number;
  appointmentId: number;
  userId: number;
  eventType: (typeof TRACKING_EVENT_TYPES)[number];
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
  notes?: string | null;
}) {
  const [event] = await db.insert(jobTrackingEventsTable).values({
    companyId: args.companyId,
    appointmentId: args.appointmentId,
    userId: args.userId,
    eventType: args.eventType,
    latitude: args.latitude != null ? String(args.latitude) : null,
    longitude: args.longitude != null ? String(args.longitude) : null,
    accuracy: args.accuracy != null ? String(args.accuracy) : null,
    notes: args.notes ?? null,
  }).returning();
  return event;
}

const createAppointmentSchema = z.object({
  customerId: z.number().int().positive(),
  propertyId: z.number().int().positive().optional().nullable(),
  serviceId: z.number().int().positive().optional().nullable(),
  assignedUserId: z.number().int().positive().optional().nullable(),
  status: z.enum(["pending", "confirmed", "in_progress", "completed", "cancelled", "no_show"]).optional(),
  scheduledStart: z.string().datetime(),
  scheduledEnd: z.string().datetime().optional().nullable(),
  price: z.number().nonnegative().optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  internalNotes: z.string().max(5000).optional().nullable(),
});

const updateAppointmentSchema = createAppointmentSchema.partial();

async function sendAppointmentNotification(appt: any, companyId: number, channel: 'confirmation' | 'reminder') {
  try {
    const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, appt.customerId)).limit(1);
    const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
    const [service] = appt.serviceId ? await db.select().from(servicesTable).where(eq(servicesTable.id, appt.serviceId)).limit(1) : [null];
    if (!customer) return;

    const dateStr = appt.scheduledStart ? new Date(appt.scheduledStart).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : 'TBD';
    const timeStr = appt.scheduledStart ? new Date(appt.scheduledStart).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';
    const companyName = company?.name || 'Your service provider';
    const serviceName = service?.name || 'lawn care service';
    const smsAllowed = hasFeature(company?.subscriptionPlan, "sms_notifications");

    if (channel === 'confirmation') {
      const msg = `Hi ${customer.firstName}! Your ${serviceName} appointment with ${companyName} is confirmed for ${dateStr} at ${timeStr}.`;
      if (customer.phone && smsAllowed) await sendSMSWithConsent({ to: customer.phone, body: msg, category: "appointments", subject: { type: "customer", id: customer.id, companyId } });
      if (customer.email) await sendAppointmentConfirmationEmail({
        customerName: customer.firstName,
        customerEmail: customer.email,
        scheduledStart: new Date(appt.scheduledStart),
        serviceName,
        companyName,
        companyEmail: company?.email || undefined,
        logoUrl: company?.logoUrl ?? null,
        primaryColor: company?.primaryColor ?? null,
      });
    } else {
      const useSms = customer.phone && smsAllowed;
      await sendReminder({ customerName: `${customer.firstName} ${customer.lastName}`, customerEmail: customer.email || undefined, customerPhone: customer.phone || undefined, scheduledStart: new Date(appt.scheduledStart), serviceName, channel: useSms ? 'sms' : 'email', companyName: company?.name || undefined, companyEmail: company?.email || undefined, logoUrl: company?.logoUrl ?? null, primaryColor: company?.primaryColor ?? null, consent: { customerId: customer.id, companyId } });
    }
    await logCommunicationEvent({
      companyId,
      customerId: appt.customerId,
      appointmentId: appt.id,
      channel: customer.phone && smsAllowed ? "sms" : "email",
      subject: channel === "confirmation" ? `Appointment confirmed — ${serviceName}` : `Appointment reminder — ${serviceName}`,
      bodyPreview: `${serviceName} on ${dateStr} at ${timeStr}`,
      status: "sent",
    });
  } catch (_err) {
    // Non-fatal: SMS failure should not block main response
  }
}

// Customer-facing copy for each appointment status change.
function statusNotificationCopy(status: string, companyName: string, serviceName: string, dateStr: string) {
  switch (status) {
    case "confirmed":
      return { subject: `Appointment Confirmed — ${serviceName}`, message: `Good news! Your ${serviceName} appointment with ${companyName} is confirmed.`, sms: `Your ${serviceName} appointment with ${companyName} on ${dateStr} is confirmed.` };
    case "in_progress":
      return { subject: `We're on the way — ${serviceName}`, message: `Your ${serviceName} service with ${companyName} is now in progress. Our team is working on it.`, sms: `${companyName}: your ${serviceName} service is now in progress.` };
    case "completed":
      return { subject: `Service Complete — ${serviceName}`, message: `Your ${serviceName} service with ${companyName} is complete. Thank you for your business!`, sms: `${companyName}: your ${serviceName} service is complete. Thank you!` };
    case "cancelled":
      return { subject: `Appointment Cancelled — ${serviceName}`, message: `Your ${serviceName} appointment with ${companyName} scheduled for ${dateStr} has been cancelled. Please contact us to reschedule.`, sms: `${companyName}: your ${serviceName} appointment on ${dateStr} has been cancelled.` };
    case "no_show":
      return { subject: `We missed you — ${serviceName}`, message: `We were unable to complete your ${serviceName} appointment with ${companyName} on ${dateStr}. Please reach out so we can reschedule.`, sms: `${companyName}: we missed you for your ${serviceName} appointment on ${dateStr}. Contact us to reschedule.` };
    default:
      return null;
  }
}

// Notify the customer when an appointment's status changes.
async function sendAppointmentStatusNotification(appt: any, companyId: number, status: string) {
  try {
    const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, appt.customerId)).limit(1);
    if (!customer) return;
    const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
    const [service] = appt.serviceId ? await db.select().from(servicesTable).where(eq(servicesTable.id, appt.serviceId)).limit(1) : [null];

    const dateStr = appt.scheduledStart ? new Date(appt.scheduledStart).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : 'TBD';
    const timeStr = appt.scheduledStart ? new Date(appt.scheduledStart).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';
    const companyName = company?.name || 'Your service provider';
    const serviceName = service?.name || 'lawn care service';
    const copy = statusNotificationCopy(status, companyName, serviceName, dateStr);
    if (!copy) return;

    const smsAllowed = hasFeature(company?.subscriptionPlan, "sms_notifications");
    if (customer.phone && smsAllowed) await sendSMSWithConsent({ to: customer.phone, body: copy.sms, category: "appointments", subject: { type: "customer", id: customer.id, companyId } });
    if (customer.email) await sendAppointmentStatusEmail({
      to: customer.email,
      customerName: customer.firstName,
      companyName,
      companyEmail: company?.email || undefined,
      serviceName,
      dateStr,
      timeStr,
      subject: copy.subject,
      message: copy.message,
    });

    await logCommunicationEvent({
      companyId,
      customerId: appt.customerId,
      appointmentId: appt.id,
      channel: customer.phone && smsAllowed ? "sms" : "email",
      subject: copy.subject,
      bodyPreview: `${serviceName} on ${dateStr}${timeStr ? ` at ${timeStr}` : ""} — ${status}`,
      status: "sent",
    });
  } catch (_err) {
    // Non-fatal: notification failure must not block the status update
  }
}

// Notify the customer when their appointment is rescheduled to a new time
// (no status change). Email + SMS where enabled.
async function sendAppointmentRescheduleNotification(appt: any, companyId: number) {
  try {
    const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, appt.customerId)).limit(1);
    if (!customer) return;
    const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
    const [service] = appt.serviceId ? await db.select().from(servicesTable).where(eq(servicesTable.id, appt.serviceId)).limit(1) : [null];

    const when = appt.scheduledStart ? new Date(appt.scheduledStart) : null;
    if (!when) return;
    const dateStr = when.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const timeStr = when.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const companyName = company?.name || 'Your service provider';
    const serviceName = service?.name || 'lawn care service';

    const smsAllowed = hasFeature(company?.subscriptionPlan, "sms_notifications");
    if (customer.phone && smsAllowed) {
      await sendSMSWithConsent({ to: customer.phone, body: `${companyName}: your ${serviceName} appointment has been rescheduled to ${dateStr} at ${timeStr}.`, category: "appointments", subject: { type: "customer", id: customer.id, companyId } });
    }
    if (customer.email) {
      await sendAppointmentRescheduledEmail({
        to: customer.email,
        customerName: customer.firstName,
        scheduledStart: when,
        serviceName,
        companyName,
        companyEmail: company?.email || undefined,
        logoUrl: company?.logoUrl,
        primaryColor: company?.primaryColor,
      });
    }

    await logCommunicationEvent({
      companyId,
      customerId: appt.customerId,
      appointmentId: appt.id,
      channel: customer.phone && smsAllowed ? "sms" : "email",
      subject: `Appointment Rescheduled — ${serviceName}`,
      bodyPreview: `${serviceName} rescheduled to ${dateStr} at ${timeStr}`,
      status: "sent",
    });
  } catch (_err) {
    // Non-fatal: notification failure must not block the reschedule
  }
}

const router = Router();
router.use(requireAuth);
router.use(requireActiveSubscription);

function fmtAppt(a: any, customerName?: string, serviceName?: string, assignedUserName?: string) {
  return {
    ...a,
    price: a.price ? Number(a.price) : null,
    customerName: customerName ?? null,
    serviceName: serviceName ?? null,
    assignedUserName: assignedUserName ?? null,
  };
}

// GET /appointments/unread-count — number of NEW customer-initiated bookings
// (origin = "portal_request") created since this user last opened the
// Appointments page. Drives the "new appointment" dot on the sidebar nav item.
router.get("/unread-count", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const [user] = await db
    .select({ appointmentsSeenAt: usersTable.appointmentsSeenAt })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  const seenAt = user?.appointmentsSeenAt ?? null;

  const conditions: any[] = [
    eq(appointmentsTable.companyId, companyId),
    eq(appointmentsTable.origin, "portal_request"),
  ];
  if (seenAt) conditions.push(gt(appointmentsTable.createdAt, seenAt));

  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(appointmentsTable)
    .where(and(...conditions));
  return res.json({ unread: Number(row.count) });
});

// POST /appointments/mark-seen — mark the Appointments list as seen for the
// current user, clearing the "new appointment" indicator.
router.post("/mark-seen", async (req: any, res) => {
  const { userId } = req.user;
  await db
    .update(usersTable)
    .set({ appointmentsSeenAt: new Date(), updatedAt: new Date() })
    .where(eq(usersTable.id, userId));
  return res.json({ success: true, seenAt: new Date() });
});

router.get("/", async (req: any, res) => {
  const { companyId, userId, role } = req.user;
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 50;
  const offset = (page - 1) * limit;

  const conditions: any[] = [eq(appointmentsTable.companyId, companyId)];
  // Staff only ever see the appointments assigned to them.
  if (role === "staff") conditions.push(eq(appointmentsTable.assignedUserId, userId));
  if (req.query.status) conditions.push(eq(appointmentsTable.status, req.query.status as string));
  if (req.query.customerId) conditions.push(eq(appointmentsTable.customerId, Number(req.query.customerId)));
  if (req.query.assignedUserId) conditions.push(eq(appointmentsTable.assignedUserId, Number(req.query.assignedUserId)));
  if (req.query.startDate) conditions.push(gte(appointmentsTable.scheduledStart, new Date(req.query.startDate as string)));
  if (req.query.endDate) conditions.push(lte(appointmentsTable.scheduledStart, new Date(req.query.endDate as string)));

  const [appointments, totalResult] = await Promise.all([
    db.select().from(appointmentsTable).where(and(...conditions)).orderBy(desc(appointmentsTable.scheduledStart)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(appointmentsTable).where(and(...conditions)),
  ]);

  const customerIds = [...new Set(appointments.map(a => a.customerId))];
  const serviceIds = [...new Set(appointments.map(a => a.serviceId).filter(Boolean))] as number[];
  const userIds = [...new Set(appointments.map(a => a.assignedUserId).filter(Boolean))] as number[];

  const [customers, services, users] = await Promise.all([
    customerIds.length > 0 ? db.select().from(customersTable).where(inArray(customersTable.id, customerIds)) : [],
    serviceIds.length > 0 ? db.select().from(servicesTable).where(inArray(servicesTable.id, serviceIds)) : [],
    userIds.length > 0 ? db.select().from(usersTable).where(inArray(usersTable.id, userIds)) : [],
  ]);

  const customerMap = Object.fromEntries(customers.map(c => [c.id, `${c.firstName} ${c.lastName}`]));
  const serviceMap = Object.fromEntries(services.map(s => [s.id, s.name]));
  const userMap = Object.fromEntries(users.map(u => [u.id, `${u.firstName} ${u.lastName}`]));

  return res.json({
    appointments: appointments.map(a => fmtAppt(a, customerMap[a.customerId], a.serviceId ? serviceMap[a.serviceId] : undefined, a.assignedUserId ? userMap[a.assignedUserId] : undefined)),
    total: Number(totalResult[0].count),
    page,
    limit,
  });
});

router.post("/", requireRole("owner", "admin"), requireWithinPlanLimit("appointments"), async (req: any, res) => {
  const parsed = createAppointmentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "ValidationError", message: parsed.error.message });
  }
  const { companyId, userId } = req.user;
  const [appt] = await db.insert(appointmentsTable).values({
    companyId,
    customerId: parsed.data.customerId,
    propertyId: parsed.data.propertyId ?? null,
    serviceId: parsed.data.serviceId ?? null,
    assignedUserId: parsed.data.assignedUserId ?? null,
    status: parsed.data.status ?? "pending",
    scheduledStart: new Date(parsed.data.scheduledStart),
    scheduledEnd: parsed.data.scheduledEnd ? new Date(parsed.data.scheduledEnd) : null,
    price: parsed.data.price != null ? String(parsed.data.price) : null,
    notes: parsed.data.notes ?? null,
    internalNotes: parsed.data.internalNotes ?? null,
  }).returning();
  await logActivity({ companyId, userId, action: "appointment.created", entityType: "appointment", entityId: appt.id });
  sendAppointmentNotification(appt, companyId, 'confirmation');
  return res.status(201).json(fmtAppt(appt));
});

router.get("/:id", async (req: any, res) => {
  const { companyId, userId, role } = req.user;
  const id = Number(req.params.id);
  const [appt] = await db.select().from(appointmentsTable).where(and(eq(appointmentsTable.id, id), eq(appointmentsTable.companyId, companyId))).limit(1);
  if (!appt) return res.status(404).json({ error: "NotFound" });
  if (role === "staff" && appt.assignedUserId !== userId) return res.status(403).json({ error: "Forbidden", message: "Not assigned to you" });

  const [customer, service] = await Promise.all([
    db.select().from(customersTable).where(eq(customersTable.id, appt.customerId)).limit(1).then(r => r[0]),
    appt.serviceId ? db.select().from(servicesTable).where(eq(servicesTable.id, appt.serviceId)).limit(1).then(r => r[0]) : null,
  ]);

  return res.json({ appointment: fmtAppt(appt), customer, service });
});

router.put("/:id", async (req: any, res) => {
  const parsed = updateAppointmentSchema.extend({ completionNotes: z.string().max(5000).optional().nullable() }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "ValidationError", message: parsed.error.message });
  }
  const { companyId, userId, role } = req.user;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(appointmentsTable).where(and(eq(appointmentsTable.id, id), eq(appointmentsTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });
  // Staff may only progress their own assigned appointments — never reassign or reschedule.
  const isStaff = role === "staff";
  if (isStaff && existing.assignedUserId !== userId) return res.status(403).json({ error: "Forbidden", message: "Not assigned to you" });

  const body = parsed.data;
  const updateData: any = { updatedAt: new Date() };
  if (body.customerId != null) updateData.customerId = body.customerId;
  if (body.propertyId !== undefined) updateData.propertyId = body.propertyId;
  if (body.serviceId !== undefined) updateData.serviceId = body.serviceId;
  if (body.assignedUserId !== undefined) updateData.assignedUserId = body.assignedUserId;
  if (body.status) updateData.status = body.status;
  if (body.scheduledStart) updateData.scheduledStart = new Date(body.scheduledStart);
  if (body.scheduledEnd) updateData.scheduledEnd = new Date(body.scheduledEnd);
  if (body.price != null) updateData.price = String(body.price);
  if (body.notes !== undefined) updateData.notes = body.notes;
  if (body.internalNotes !== undefined) updateData.internalNotes = body.internalNotes;
  if (body.completionNotes !== undefined) updateData.completionNotes = body.completionNotes;
  // Staff are restricted to status/notes updates; strip management-only fields.
  if (isStaff) {
    for (const k of ["customerId", "propertyId", "serviceId", "assignedUserId", "scheduledStart", "scheduledEnd", "price"]) {
      delete updateData[k];
    }
  }

  const [updated] = await db.update(appointmentsTable).set(updateData).where(and(eq(appointmentsTable.id, id), eq(appointmentsTable.companyId, companyId))).returning();
  await logActivity({ companyId, userId, action: "appointment.updated", entityType: "appointment", entityId: id });
  // If the status actually changed, notify the customer (email + SMS where enabled).
  if (updateData.status && updateData.status !== existing.status) {
    void sendAppointmentStatusNotification(updated, companyId, updateData.status);
  } else if (
    // Reschedule: the date/time moved but the status did NOT change. Status
    // changes already carry their own copy (incl. the new time), so only send
    // a dedicated "rescheduled" notice when there's no concurrent status change.
    updateData.scheduledStart &&
    existing.scheduledStart &&
    new Date(updateData.scheduledStart).getTime() !== new Date(existing.scheduledStart).getTime()
  ) {
    void sendAppointmentRescheduleNotification(updated, companyId);
  }
  // If status changed to completed, fire appointment_completed automations
  if (updateData.status === "completed" && existing.status !== "completed") {
    fireAutomations(companyId, "appointment_completed", {
      customerId: updated.customerId,
      userId,
      appointmentId: updated.id,
      appointmentPrice: updated.price ? Number(updated.price) : null,
      appointmentServiceId: updated.serviceId,
    });
  }
  return res.json(fmtAppt(updated));
});

router.delete("/:id", requireRole("owner", "admin"), async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(appointmentsTable).where(and(eq(appointmentsTable.id, id), eq(appointmentsTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });
  await db.delete(appointmentsTable).where(and(eq(appointmentsTable.id, id), eq(appointmentsTable.companyId, companyId)));
  await logActivity({ companyId, userId, action: "appointment.deleted", entityType: "appointment", entityId: id });
  return res.json({ success: true });
});

router.post("/:id/complete", async (req: any, res) => {
  const { companyId, userId, role } = req.user;
  const id = Number(req.params.id);
  const geo = geoSchema.safeParse(req.body ?? {});
  const geoData = geo.success ? geo.data : {};
  const [existing] = await db.select().from(appointmentsTable).where(and(eq(appointmentsTable.id, id), eq(appointmentsTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });
  if (role === "staff" && existing.assignedUserId !== userId) return res.status(403).json({ error: "Forbidden", message: "Not assigned to you" });
  const [updated] = await db.update(appointmentsTable).set({
    status: "completed",
    completionNotes: req.body.completionNotes ?? null,
    actualCompletedAt: existing.actualCompletedAt ?? new Date(),
    updatedAt: new Date(),
  }).where(and(eq(appointmentsTable.id, id), eq(appointmentsTable.companyId, companyId))).returning();
  await recordTrackingEvent({
    companyId, appointmentId: id, userId, eventType: "complete",
    latitude: geoData.latitude, longitude: geoData.longitude, accuracy: geoData.accuracy,
    notes: req.body.completionNotes ?? geoData.notes ?? null,
  });
  await logActivity({ companyId, userId, action: "appointment.completed", entityType: "appointment", entityId: id });

  // Only run completion side-effects when the appointment wasn't already
  // completed, to avoid duplicate customer notifications / automation runs.
  if (existing.status !== "completed") {
    // Notify the customer the job is complete (email + SMS where enabled).
    void sendAppointmentStatusNotification(updated, companyId, "completed");

    // Fire all active appointment_completed automations (non-blocking).
    fireAutomations(companyId, "appointment_completed", {
      customerId: existing.customerId,
      userId,
      appointmentId: id,
      appointmentPrice: existing.price ? Number(existing.price) : null,
      appointmentServiceId: existing.serviceId,
    });
  }

  return res.json(fmtAppt(updated));
});

// ─── GPS job-tracking lifecycle ──────────────────────────────────────────────

// POST /:id/check-in — technician arrives on site (GPS job tracking — Growth+)
router.post("/:id/check-in", requireFeature("gps_tracking"), async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const parsed = geoSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "ValidationError", message: parsed.error.message });
  const [existing] = await db.select().from(appointmentsTable).where(and(eq(appointmentsTable.id, id), eq(appointmentsTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });

  await db.update(appointmentsTable)
    .set({ checkedInByUserId: userId, updatedAt: new Date() })
    .where(and(eq(appointmentsTable.id, id), eq(appointmentsTable.companyId, companyId)));
  const event = await recordTrackingEvent({
    companyId, appointmentId: id, userId, eventType: "check_in",
    latitude: parsed.data.latitude, longitude: parsed.data.longitude, accuracy: parsed.data.accuracy, notes: parsed.data.notes,
  });
  await logActivity({ companyId, userId, action: "appointment.checked_in", entityType: "appointment", entityId: id });
  return res.status(201).json({ event });
});

// POST /:id/start — technician begins the job (GPS job tracking — Growth+)
router.post("/:id/start", requireFeature("gps_tracking"), async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const parsed = geoSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "ValidationError", message: parsed.error.message });
  const [existing] = await db.select().from(appointmentsTable).where(and(eq(appointmentsTable.id, id), eq(appointmentsTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });

  const [updated] = await db.update(appointmentsTable)
    .set({ actualStartedAt: existing.actualStartedAt ?? new Date(), checkedInByUserId: existing.checkedInByUserId ?? userId, updatedAt: new Date() })
    .where(and(eq(appointmentsTable.id, id), eq(appointmentsTable.companyId, companyId))).returning();
  const event = await recordTrackingEvent({
    companyId, appointmentId: id, userId, eventType: "start",
    latitude: parsed.data.latitude, longitude: parsed.data.longitude, accuracy: parsed.data.accuracy, notes: parsed.data.notes,
  });
  await logActivity({ companyId, userId, action: "appointment.started", entityType: "appointment", entityId: id });
  return res.status(201).json({ event, appointment: fmtAppt(updated) });
});

// GET /:id/tracking — full event timeline for one appointment (GPS job tracking — Growth+)
router.get("/:id/tracking", requireFeature("gps_tracking"), async (req: any, res) => {
  const { companyId } = req.user;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(appointmentsTable).where(and(eq(appointmentsTable.id, id), eq(appointmentsTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });
  const events = await db.select().from(jobTrackingEventsTable)
    .where(and(eq(jobTrackingEventsTable.appointmentId, id), eq(jobTrackingEventsTable.companyId, companyId)))
    .orderBy(asc(jobTrackingEventsTable.createdAt));
  return res.json({
    events,
    actualStartedAt: existing.actualStartedAt,
    actualCompletedAt: existing.actualCompletedAt,
    checkedInByUserId: existing.checkedInByUserId,
  });
});

export default router;
