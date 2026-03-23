import { pgTable, serial, text, timestamp, integer, boolean, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";
import { customersTable } from "./customers";

export const recurringPlansTable = pgTable("recurring_plans", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  propertyId: integer("property_id"),
  serviceId: integer("service_id"),
  frequencyType: text("frequency_type").notNull(),
  intervalValue: integer("interval_value"),
  dayOfWeek: integer("day_of_week"),
  dayOfMonth: integer("day_of_month"),
  nextRunAt: timestamp("next_run_at"),
  isActive: boolean("is_active").notNull().default(true),
  autopayEnabled: boolean("autopay_enabled").notNull().default(false),
  price: numeric("price", { precision: 10, scale: 2 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertRecurringPlanSchema = createInsertSchema(recurringPlansTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type RecurringPlan = typeof recurringPlansTable.$inferSelect;
export type InsertRecurringPlan = z.infer<typeof insertRecurringPlanSchema>;
