import { pgTable, serial, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";

export const followUpCampaignsTable = pgTable("follow_up_campaigns", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  triggerType: text("trigger_type").notNull(),
  delayHours: integer("delay_hours").notNull().default(0),
  channel: text("channel").notNull().default("email"),
  subject: text("subject"),
  messageTemplate: text("message_template").notNull(),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const followUpLogsTable = pgTable("follow_up_logs", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  campaignId: integer("campaign_id").notNull().references(() => followUpCampaignsTable.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  customerId: integer("customer_id"),
  leadId: integer("lead_id"),
  channel: text("channel").notNull(),
  status: text("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertFollowUpCampaignSchema = createInsertSchema(followUpCampaignsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertFollowUpLogSchema = createInsertSchema(followUpLogsTable).omit({
  id: true,
  createdAt: true,
});

export type FollowUpCampaign = typeof followUpCampaignsTable.$inferSelect;
export type InsertFollowUpCampaign = z.infer<typeof insertFollowUpCampaignSchema>;
export type FollowUpLog = typeof followUpLogsTable.$inferSelect;
export type InsertFollowUpLog = z.infer<typeof insertFollowUpLogSchema>;
