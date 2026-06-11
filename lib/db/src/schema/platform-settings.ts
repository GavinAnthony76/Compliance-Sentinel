import { pgTable, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Default number of dormant days before a platform admin is locked out, used
// when no platform settings row has been configured yet.
export const DEFAULT_STALE_ADMIN_DAYS = 90;

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
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPlatformSettingsSchema = createInsertSchema(platformSettingsTable).omit({
  id: true,
  updatedAt: true,
});

export type PlatformSettings = typeof platformSettingsTable.$inferSelect;
export type InsertPlatformSettings = z.infer<typeof insertPlatformSettingsSchema>;
