import { pgTable, serial, text, timestamp, integer, json, boolean } from "drizzle-orm/pg-core";
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
  // Communication preferences (opt-out)
  emailOptOut: boolean("email_opt_out").notNull().default(false),
  smsOptOut: boolean("sms_opt_out").notNull().default(false),
  // SMS A2P consent — explicit opt-in captured at booking or portal invite
  smsOptIn: boolean("sms_opt_in").notNull().default(false),
  smsOptInAt: timestamp("sms_opt_in_at"),
  smsOptInSource: text("sms_opt_in_source"), // "booking_form" | "portal_invite" | "manual" | "import"
  smsOptOutAt: timestamp("sms_opt_out_at"),
  smsOptOutReason: text("sms_opt_out_reason"), // "STOP" | "STOPALL" | "UNSUBSCRIBE" | "CANCEL" | "END" | "QUIT" | "manual"
  // Per-category SMS preferences (all enabled by default when opted in)
  smsPrefAppointments: boolean("sms_pref_appointments").notNull().default(true),
  smsPrefEstimates: boolean("sms_pref_estimates").notNull().default(true),
  smsPrefInvoices: boolean("sms_pref_invoices").notNull().default(true),
  smsPrefServiceUpdates: boolean("sms_pref_service_updates").notNull().default(true),
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
