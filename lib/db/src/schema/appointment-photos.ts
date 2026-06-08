import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";
import { appointmentsTable } from "./appointments";

export const appointmentPhotosTable = pgTable("appointment_photos", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  appointmentId: integer("appointment_id").notNull().references(() => appointmentsTable.id, { onDelete: "cascade" }),
  uploadedByUserId: integer("uploaded_by_user_id"),
  type: text("type").notNull().default("general"),
  fileUrl: text("file_url").notNull(),
  fileKey: text("file_key").notNull(),
  originalFileName: text("original_file_name"),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  caption: text("caption"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAppointmentPhotoSchema = createInsertSchema(appointmentPhotosTable).omit({
  id: true,
  createdAt: true,
});

export type AppointmentPhoto = typeof appointmentPhotosTable.$inferSelect;
export type InsertAppointmentPhoto = z.infer<typeof insertAppointmentPhotoSchema>;
