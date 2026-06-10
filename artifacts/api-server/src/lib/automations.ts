import { db, automationRulesTable, reviewRequestsTable, invoicesTable, invoiceLineItemsTable, customersTable, companiesTable, appointmentsTable, servicesTable } from "@workspace/db";
import { eq, and, sql, gte, lte } from "drizzle-orm";
import { sendReviewRequestNotification, sendEmail, sendSMS } from "./notifications";
import { dispatchInvoiceEmail } from "./invoice-email";
import { logActivity } from "./activity";

export interface AutomationContext {
  customerId: number;
  userId?: number;
  appointmentId?: number;
  invoiceId?: number;
  appointmentPrice?: number | null;
  appointmentServiceId?: number | null;
}

/**
 * Find all active automation rules for a company with the given trigger type
 * and execute each action. Non-fatal — individual action failures are swallowed
 * so the calling route is never blocked.
 */
export async function fireAutomations(
  companyId: number,
  triggerType: string,
  ctx: AutomationContext,
): Promise<void> {
  try {
    const rules = await db
      .select()
      .from(automationRulesTable)
      .where(
        and(
          eq(automationRulesTable.companyId, companyId),
          eq(automationRulesTable.triggerType, triggerType),
          eq(automationRulesTable.isActive, true),
        ),
      );

    if (rules.length === 0) return;

    const [company] = await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.id, companyId))
      .limit(1);

    const reviewUrl = (company as any)?.reviewUrl || "https://g.page/review";
    const companyName = company?.name || "Your Service Provider";

    for (const rule of rules) {
      try {
        await executeAction(rule, companyId, companyName, reviewUrl, ctx);
      } catch (_err) {
        // Non-fatal: one action failure should not block others
      }
    }
  } catch (_err) {
    // Non-fatal: automation engine failure should not block the calling route
  }
}

