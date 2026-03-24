import { Router } from "express";
import { db, appointmentsTable, customersTable, servicesTable, usersTable, companiesTable } from "@workspace/db";
import { eq, and, gte, lte, sql, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { logActivity } from "../lib/activity";
import { sendReminder, sendSMS, sendEmail } from "../lib/notifications";
import { fireAutomations } from "../lib/automations";

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

    if (channel === 'confirmation') {
      const msg = `Hi ${customer.firstName}! Your ${serviceName} appointment with ${companyName} is confirmed for ${dateStr} at ${timeStr}. Reply STOP to opt out.`;
      if (customer.phone) await sendSMS({ to: customer.phone, body: msg });
      if (customer.email) await sendEmail({
        to: customer.email,
        subject: `Appointment Confirmed — ${serviceName} on ${dateStr}`,
        body: `Hi ${customer.firstName},\n\nYour ${serviceName} appointment with ${companyName} has been confirmed!\n\nDate: ${dateStr}\nTime: ${timeStr}\n\nThank you!`,
      });
    } else {
      await sendReminder({ customerName: `${customer.firstName} ${customer.lastName}`, customerEmail: customer.email || undefined, customerPhone: customer.phone || undefined, scheduledStart: new Date(appt.scheduledStart), serviceName, channel: customer.phone ? 'sms' : 'email' });
    }
  } catch (_err) {
    // Non-fatal: SMS failure should not block main response
  }
}

const router = Router();
router.use(requireAuth);

function fmtAppt(a: any, customerName?: string, serviceName?: string, assignedUserName?: string) {
  return {
    ...a,
    price: a.price ? Number(a.price) : null,
    customerName: customerName ?? null,
    serviceName: serviceName ?? null,
    assignedUserName: assignedUserName ?? null,
  };
}

router.get("/", async (req: any, res) => {
  const { companyId } = req.user;
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 50;
  const offset = (page - 1) * limit;

  const conditions: any[] = [eq(appointmentsTable.companyId, companyId)];
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

router.post("/", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const [appt] = await db.insert(appointmentsTable).values({
    companyId,
    customerId: req.body.customerId,
    propertyId: req.body.propertyId ?? null,
    serviceId: req.body.serviceId ?? null,
    assignedUserId: req.body.assignedUserId ?? null,
    status: req.body.status ?? "pending",
    scheduledStart: new Date(req.body.scheduledStart),
    scheduledEnd: req.body.scheduledEnd ? new Date(req.body.scheduledEnd) : null,
    price: req.body.price != null ? String(req.body.price) : null,
    notes: req.body.notes ?? null,
    internalNotes: req.body.internalNotes ?? null,
  }).returning();
  await logActivity({ companyId, userId, action: "appointment.created", entityType: "appointment", entityId: appt.id });
  // Send booking confirmation SMS/email in background
  sendAppointmentNotification(appt, companyId, 'confirmation');
  return res.status(201).json(fmtAppt(appt));
});

router.get("/:id", async (req: any, res) => {
  const { companyId } = req.user;
  const id = Number(req.params.id);
  const [appt] = await db.select().from(appointmentsTable).where(and(eq(appointmentsTable.id, id), eq(appointmentsTable.companyId, companyId))).limit(1);
  if (!appt) return res.status(404).json({ error: "NotFound" });

  const [customer, service] = await Promise.all([
    db.select().from(customersTable).where(eq(customersTable.id, appt.customerId)).limit(1).then(r => r[0]),
    appt.serviceId ? db.select().from(servicesTable).where(eq(servicesTable.id, appt.serviceId)).limit(1).then(r => r[0]) : null,
  ]);

  return res.json({ appointment: fmtAppt(appt), customer, service });
});

router.put("/:id", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(appointmentsTable).where(and(eq(appointmentsTable.id, id), eq(appointmentsTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });

  const updateData: any = { updatedAt: new Date() };
  if (req.body.customerId != null) updateData.customerId = req.body.customerId;
  if (req.body.propertyId !== undefined) updateData.propertyId = req.body.propertyId;
  if (req.body.serviceId !== undefined) updateData.serviceId = req.body.serviceId;
  if (req.body.assignedUserId !== undefined) updateData.assignedUserId = req.body.assignedUserId;
  if (req.body.status) updateData.status = req.body.status;
  if (req.body.scheduledStart) updateData.scheduledStart = new Date(req.body.scheduledStart);
  if (req.body.scheduledEnd) updateData.scheduledEnd = new Date(req.body.scheduledEnd);
  if (req.body.price != null) updateData.price = String(req.body.price);
  if (req.body.notes !== undefined) updateData.notes = req.body.notes;
  if (req.body.internalNotes !== undefined) updateData.internalNotes = req.body.internalNotes;
  if (req.body.completionNotes !== undefined) updateData.completionNotes = req.body.completionNotes;

  const [updated] = await db.update(appointmentsTable).set(updateData).where(and(eq(appointmentsTable.id, id), eq(appointmentsTable.companyId, companyId))).returning();
  await logActivity({ companyId, userId, action: "appointment.updated", entityType: "appointment", entityId: id });
  // If status changed to confirmed, send confirmation notification
  if (updateData.status === "confirmed" && existing.status !== "confirmed") {
    sendAppointmentNotification(updated, companyId, 'confirmation');
  }
  // If status changed to completed, fire appointment_completed automations
  if (updateData.status === "completed" && existing.status !== "completed") {
    fireAutomations(companyId, "appointment_completed", {
      customerId: updated.customerId,
      userId,
      appointmentId: updated.id,
      appointmentPrice: updated.price ? Number(updated.price) : null,
    });
  }
  return res.json(fmtAppt(updated));
});

router.delete("/:id", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(appointmentsTable).where(and(eq(appointmentsTable.id, id), eq(appointmentsTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });
  await db.delete(appointmentsTable).where(and(eq(appointmentsTable.id, id), eq(appointmentsTable.companyId, companyId)));
  await logActivity({ companyId, userId, action: "appointment.deleted", entityType: "appointment", entityId: id });
  return res.json({ success: true });
});

router.post("/:id/complete", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(appointmentsTable).where(and(eq(appointmentsTable.id, id), eq(appointmentsTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });
  const [updated] = await db.update(appointmentsTable).set({
    status: "completed",
    completionNotes: req.body.completionNotes ?? null,
    updatedAt: new Date(),
  }).where(and(eq(appointmentsTable.id, id), eq(appointmentsTable.companyId, companyId))).returning();
  await logActivity({ companyId, userId, action: "appointment.completed", entityType: "appointment", entityId: id });

  // Fire all active appointment_completed automations (non-blocking)
  fireAutomations(companyId, "appointment_completed", {
    customerId: existing.customerId,
    userId,
    appointmentId: id,
    appointmentPrice: existing.price ? Number(existing.price) : null,
  });

  return res.json(fmtAppt(updated));
});

export default router;
