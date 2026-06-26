import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";

// Append-only audit log for all SMS consent state changes.
// No update or delete paths exist for this table — every transition is a new row.
export const smsConsentEventsTable = pgTable("sms_consent_events", {
  id: serial("id").primaryKey(),
  // Who the event applies to (exactly one of subjectType+subjectId identifies the row)
  subjectType: text("subject_type").notNull(), // "customer" | "company"
  subjectId: integer("subject_id").notNull(),
  phone: text("phone"),
  // What happened
  eventType: text("event_type").notNull(), // "opt_in" | "opt_out" | "stop" | "start" | "help" | "pref_update"
  keyword: text("keyword"), // raw inbound keyword when triggered by SMS (e.g. "STOP", "START")
  source: text("source").notNull(), // "registration_form" | "booking_form" | "portal_prefs" | "inbound_sms" | "admin" | "api"
  // Category preference snapshot for pref_update events
  prefCategory: text("pref_category"), // "appointments" | "estimates" | "invoices" | "service_updates" | null
  prefValue: text("pref_value"),       // "true" | "false" | null
  // Request metadata — captured server-side, never from client body
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type SmsConsentEvent = typeof smsConsentEventsTable.$inferSelect;
export type InsertSmsConsentEvent = typeof smsConsentEventsTable.$inferInsert;
