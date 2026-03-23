import { pgTable, serial, text, timestamp, integer, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";

export const customersTable = pgTable("customers", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  addressLine1: text("address_line_1"),
  addressLine2: text("address_line_2"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  notes: text("notes"),
  leadSource: text("lead_source"),
  tags: json("tags").$type<string[]>().default([]),
  // Customer portal fields
  portalPasswordHash: text("portal_password_hash"),
  portalInviteToken: text("portal_invite_token"),
  portalInviteExpiresAt: timestamp("portal_invite_expires_at"),
  // Stripe payment method for autopay
  stripeCustomerId: text("stripe_customer_id"),
  stripePaymentMethodId: text("stripe_payment_method_id"),
  autopayEnabled: text("autopay_enabled").default("false"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCustomerSchema = createInsertSchema(customersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Customer = typeof customersTable.$inferSelect;
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
