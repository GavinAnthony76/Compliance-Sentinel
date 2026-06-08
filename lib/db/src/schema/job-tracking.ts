import { pgTable, serial, text, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";
import { appointmentsTable } from "./appointments";

export const jobTrackingEventsTable = pgTable("job_tracking_events", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  appointmentId: integer("appointment_id").notNull().references(() => appointmentsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull(),
  eventType: text("event_type").notNull(),
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
  accuracy: numeric("accuracy", { precision: 10, scale: 2 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertJobTrackingEventSchema = createInsertSchema(jobTrackingEventsTable).omit({
  id: true,
  createdAt: true,
});

export type JobTrackingEvent = typeof jobTrackingEventsTable.$inferSelect;
export type InsertJobTrackingEvent = z.infer<typeof insertJobTrackingEventSchema>;