async function executeAction(
  rule: any,
  companyId: number,
  companyName: string,
  reviewUrl: string,
  ctx: AutomationContext,
): Promise<void> {
  const { customerId, userId, appointmentId, appointmentPrice, appointmentServiceId } = ctx;

  switch (rule.actionType) {
    case "send_review_request": {
      const [customer] = await db
        .select()
        .from(customersTable)
        .where(eq(customersTable.id, customerId))
        .limit(1);
      if (!customer) return;

      await db.insert(reviewRequestsTable).values({
        companyId,
        customerId,
        appointmentId: appointmentId ?? null,
        channel: customer.phone ? "sms" : "email",
        status: "sent",
        reviewUrl,
        sentAt: new Date(),
      });

      await sendReviewRequestNotification({
        customerName: `${customer.firstName} ${customer.lastName}`,
        customerEmail: customer.email ?? undefined,
        customerPhone: customer.phone ?? undefined,
        reviewUrl,
        companyName,
        channel: customer.phone ? "sms" : "email",
      });

      await logActivity({
        companyId,
        userId,
        action: "automation.review_request_sent",
        entityType: "automation",
        entityId: rule.id,
        metadata: { ruleId: rule.id, triggerType: rule.triggerType, customerId },
      });
      break;
    }

    case "send_follow_up_email": {
      const [customer] = await db
        .select()
        .from(customersTable)
        .where(eq(customersTable.id, customerId))
        .limit(1);
      if (!customer?.email) return;

      await sendEmail({
        to: customer.email,
        subject: `Thank you for choosing ${companyName}!`,
        body: `Hi ${customer.firstName},\n\nThank you for your recent service with ${companyName}. We appreciate your business and hope you were happy with the results!\n\nIf you have any questions or would like to schedule your next appointment, please don't hesitate to reach out.\n\nThank you,\n${companyName}`,
      });

      await logActivity({
        companyId,
        userId,
        action: "automation.follow_up_email_sent",
        entityType: "automation",
        entityId: rule.id,
        metadata: { ruleId: rule.id, triggerType: rule.triggerType, customerId },
      });
      break;
    }

    case "send_sms_reminder": {
      const [customer] = await db
        .select()
        .from(customersTable)
        .where(eq(customersTable.id, customerId))
        .limit(1);
      if (!customer?.phone) return;

      let message = `Hi ${customer.firstName}, this is a reminder from ${companyName}.`;
      if (appointmentId) {
        const [appt] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, appointmentId)).limit(1);
        if (appt) {
          const dateStr = new Date(appt.scheduledStart).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
          const timeStr = new Date(appt.scheduledStart).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
          message = `Hi ${customer.firstName}, reminder: your appointment with ${companyName} is on ${dateStr} at ${timeStr}. Reply STOP to opt out.`;
        }
      }

      await sendSMS({ to: customer.phone, body: message });

      await logActivity({
        companyId,
        userId,
        action: "automation.sms_reminder_sent",
        entityType: "automation",
        entityId: rule.id,
        metadata: { ruleId: rule.id, triggerType: rule.triggerType, customerId },
      });
      break;
    }

    case "create_invoice": {
      if (!appointmentId) return;

      // Check for duplicate: skip if invoice already exists for this appointment
      const [existingInv] = await db.select({ id: invoicesTable.id }).from(invoicesTable)
        .where(and(eq(invoicesTable.appointmentId, appointmentId), eq(invoicesTable.companyId, companyId)))
        .limit(1);
      if (existingInv) return;

      // Fetch service for line item details
      let serviceName = "Service Rendered";
      let price = appointmentPrice ?? 0;
      if (appointmentServiceId) {
        const [svc] = await db.select().from(servicesTable).where(eq(servicesTable.id, appointmentServiceId)).limit(1);
        if (svc) {
          serviceName = svc.name;
          if (!appointmentPrice && svc.basePrice) price = Number(svc.basePrice);
        }
      } else if (!appointmentServiceId) {
        // Try to get service from the appointment record
        const [appt] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, appointmentId)).limit(1);
        if (appt?.serviceId) {
          const [svc] = await db.select().from(servicesTable).where(eq(servicesTable.id, appt.serviceId)).limit(1);
          if (svc) {
            serviceName = svc.name;
            if (!appointmentPrice && svc.basePrice) price = Number(svc.basePrice);
          }
        }
      }

      const [countResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(invoicesTable)
        .where(eq(invoicesTable.companyId, companyId));
      const invoiceNum = `INV-${String(Number(countResult.count) + 1).padStart(4, "0")}`;
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 14);

      // Create as "draft" first; only promote to "sent" once the branded
      // invoice email has actually been dispatched, so status reflects reality.
      const [newInv] = await db.insert(invoicesTable).values({
        companyId,
        customerId,
        appointmentId,
        invoiceNumber: invoiceNum,
        subtotal: String(price),
        tax: "0",
        total: String(price),
        status: "draft",
        dueDate,
        notes: `Auto-generated for appointment #${appointmentId}`,
      }).returning();

      // Insert line item with service name
      await db.insert(invoiceLineItemsTable).values({
        invoiceId: newInv.id,
        description: serviceName,
        quantity: "1",
        unitPrice: String(price),
        lineTotal: String(price),
        sortOrder: 0,
      });

      // Dispatch the branded invoice email with payable link; mark "sent" only on real delivery.
      const emailed = await dispatchInvoiceEmail(newInv.id, companyId);
      if (emailed) {
        await db.update(invoicesTable).set({ status: "sent", updatedAt: new Date() }).where(eq(invoicesTable.id, newInv.id));
      }

      await logActivity({
        companyId,
        userId,
        action: "automation.invoice_created",
        entityType: "automation",
        entityId: rule.id,
        metadata: { ruleId: rule.id, triggerType: rule.triggerType, appointmentId, invoiceId: newInv.id, emailed },
      });
      break;
    }

    default:
      // Unknown action type — skip silently
      break;
  }
}

/**
 * Dry-run version of executeAction: loads all the same data and evaluates
 * conditions, but skips actual sends and DB writes. Returns a structured
 * result describing exactly what would have happened.
 */
