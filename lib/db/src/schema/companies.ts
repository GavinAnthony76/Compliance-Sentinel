import { pgTable, serial, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const companiesTable = pgTable("companies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logoUrl: text("logo_url"),
  primaryColor: text("primary_color"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  website: text("website"),
  timezone: text("timezone").default("America/New_York"),
  subscriptionPlan: text("subscription_plan"),
  subscriptionStatus: text("subscription_status"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  trialEndsAt: timestamp("trial_ends_at"),
  currentPeriodEnd: timestamp("current_period_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false),
  reviewUrl: text("review_url"),
  internalNotes: text("internal_notes"),
  isActive: boolean("is_active").notNull().default(true),
  betaEnabled: boolean("beta_enabled").notNull().default(false),
  // Payment acceptance configuration
  acceptedPaymentMethods: text("accepted_payment_methods"),
  paymentInstructions: text("payment_instructions"),
  zelleInfo: text("zelle_info"),
  venmoHandle: text("venmo_handle"),
  cashAppTag: text("cash_app_tag"),
  checkPayableTo: text("check_payable_to"),
  stripeConnectAccountId: text("stripe_connect_account_id"),
  nextInvoiceSeq: integer("next_invoice_seq").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCompanySchema = createInsertSchema(companiesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Company = typeof companiesTable.$inferSelect;
export type InsertCompany = z.infer<typeof insertCompanySchema>;
