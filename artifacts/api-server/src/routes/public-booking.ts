import { Router } from "express";
import { db, companiesTable, servicesTable, customersTable, propertiesTable, appointmentsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logActivity } from "../lib/activity";
import { z } from "zod";

const router = Router();

router.get("/book/:slug", async (req, res) => {
  const { slug } = req.params;
  const [company] = await db.select().from(companiesTable).where(and(eq(companiesTable.slug, slug), eq(companiesTable.isActive, true))).limit(1);
  if (!company) return res.status(404).json({ error: "NotFound", message: "Company not found" });

  const services = await db.select().from(servicesTable).where(and(eq(servicesTable.companyId, company.id), eq(servicesTable.isActive, true)));

  return res.json({
    companyName: company.name,
    logoUrl: company.logoUrl,
    primaryColor: company.primaryColor,
    phone: company.phone,
    services: services.map(s => ({ ...s, basePrice: s.basePrice ? Number(s.basePrice) : null })),
  });
});

const bookingSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().min(1),
  addressLine1: z.string().min(1),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  serviceId: z.number().int(),
  preferredDate: z.string().optional(),
  notes: z.string().optional(),
  gateNotes: z.string().optional(),
  yardSize: z.string().optional(),
});

router.post("/book/:slug/submit", async (req, res) => {
  const { slug } = req.params;
  const parsed = bookingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "ValidationError", message: parsed.error.message });
  }

  const [company] = await db.select().from(companiesTable).where(and(eq(companiesTable.slug, slug), eq(companiesTable.isActive, true))).limit(1);
  if (!company) return res.status(404).json({ error: "NotFound", message: "Company not found" });

  const data = parsed.data;

  let [customer] = await db.select().from(customersTable).where(and(
    eq(customersTable.companyId, company.id),
    data.email ? eq(customersTable.email, data.email) : eq(customersTable.phone, data.phone),
  )).limit(1);

  if (!customer) {
    [customer] = await db.insert(customersTable).values({
      companyId: company.id,
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email ?? null,
      phone: data.phone,
      addressLine1: data.addressLine1,
      city: data.city ?? null,
      state: data.state ?? null,
      zip: data.zip ?? null,
      leadSource: "booking_page",
      tags: [],
    }).returning();
  }

  const [property] = await db.insert(propertiesTable).values({
    companyId: company.id,
    customerId: customer.id,
    addressLine1: data.addressLine1,
    city: data.city ?? null,
    state: data.state ?? null,
    zip: data.zip ?? null,
    gateNotes: data.gateNotes ?? null,
    yardSize: data.yardSize ?? null,
  }).returning();

  const scheduledStart = data.preferredDate ? new Date(data.preferredDate) : new Date(Date.now() + 48 * 60 * 60 * 1000);

  const [appointment] = await db.insert(appointmentsTable).values({
    companyId: company.id,
    customerId: customer.id,
    propertyId: property.id,
    serviceId: data.serviceId,
    status: "pending",
    scheduledStart,
    notes: data.notes ?? null,
  }).returning();

  await logActivity({
    companyId: company.id,
    action: "booking.submitted",
    entityType: "appointment",
    entityId: appointment.id,
    metadata: { source: "booking_page", slug },
  });

  return res.status(201).json({
    success: true,
    message: "Your booking request has been submitted! We will contact you shortly to confirm.",
    appointmentId: appointment.id,
  });
});

export default router;
