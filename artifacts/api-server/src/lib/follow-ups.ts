import { db, followUpCampaignsTable, followUpLogsTable, customersTable, leadsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { sendEmail, sendSMS } from "./notifications";
import { logCommunicationEvent } from "./communications";

export const FOLLOW_UP_TRIGGERS = [
  "lead_created",
  "estimate_sent",
  "appointment_completed",
  "invoice_sent",
] as const;

export type FollowUpTrigger = (typeof FOLLOW_UP_TRIGGERS)[number];

interface EnqueueTarget {
  entityType: string;
  entityId: number;
  customerId?: number | null;
  leadId?: number | null;
}

// Create pending follow-up logs for every active campaign matching the trigger.
export async function enqueueFollowUps(
  companyId: number,
  triggerType: FollowUpTrigger,
  target: EnqueueTarget,
): Promise<void> {
  try {
    const campaigns = await db
      .select()
      .from(followUpCampaignsTable)
      .where(and(
        eq(followUpCampaignsTable.companyId, companyId),
        eq(followUpCampaignsTable.triggerType, triggerType),
        eq(followUpCampaignsTable.isActive, true),
      ));

    if (campaigns.length === 0) return;

    await db.insert(followUpLogsTable).values(
      campaigns.map(c => ({
        companyId,
        campaignId: c.id,
        entityType: target.entityType,
        entityId: target.entityId,
        customerId: target.customerId ?? null,
        leadId: target.leadId ?? null,
        channel: c.channel,
        status: "pending" as const,
      }))
    );
  } catch {
    // Non-fatal: enqueueing follow-ups must never break the main flow
  }
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key) => vars[key] ?? "");
}

interface Recipient {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  emailOptOut: boolean;
  smsOptOut: boolean;
}

async function resolveRecipient(log: typeof followUpLogsTable.$inferSelect): Promise<Recipient | null> {
  if (log.customerId) {
    const [c] = await db.select().from(customersTable)
      .where(and(eq(customersTable.id, log.customerId), eq(customersTable.companyId, log.companyId))).limit(1);
    if (!c) return null;
    return { firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone, emailOptOut: c.emailOptOut, smsOptOut: c.smsOptOut };
  }
  if (log.leadId) {
    const [l] = await db.select().from(leadsTable)
      .where(and(eq(leadsTable.id, log.leadId), eq(leadsTable.companyId, log.companyId))).limit(1);
    if (!l) return null;
    return { firstName: l.firstName, lastName: l.lastName, email: l.email, phone: l.phone, emailOptOut: false, smsOptOut: false };
  }
  return null;
}

// Process a single claimed, due log; returns the resulting status.
async function processLog(
  log: typeof followUpLogsTable.$inferSelect,
  campaign: typeof followUpCampaignsTable.$inferSelect,
): Promise<{ status: string; error?: string }> {
  const recipient = await resolveRecipient(log);
  if (!recipient) return { status: "failed", error: "Recipient not found" };

  const vars = {
    firstName: recipient.firstName,
    lastName: recipient.lastName,
    fullName: `${recipient.firstName} ${recipient.lastName}`.trim(),
  };
  const body = renderTemplate(campaign.messageTemplate, vars);
  const subject = campaign.subject ? renderTemplate(campaign.subject, vars) : "Following up";

  try {
    if (campaign.channel === "sms") {
      if (!recipient.phone) return { status: "failed", error: "No phone number" };
      if (recipient.smsOptOut) return { status: "skipped", error: "Recipient opted out of SMS" };
      await sendSMS({ to: recipient.phone, body });
    } else {
      if (!recipient.email) return { status: "failed", error: "No email address" };
      if (recipient.emailOptOut) return { status: "skipped", error: "Recipient opted out of email" };
      await sendEmail({ to: recipient.email, subject, body });
    }

    await logCommunicationEvent({
      companyId: log.companyId,
      customerId: log.customerId,
      leadId: log.leadId,
      channel: campaign.channel,
      subject,
      bodyPreview: body,
      status: "sent",
      metadata: { followUpCampaignId: campaign.id },
    });

    return { status: "sent" };
  } catch (err: any) {
    return { status: "failed", error: err?.message ?? "Send failed" };
  }
}

// Scheduler entry: process all pending follow-up logs that are due.
export async function processPendingFollowUps(): Promise<void> {
  try {
    const pending = await db.select().from(followUpLogsTable).where(eq(followUpLogsTable.status, "pending"));
    for (const log of pending) {
      try {
        const [campaign] = await db.select().from(followUpCampaignsTable)
          .where(and(eq(followUpCampaignsTable.id, log.campaignId), eq(followUpCampaignsTable.companyId, log.companyId))).limit(1);

        if (!campaign || !campaign.isActive) {
          await db.update(followUpLogsTable)
            .set({ status: "cancelled", errorMessage: "Campaign inactive or missing" })
            .where(and(eq(followUpLogsTable.id, log.id), eq(followUpLogsTable.status, "pending")));
          continue;
        }

        // Due check: createdAt + delayHours. Not yet due — leave pending.
        const dueAt = new Date(new Date(log.createdAt).getTime() + campaign.delayHours * 60 * 60 * 1000);
        if (Date.now() < dueAt.getTime()) continue;

        // Atomically claim the row so overlapping runs/instances cannot double-send.
        const claimed = await db.update(followUpLogsTable)
          .set({ status: "processing" })
          .where(and(eq(followUpLogsTable.id, log.id), eq(followUpLogsTable.status, "pending")))
          .returning({ id: followUpLogsTable.id });
        if (claimed.length === 0) continue; // another run already claimed it

        const result = await processLog(log, campaign);
        await db.update(followUpLogsTable)
          .set({
            status: result.status,
            errorMessage: result.error ?? null,
            sentAt: result.status === "sent" ? new Date() : null,
          })
          .where(eq(followUpLogsTable.id, log.id));
      } catch {
        // Non-fatal per log
      }
    }
  } catch {
    // Non-fatal scheduler errors
  }
}

// Send a one-off test message immediately for a campaign to a given recipient.
export async function sendTestFollowUp(
  campaign: typeof followUpCampaignsTable.$inferSelect,
  to: { email?: string | null; phone?: string | null; firstName?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const vars = { firstName: to.firstName ?? "there", lastName: "", fullName: to.firstName ?? "there" };
  const body = renderTemplate(campaign.messageTemplate, vars);
  const subject = campaign.subject ? renderTemplate(campaign.subject, vars) : "Test follow-up";
  try {
    if (campaign.channel === "sms") {
      if (!to.phone) return { ok: false, error: "No phone number provided" };
      await sendSMS({ to: to.phone, body });
    } else {
      if (!to.email) return { ok: false, error: "No email address provided" };
      await sendEmail({ to: to.email, subject, body });
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Send failed" };
  }
}
