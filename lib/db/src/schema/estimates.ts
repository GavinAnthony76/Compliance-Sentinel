import { pgTable, serial, text, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";
import { customersTable } from "./customers";

export const estimatesTable = pgTable("estimates", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  propertyId: integer("property_id"),
  estimateNumber: text("estimate_number").notNull(),
  status: text("status").notNull().default("draft"),
  total: numeric("total", { precision: 10, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  // E-signature fields
  publicToken: text("public_token"),
  signedAt: timestamp("signed_at"),
  signatureData: text("signature_data"),
  signerName: text("signer_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertEstimateSchema = createInsertSchema(estimatesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Estimate = typeof estimatesTable.$inferSelect;
export type InsertEstimate = z.infer<typeof insertEstimateSchema>;
