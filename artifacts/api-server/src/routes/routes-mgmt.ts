import { Router } from "express";
import { db, routesTable, routeStopsTable, appointmentsTable, usersTable, customersTable, servicesTable, companiesTable } from "@workspace/db";
import { eq, and, sql, desc, gte, lte, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { requireFeature } from "../lib/features";
import { logActivity } from "../lib/activity";
import { sendSMS, sendEmail } from "../lib/notifications";

const router = Router();
router.use(requireAuth);
router.use(requireFeature("routes"));

router.get("/", async (req: any, res) => {
  const { companyId } = req.user;
  const routes = await db.select().from(routesTable).where(eq(routesTable.companyId, companyId)).orderBy(desc(routesTable.routeDate));

  const userIds = [...new Set(routes.map(r => r.assignedUserId).filter(Boolean))] as number[];
  const users = userIds.length > 0 ? await db.select().from(usersTable).where(inArray(usersTable.id, userIds)) : [];
  const userMap = Object.fromEntries(users.map(u => [u.id, `${u.firstName} ${u.lastName}`]));

  const stopsCountResult = await Promise.all(
    routes.map(r => db.select({ count: sql<number>`count(*)` }).from(routeStopsTable).where(eq(routeStopsTable.routeId, r.id)))
  );

  return res.json({
    routes: routes.map((r, i) => ({
      ...r,
      assignedUserName: r.assignedUserId ? userMap[r.assignedUserId] ?? null : null,
      stopsCount: Number(stopsCountResult[i][0].count),
    })),
  });
});

router.post("/", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const [route] = await db.insert(routesTable).values({
    companyId,
    routeDate: new Date(req.body.routeDate),
    assignedUserId: req.body.assignedUserId ?? null,
    status: req.body.status ?? "planned",
    notes: req.body.notes ?? null,
  }).returning();
  await logActivity({ companyId, userId, action: "route.created", entityType: "route", entityId: route.id });
  return res.status(201).json(route);
});

router.get("/:id", async (req: any, res) => {
  const { companyId } = req.user;
  const id = Number(req.params.id);
  const [route] = await db.select().from(routesTable).where(and(eq(routesTable.id, id), eq(routesTable.companyId, companyId))).limit(1);
  if (!route) return res.status(404).json({ error: "NotFound" });

  const stops = await db.select().from(routeStopsTable).where(and(eq(routeStopsTable.routeId, id), eq(routeStopsTable.companyId, companyId))).orderBy(routeStopsTable.stopOrder);

  const appointmentIds = stops.map(s => s.appointmentId);
  const appointments = appointmentIds.length > 0
    ? await db.select().from(appointmentsTable).where(inArray(appointmentsTable.id, appointmentIds))
    : [];
  const apptMap = Object.fromEntries(appointments.map(a => [a.id, a]));

  return res.json({ route, stops: stops.map(s => ({ ...s, appointment: apptMap[s.appointmentId] ?? null })) });
});

router.put("/:id", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(routesTable).where(and(eq(routesTable.id, id), eq(routesTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });
  const [updated] = await db.update(routesTable).set({ ...req.body, routeDate: req.body.routeDate ? new Date(req.body.routeDate) : existing.routeDate, updatedAt: new Date() }).where(and(eq(routesTable.id, id), eq(routesTable.companyId, companyId))).returning();
  await logActivity({ companyId, userId, action: "route.updated", entityType: "route", entityId: id });
  return res.json(updated);
});

router.delete("/:id", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(routesTable).where(and(eq(routesTable.id, id), eq(routesTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });
  await db.delete(routeStopsTable).where(eq(routeStopsTable.routeId, id));
  await db.delete(routesTable).where(and(eq(routesTable.id, id), eq(routesTable.companyId, companyId)));
  return res.json({ success: true });
});

router.post("/:id/stops", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const routeId = Number(req.params.id);
  const [route] = await db.select().from(routesTable).where(and(eq(routesTable.id, routeId), eq(routesTable.companyId, companyId))).limit(1);
  if (!route) return res.status(404).json({ error: "NotFound" });
  const [stop] = await db.insert(routeStopsTable).values({
    companyId,
    routeId,
    appointmentId: req.body.appointmentId,
    stopOrder: req.body.stopOrder,
    estimatedArrival: req.body.estimatedArrival ? new Date(req.body.estimatedArrival) : null,
  }).returning();
  return res.status(201).json(stop);
});

