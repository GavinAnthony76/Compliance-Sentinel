import { pgTable, serial, integer, boolean, timestamp, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Default number of dormant days before a platform admin is locked out, used
// when no platform settings row has been configured yet.
export const DEFAULT_STALE_ADMIN_DAYS = 90;

// Default platform contact addresses. These seed the singleton settings row so
// the marketing site, legal pages, and outbound contact form all resolve their
// addresses from one source (the DB) instead of hardcoded frontend literals.
export const DEFAULT_CONTACT_EMAIL_GENERAL = "hello@greensynk.com";
export const DEFAULT_CONTACT_EMAIL_SUPPORT = "support@greensynk.com";
export const DEFAULT_CONTACT_EMAIL_SALES = "sales@greensynk.com";
export const DEFAULT_CONTACT_EMAIL_PRIVACY = "privacy@greensynk.com";
export const DEFAULT_CONTACT_EMAIL_LEGAL = "legal@greensynk.com";

// Platform-wide configuration. Modeled as a singleton row (id = 1) so settings
// shared across the whole platform live in one place rather than being
// hardcoded constants.
export const platformSettingsTable = pgTable("platform_settings", {
  id: serial("id").primaryKey(),
  // Days of inactivity (no sign-in) before a platform admin is considered
  // dormant and eligible for automatic/manual lockout.
  staleAdminDays: integer("stale_admin_days").notNull().default(DEFAULT_STALE_ADMIN_DAYS),
  // Whether the daily scheduled dormancy sweep runs at all. When false, the
  // manual "deactivate inactive" button still works but the automated sweep is
  // a no-op.
  staleAdminSweepEnabled: boolean("stale_admin_sweep_enabled").notNull().default(true),
  // Public-facing platform contact addresses. Sourced here (not hardcoded in the
  // frontend) so the contact/legal pages and the outbound contact form all read
  // from one place.
  contactEmailGeneral: text("contact_email_general").notNull().default(DEFAULT_CONTACT_EMAIL_GENERAL),
  contactEmailSupport: text("contact_email_support").notNull().default(DEFAULT_CONTACT_EMAIL_SUPPORT),
  contactEmailSales: text("contact_email_sales").notNull().default(DEFAULT_CONTACT_EMAIL_SALES),
  contactEmailPrivacy: text("contact_email_privacy").notNull().default(DEFAULT_CONTACT_EMAIL_PRIVACY),
  contactEmailLegal: text("contact_email_legal").notNull().default(DEFAULT_CONTACT_EMAIL_LEGAL),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPlatformSettingsSchema = createInsertSchema(platformSettingsTable).omit({
  id: true,
  updatedAt: true,
});

export type PlatformSettings = typeof platformSettingsTable.$inferSelect;
export type InsertPlatformSettings = z.infer<typeof insertPlatformSettingsSchema>;
