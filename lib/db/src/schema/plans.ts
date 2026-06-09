import { pgTable, text, integer, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Subscription plan catalog — the single source of truth for everything shown
 * on the public landing page and the in-app billing page (name, price, tagline,
 * marketing feature bullets) as well as the numeric usage limits enforced by the
 * API. Edit a row here to change a plan everywhere. The set of *features* a plan
 * unlocks for access control lives in code (api-server lib/features.ts) because
 * it is wired into individual routes.
 */
export const plansTable = pgTable("plans", {
  // Slug used as the plan identifier everywhere (e.g. "starter", "growth", "pro").
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  price: integer("price").notNull(),
  interval: text("interval").notNull().default("month"),
  tagline: text("tagline").notNull().default(""),
  // Ordered list of marketing bullets displayed on pricing surfaces.
  features: jsonb("features").$type<string[]>().notNull().default([]),
  // Numeric usage limits. null = unlimited.
  maxUsers: integer("max_users"),
  maxCustomers: integer("max_customers"),
  maxAppointmentsPerMonth: integer("max_appointments_per_month"),
  maxEstimatesPerMonth: integer("max_estimates_per_month"),
  maxInvoicesPerMonth: integer("max_invoices_per_month"),
  isPopular: boolean("is_popular").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPlanSchema = createInsertSchema(plansTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type PlanRow = typeof plansTable.$inferSelect;
export type InsertPlanRow = z.infer<typeof insertPlanSchema>;
