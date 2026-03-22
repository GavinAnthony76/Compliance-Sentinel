import { Router } from "express";
import { db, routesTable, routeStopsTable, appointmentsTable, usersTable } from "@workspace/db";
import { eq, and, sql, desc, gte, lte } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { logActivity } from "../lib/activity";

const router = Router();
router.use(requireAuth);

router.get("/", async (req: any, res) => {
  const { companyId } = req.user;
  const routes = await db.select().from(routesTable).where(eq(routesTable.companyId, companyId)).orderBy(desc(routesTable.routeDate));

  const userIds = [...new Set(routes.map(r => r.assignedUserId).filter(Boolean))] as number[];
  const users = userIds.length > 0 ? await db.select().from(usersTable).where(sql`${usersTable.id} = ANY(${userIds})`) : [];
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
    ? await db.select().from(appointmentsTable).where(sql`${appointmentsTable.id} = ANY(${appointmentIds})`)
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

export default router;