router.delete("/:routeId/stops/:stopId", async (req: any, res) => {
  const { companyId } = req.user;
  const routeId = Number(req.params.routeId);
  const stopId = Number(req.params.stopId);
  await db.delete(routeStopsTable).where(and(eq(routeStopsTable.id, stopId), eq(routeStopsTable.routeId, routeId), eq(routeStopsTable.companyId, companyId)));
  return res.json({ success: true });
});

// POST /:routeId/stops/:stopId/on-my-way — send "on my way" SMS/email to customer
router.post("/:routeId/stops/:stopId/on-my-way", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const routeId = Number(req.params.routeId);
  const stopId = Number(req.params.stopId);

  const [stop] = await db.select().from(routeStopsTable)
    .where(and(eq(routeStopsTable.id, stopId), eq(routeStopsTable.routeId, routeId), eq(routeStopsTable.companyId, companyId)))
    .limit(1);
  if (!stop) return res.status(404).json({ error: "NotFound" });

  const [appt] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, stop.appointmentId)).limit(1);
  if (!appt) return res.status(404).json({ error: "AppointmentNotFound" });

  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, appt.customerId)).limit(1);
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
  const service = appt.serviceId ? await db.select().from(servicesTable).where(eq(servicesTable.id, appt.serviceId)).limit(1).then(r => r[0]) : null;

  if (!customer) return res.status(404).json({ error: "CustomerNotFound" });

  const companyName = company?.name || "Your service provider";
  const serviceName = service?.name || "your service";
  const etaMinutes = req.body.etaMinutes ? Number(req.body.etaMinutes) : null;
  const etaText = etaMinutes ? ` in approximately ${etaMinutes} minutes` : " shortly";

  const smsMsg = `Hi ${customer.firstName}! Your ${companyName} technician is on the way${etaText} for your ${serviceName} appointment. Reply STOP to opt out.`;

  let notified = false;
  if (customer.phone) {
    await sendSMS({ to: customer.phone, body: smsMsg });
    notified = true;
  }
  if (customer.email) {
    await sendEmail({
      to: customer.email,
      subject: `Your ${companyName} technician is on the way!`,
      body: `Hi ${customer.firstName},\n\nYour ${companyName} technician is on the way${etaText} for your ${serviceName} appointment.\n\nThank you for choosing ${companyName}!`,
    });
    notified = true;
  }

  await logActivity({ companyId, userId, action: "route.on_my_way_sent", entityType: "appointment", entityId: appt.id, metadata: { stopId, etaMinutes } });
  return res.json({ success: true, notified, customerPhone: customer.phone, customerEmail: customer.email });
});

// POST /send-appointment-reminders — send 24h-ahead reminders for tomorrow's appointments
router.post("/send-appointment-reminders", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayStart = new Date(tomorrow.setHours(0, 0, 0, 0));
  const dayEnd = new Date(tomorrow.setHours(23, 59, 59, 999));

  const appointments = await db.select().from(appointmentsTable)
    .where(and(
      eq(appointmentsTable.companyId, companyId),
      eq(appointmentsTable.status, "confirmed"),
      gte(appointmentsTable.scheduledStart, dayStart),
      lte(appointmentsTable.scheduledStart, dayEnd),
    ));

  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
  let sent = 0;

  for (const appt of appointments) {
    try {
      const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, appt.customerId)).limit(1);
      const service = appt.serviceId ? await db.select().from(servicesTable).where(eq(servicesTable.id, appt.serviceId)).limit(1).then(r => r[0]) : null;
      if (!customer) continue;

      const { sendReminder } = await import("../lib/notifications");
      await sendReminder({
        customerName: `${customer.firstName} ${customer.lastName}`,
        customerEmail: customer.email || undefined,
        customerPhone: customer.phone || undefined,
        scheduledStart: new Date(appt.scheduledStart!),
        serviceName: service?.name,
        channel: customer.phone ? "sms" : "email",
      });
      sent++;
    } catch (_err) { /* non-fatal */ }
  }

  await logActivity({ companyId, userId, action: "appointments.reminders_sent", metadata: { count: sent } });
  return res.json({ success: true, remindersSent: sent, totalTomorrow: appointments.length });
});

export default router;
