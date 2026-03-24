import { db, automationRulesTable, reviewRequestsTable, invoicesTable, customersTable, companiesTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { sendReviewRequestNotification, sendEmail } from "./notifications";
import { logActivity } from "./activity";

export interface AutomationContext {
  customerId: number;
  userId?: number;
  appointmentId?: number;
  invoiceId?: number;
  appointmentPrice?: number | null;
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
  const { customerId, userId, appointmentId, appointmentPrice } = ctx;

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

    case "create_invoice": {
      if (!appointmentId) return;
      const [countResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(invoicesTable)
        .where(eq(invoicesTable.companyId, companyId));
      const invoiceNum = `INV-${String(Number(countResult.count) + 1).padStart(4, "0")}`;
      const price = appointmentPrice ?? 0;
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 14);

      await db.insert(invoicesTable).values({
        companyId,
        customerId,
        invoiceNumber: invoiceNum,
        subtotal: String(price),
        tax: "0",
        total: String(price),
        status: "sent",
        dueDate,
        notes: `Auto-generated for appointment #${appointmentId}`,
      });

      await logActivity({
        companyId,
        userId,
        action: "automation.invoice_created",
        entityType: "automation",
        entityId: rule.id,
        metadata: { ruleId: rule.id, triggerType: rule.triggerType, appointmentId },
      });
      break;
    }

    default:
      // Unknown action type — skip silently
      break;
  }
}