export async function executeActionDryRun(
  rule: any,
  companyId: number,
  ctx: AutomationContext,
): Promise<{ eligible: boolean; outcome: string; details: Record<string, unknown> }> {
  const { customerId, appointmentId, appointmentPrice, appointmentServiceId } = ctx;

  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
  const companyName = company?.name ?? "Your Company";
  const reviewUrl = company?.reviewUrl ?? "https://g.page/review";

  switch (rule.actionType) {
    case "send_review_request": {
      const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, customerId)).limit(1);
      if (!customer) return { eligible: false, outcome: "Customer not found", details: {} };
      const channel = customer.phone ? "sms" : customer.email ? "email" : null;
      if (!channel) return { eligible: false, outcome: "Customer has no phone or email", details: {} };
      return {
        eligible: true,
        outcome: `Would send a review request ${channel.toUpperCase()} to ${customer.firstName || "customer"} (${customer.phone || customer.email})`,
        details: { channel, reviewUrl, customerName: `${customer.firstName} ${customer.lastName}`.trim() },
      };
    }

    case "send_follow_up_email": {
      const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, customerId)).limit(1);
      if (!customer?.email) return { eligible: false, outcome: "Customer has no email address", details: {} };
      return {
        eligible: true,
        outcome: `Would send a thank-you email to ${customer.firstName || "customer"} at ${customer.email}`,
        details: {
          to: customer.email,
          subject: `Thank you for choosing ${companyName}!`,
          preview: `Hi ${customer.firstName}, thank you for your recent service with ${companyName}...`,
        },
      };
    }

    case "send_sms_reminder": {
      const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, customerId)).limit(1);
      if (!customer?.phone) return { eligible: false, outcome: "Customer has no phone number for SMS", details: {} };
      let message = `Hi ${customer.firstName}, this is a reminder from ${companyName}.`;
      if (appointmentId) {
        const [appt] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, appointmentId)).limit(1);
        if (appt) {
          const dateStr = new Date(appt.scheduledStart).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
          const timeStr = new Date(appt.scheduledStart).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
          message = `Hi ${customer.firstName}, reminder: your appointment with ${companyName} is on ${dateStr} at ${timeStr}. Reply STOP to opt out.`;
        }
      }
      return {
        eligible: true,
        outcome: `Would send SMS to ${customer.phone}: "${message}"`,
        details: { to: customer.phone, message },
      };
    }

    case "create_invoice": {
      if (!appointmentId) return { eligible: false, outcome: "No appointment in context — rule requires appointment_completed trigger", details: {} };
      const [existingInv] = await db.select({ id: invoicesTable.id }).from(invoicesTable)
        .where(and(eq(invoicesTable.appointmentId, appointmentId), eq(invoicesTable.companyId, companyId))).limit(1);
      if (existingInv) return { eligible: false, outcome: `Invoice already exists for appointment #${appointmentId} (INV #${existingInv.id}) — would skip`, details: { existingInvoiceId: existingInv.id } };

      let serviceName = "Service Rendered";
      let price = appointmentPrice ?? 0;
      if (appointmentServiceId) {
        const [svc] = await db.select().from(servicesTable).where(eq(servicesTable.id, appointmentServiceId)).limit(1);
        if (svc) { serviceName = svc.name; if (!appointmentPrice && svc.basePrice) price = Number(svc.basePrice); }
      } else {
        const [appt] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, appointmentId)).limit(1);
        if (appt?.serviceId) {
          const [svc] = await db.select().from(servicesTable).where(eq(servicesTable.id, appt.serviceId)).limit(1);
          if (svc) { serviceName = svc.name; if (!appointmentPrice && svc.basePrice) price = Number(svc.basePrice); }
        }
      }
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 14);
      return {
        eligible: true,
        outcome: `Would create and send invoice for "${serviceName}" ($${Number(price).toFixed(2)}) due ${dueDate.toLocaleDateString()}`,
        details: { serviceName, total: price, dueDate: dueDate.toISOString(), status: "sent" },
      };
    }

    default:
      return { eligible: false, outcome: `Unknown action type: ${rule.actionType}`, details: {} };
  }
}

/**
 * Background scheduler: runs every 5 minutes, checks for appointments
 * scheduled 24–25 hours from now and fires appointment_upcoming_24h automations.
 */
export function startAutomationScheduler(): void {
  const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  async function checkUpcomingAppointments() {
    try {
      const now = new Date();
      const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const in25h = new Date(now.getTime() + 25 * 60 * 60 * 1000);

      // Find appointments in the 24–25h window that haven't had a reminder sent
      const upcoming = await db.select().from(appointmentsTable)
        .where(
          and(
            eq(appointmentsTable.reminderSent, false),
            gte(appointmentsTable.scheduledStart, in24h),
            lte(appointmentsTable.scheduledStart, in25h),
          )
        );

      for (const appt of upcoming) {
        try {
          // Check if company has any active appointment_upcoming_24h automation rules
          const rules = await db.select().from(automationRulesTable)
            .where(and(
              eq(automationRulesTable.companyId, appt.companyId),
              eq(automationRulesTable.triggerType, "appointment_upcoming_24h"),
              eq(automationRulesTable.isActive, true),
            ));

          if (rules.length > 0) {
            await fireAutomations(appt.companyId, "appointment_upcoming_24h", {
              customerId: appt.customerId,
              appointmentId: appt.id,
              appointmentPrice: appt.price ? Number(appt.price) : null,
              appointmentServiceId: appt.serviceId,
            });
            // Only mark reminderSent after rules have actually fired,
            // so a company that enables a rule later can still reach this appointment
            await db.update(appointmentsTable)
              .set({ reminderSent: true, updatedAt: new Date() })
              .where(eq(appointmentsTable.id, appt.id));
          }
        } catch {
          // Non-fatal per appointment
        }
      }
    } catch {
      // Non-fatal scheduler errors
    }
  }

  // Run immediately on startup, then every 5 minutes
  checkUpcomingAppointments();
  setInterval(checkUpcomingAppointments, INTERVAL_MS);
}
