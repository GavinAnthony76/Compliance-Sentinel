import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";
import { customersTable } from "./customers";

export const reviewRequestsTable = pgTable("review_requests", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  appointmentId: integer("appointment_id"),
  sentAt: timestamp("sent_at"),
  channel: text("channel").notNull(),
  status: text("status").notNull().default("pending"),
  reviewUrl: text("review_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertReviewRequestSchema = createInsertSchema(reviewRequestsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type ReviewRequest = typeof reviewRequestsTable.$inferSelect;
export type InsertReviewRequest = z.infer<typeof insertReviewRequestSchema>;
