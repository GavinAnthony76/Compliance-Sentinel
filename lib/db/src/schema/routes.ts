import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";

export const routesTable = pgTable("routes", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  name: text("name"),
  routeDate: timestamp("route_date").notNull(),
  assignedUserId: integer("assigned_user_id"),
  status: text("status").default("planned"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const routeStopsTable = pgTable("route_stops", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  routeId: integer("route_id").notNull().references(() => routesTable.id, { onDelete: "cascade" }),
  appointmentId: integer("appointment_id").notNull(),
  stopOrder: integer("stop_order").notNull(),
  estimatedArrival: timestamp("estimated_arrival"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertRouteSchema = createInsertSchema(routesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertRouteStopSchema = createInsertSchema(routeStopsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Route = typeof routesTable.$inferSelect;
export type InsertRoute = z.infer<typeof insertRouteSchema>;
export type RouteStop = typeof routeStopsTable.$inferSelect;
export type InsertRouteStop = z.infer<typeof insertRouteStopSchema>;
