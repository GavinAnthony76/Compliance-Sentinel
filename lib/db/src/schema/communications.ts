import { pgTable, serial, text, timestamp, integer, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";

export const communicationEventsTable = pgTable("communication_events", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  customerId: integer("customer_id"),
  leadId: integer("lead_id"),
  appointmentId: integer("appointment_id"),
  estimateId: integer("estimate_id"),
  invoiceId: integer("invoice_id"),
  channel: text("channel").notNull(),
  direction: text("direction").notNull().default("outbound"),
  subject: text("subject"),
  bodyPreview: text("body_preview"),
  status: text("status").notNull().default("logged"),
  metadataJson: json("metadata_json"),
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCommunicationEventSchema = createInsertSchema(communicationEventsTable).omit({
  id: true,
  createdAt: true,
});

export type CommunicationEvent = typeof communicationEventsTable.$inferSelect;
export type InsertCommunicationEvent = z.infer<typeof insertCommunicationEventSchema>;
