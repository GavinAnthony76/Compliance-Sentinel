import { Router } from "express";
import { db, companiesTable, servicesTable, customersTable, propertiesTable, appointmentsTable, leadsTable } from "@workspace/db";
import { eq, and, isNotNull, inArray, sql } from "drizzle-orm";
import { logActivity } from "../lib/activity";
import { hasFeature, checkPlanLimit } from "../lib/features";
import { appendSmsConsentEvent } from "../lib/sms-consent";
import { enqueueFollowUps } from "../lib/follow-ups";
import { sendBookingRequestNotification, sendBookingConfirmationEmail } from "../lib/notifications";
import { logger } from "../lib/logger";
import { z } from "zod";

const router = Router();

// Max unreviewed (pending) public booking requests a single submitter (matched
// by email, or phone when no email is given) may have open with a company at
// once. Mirrors MAX_PENDING_PORTAL_REQUESTS on the authenticated portal route:
// each request emails the company, so without a cap anyone rotating IPs (or
// scripting slowly under the IP rate limit) can flood the owner's inbox.
export const MAX_PENDING_PUBLIC_REQUESTS = 5;

router.get("/sitemap-slugs", async (_req, res) => {
  const rows = await db
    .select({ slug: companiesTable.slug, updatedAt: companiesTable.updatedAt })
    .from(companiesTable)
    .where(and(eq(companiesTable.isActive, true), isNotNull(companiesTable.slug)));
  return res.json(rows.map(r => ({ slug: r.slug, updatedAt: r.updatedAt })));
});

router.get("/book/:slug", async (req, res) => {
  const { slug } = req.params;
  const [company] = await db.select().from(companiesTable).where(and(eq(companiesTable.slug, slug), eq(companiesTable.isActive, true))).limit(1);
  if (!company) return res.status(404).json({ error: "NotFound", message: "Company not found" });

  const services = await db.select().from(servicesTable).where(and(eq(servicesTable.companyId, company.id), eq(servicesTable.isActive, true)));

  // Branded booking pages (logo/colors) are Growth+; full white-label (no GreenSynk branding) is Pro-only.
  const branded = hasFeature(company.subscriptionPlan, "branded_booking_page");
  const whiteLabel = hasFeature(company.subscriptionPlan, "white_label_booking");

  return res.json({
    companyName: company.name,
    logoUrl: branded ? company.logoUrl : null,
    primaryColor: branded ? company.primaryColor : null,
    phone: company.phone,
    email: company.email,
    address: company.address,
    city: company.city,
    state: company.state,
    zip: company.zip,
    website: company.website,
    whiteLabel,
    services: services.map(s => ({ ...s, basePrice: s.basePrice ? Number(s.basePrice) : null })),
  });
});

const bookingSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().optional(),
  phone: z.string().min(1).max(30),
  addressLine1: z.string().min(1).max(500),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  zip: z.string().max(20).optional(),
  serviceId: z.number().int(),
  preferredDate: z.string().optional(),
  notes: z.string().max(2000).optional(),
  gateNotes: z.string().max(500).optional(),
  yardSize: z.string().max(50).optional(),
  smsConsent: z.boolean().optional(),
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

  // Validate serviceId belongs to this company so a crafted request cannot
  // reference another tenant's service catalog entry.
  const [service] = await db.select({ id: servicesTable.id }).from(servicesTable)
    .where(and(eq(servicesTable.id, data.serviceId), eq(servicesTable.companyId, company.id), eq(servicesTable.isActive, true)))
    .limit(1);
  if (!service) return res.status(400).json({ error: "ValidationError", message: "Invalid service selection" });

  const scheduledStart = data.preferredDate ? new Date(data.preferredDate) : new Date(Date.now() + 48 * 60 * 60 * 1000);

  // Cap unreviewed booking requests per submitter, atomically. Submissions
  // are matched to a customer row by email (or phone when no email is given),
  // but there is NO unique constraint on (company, email/phone) — so the
  // customer lookup/creation MUST happen inside the same locked transaction
  // as the pending-count admission. Otherwise N concurrent first-time
  // requests with the same identity all see "no customer", create N distinct
  // rows, and each admit a request (and an email) past the cap.
  //
  // The advisory lock key is derived from the company plus the NORMALIZED
  // submitter identity (lowercased email, else digits-only phone), so
  // concurrent submissions from the same address serialize even before any
  // customer row exists. Other submitters take different keys and are
  // unaffected. The lock is released automatically at commit/rollback.
  // Canonical identity: lowercased/trimmed email, else digits-only phone.
  // Lookup, lock, and pending count all use the SAME canonical form, so
  // "Person@Example.com" vs "person@example.com" or "(555) 123-4567" vs
  // "5551234567" cannot mint separate customer rows with separate caps.
  const canonicalEmail = data.email ? data.email.trim().toLowerCase() : null;
  const canonicalPhone = data.phone.replace(/\D/g, "");
  const identity = canonicalEmail ? `e:${canonicalEmail}` : `p:${canonicalPhone}`;
  const identityCondition = canonicalEmail
    ? sql`lower(trim(${customersTable.email})) = ${canonicalEmail}`
    : sql`regexp_replace(coalesce(${customersTable.phone}, ''), '[^0-9]', '', 'g') = ${canonicalPhone}`;

  const admission = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`public_booking:${company.id}:${identity}`}))`);

    // Fetch ALL customer rows matching the canonical identity — there is no
    // unique constraint, so pre-existing duplicates are possible and the cap
    // must count pending requests across every one of them.
    const matchingCustomers = await tx.select().from(customersTable).where(and(
      eq(customersTable.companyId, company.id),
      identityCondition,
    )).orderBy(customersTable.id);

    let customer = matchingCustomers[0];

    let createdCustomer = false;
    if (!customer) {
      // Public booking creates a brand-new customer record directly (when the company
      // doesn't have lead-pipeline / Pro-only unlimited customers) — respect the same
      // company-scoped customer cap that authenticated staff are bound by, so the
      // public form can't be used to bypass plan limits.
      const limitCheck = await checkPlanLimit(company.id, "customers");
      if (!limitCheck.allowed) {
        return { outcome: "plan_limited" as const };
      }

      [customer] = await tx.insert(customersTable).values({
        companyId: company.id,
        firstName: data.firstName,
        lastName: data.lastName,
        email: canonicalEmail,
        phone: data.phone,
        addressLine1: data.addressLine1,
        city: data.city ?? null,
        state: data.state ?? null,
        zip: data.zip ?? null,
        leadSource: "booking_page",
        tags: [],
        ...(data.smsConsent ? { smsOptIn: true, smsOptInAt: new Date(), smsOptInSource: "booking_form" } : {}),
      }).returning();
      createdCustomer = true;
    }

    // Count pending requests across EVERY customer row matching the
    // canonical identity, so pre-existing duplicates share one cap.
    const matchingIds = matchingCustomers.map((c) => c.id);
    if (!matchingIds.includes(customer.id)) matchingIds.push(customer.id);
    const [{ pendingCount }] = await tx
      .select({ pendingCount: sql<number>`count(*)::int` })
      .from(appointmentsTable)
      .where(and(
        inArray(appointmentsTable.customerId, matchingIds),
        eq(appointmentsTable.companyId, company.id),
        eq(appointmentsTable.origin, "portal_request"),
        eq(appointmentsTable.status, "pending"),
      ));
    if (pendingCount >= MAX_PENDING_PUBLIC_REQUESTS) {
      // Only an EXISTING customer can be capped (a just-created row has zero
      // pending requests), so there is no partial write to undo here.
      return { outcome: "capped" as const };
    }

    const [property] = await tx.insert(propertiesTable).values({
      companyId: company.id,
      customerId: customer.id,
      addressLine1: data.addressLine1,
      city: data.city ?? null,
      state: data.state ?? null,
      zip: data.zip ?? null,
      gateNotes: data.gateNotes ?? null,
      yardSize: data.yardSize ?? null,
    }).returning();

    const [appointment] = await tx.insert(appointmentsTable).values({
      companyId: company.id,
      customerId: customer.id,
      propertyId: property.id,
      serviceId: data.serviceId,
      status: "pending",
      scheduledStart,
      notes: data.notes ?? null,
      origin: "portal_request",
    }).returning();
    return { outcome: "admitted" as const, customer, createdCustomer, property, appointment };
  });

  if (admission.outcome === "plan_limited") {
    return res.status(409).json({
      error: "BookingUnavailable",
      message: "We're unable to accept new customer bookings online right now. Please contact us directly to schedule.",
    });
  }
  if (admission.outcome === "capped") {
    return res.status(429).json({
      error: "TooManyRequests",
      message: "You already have several booking requests awaiting review with this company. Please wait for them to get back to you, or contact them directly.",
    });
  }
  const { customer, createdCustomer, property, appointment } = admission;

  // SMS consent bookkeeping happens after admission so a capped/rejected
  // request records nothing.
  if (data.smsConsent && createdCustomer) {
    // New customer created with opt-in flags — record the audit event.
    await appendSmsConsentEvent({
      subjectType: "customer",
      subjectId: customer.id,
      phone: data.phone,
      eventType: "opt_in",
      source: "booking_form",
      ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
    });
  } else if (data.smsConsent && !customer.smsOptIn) {
    // Existing customer who newly checked the SMS consent box
    await db.update(customersTable).set({ smsOptIn: true, smsOptInAt: new Date(), smsOptInSource: "booking_form", smsOptOut: false, updatedAt: new Date() }).where(eq(customersTable.id, customer.id));
    await appendSmsConsentEvent({
      subjectType: "customer",
      subjectId: customer.id,
      phone: data.phone,
      eventType: "opt_in",
      source: "booking_form",
      ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
    });
  }

  await logActivity({
    companyId: company.id,
    action: "booking.submitted",
    entityType: "appointment",
    entityId: appointment.id,
    metadata: { source: "booking_page", slug },
  });

  // Notify the business AND confirm to the customer that the request came in
  // (fire-and-forget — never block the booking response on email).
  void (async () => {
    try {
      let serviceName: string | null = null;
      if (data.serviceId) {
        const [svc] = await db.select({ name: servicesTable.name }).from(servicesTable).where(and(eq(servicesTable.id, data.serviceId), eq(servicesTable.companyId, company.id))).limit(1);
        serviceName = svc?.name ?? null;
      }
      const address = [data.addressLine1, data.city, data.state, data.zip].filter(Boolean).join(", ") || null;
      const customerName = `${data.firstName} ${data.lastName}`.trim();

      const { resolveCompanyNotificationEmail } = await import("../lib/notifications");
      const companyNotifyEmail = await resolveCompanyNotificationEmail(company.id, company.email);
      if (companyNotifyEmail) {
        await sendBookingRequestNotification({
          companyEmail: companyNotifyEmail,
          companyName: company.name,
          customerName,
          customerEmail: data.email ?? null,
          customerPhone: data.phone ?? null,
          serviceName,
          address,
          preferredDate: data.preferredDate ? scheduledStart : null,
          notes: data.notes ?? null,
        });
      }

      if (data.email) {
        await sendBookingConfirmationEmail({
          to: data.email,
          customerName,
          companyName: company.name,
          companyEmail: company.email ?? undefined,
          companyPhone: company.phone ?? null,
          serviceName,
          preferredDate: data.preferredDate ? scheduledStart : null,
          address,
          logoUrl: company.logoUrl,
          primaryColor: company.primaryColor,
        });
      }
    } catch (err) {
      logger.error({ err, companyId: company.id }, "Failed to send booking notifications");
    }
  })();

  // Create a pipeline lead for companies that have the lead pipeline feature.
  if (hasFeature(company.subscriptionPlan, "lead_pipeline")) {
    try {
      const [lead] = await db.insert(leadsTable).values({
        companyId: company.id,
        customerId: customer.id,
        propertyId: property.id,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email ?? null,
        phone: data.phone,
        address: [data.addressLine1, data.city, data.state, data.zip].filter(Boolean).join(", "),
        source: "public_booking",
        status: "new",
        notes: data.notes ?? null,
      }).returning();
      await logActivity({
        companyId: company.id,
        action: "lead.created",
        entityType: "lead",
        entityId: lead.id,
        metadata: { source: "public_booking", appointmentId: appointment.id },
      });
      await enqueueFollowUps(company.id, "lead_created", { entityType: "lead", entityId: lead.id, customerId: customer.id, leadId: lead.id });
    } catch { /* non-fatal — booking already succeeded */ }
  }

  return res.status(201).json({
    success: true,
    message: "Your booking request has been submitted! We will contact you shortly to confirm.",
    appointmentId: appointment.id,
  });
});

export default router;
