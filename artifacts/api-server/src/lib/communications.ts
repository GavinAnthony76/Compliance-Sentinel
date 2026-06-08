import { db } from "@workspace/db";
import { communicationEventsTable } from "@workspace/db";

export async function logCommunicationEvent(opts: {
  companyId: number;
  customerId?: number | null;
  leadId?: number | null;
  appointmentId?: number | null;
  estimateId?: number | null;
  invoiceId?: number | null;
  channel: string;
  direction?: "outbound" | "inbound";
  subject?: string | null;
  bodyPreview?: string | null;
  status?: string;
  metadata?: Record<string, any> | null;
  createdByUserId?: number | null;
}): Promise<void> {
  try {
    await db.insert(communicationEventsTable).values({
      companyId: opts.companyId,
      customerId: opts.customerId ?? null,
      leadId: opts.leadId ?? null,
      appointmentId: opts.appointmentId ?? null,
      estimateId: opts.estimateId ?? null,
      invoiceId: opts.invoiceId ?? null,
      channel: opts.channel,
      direction: opts.direction ?? "outbound",
      subject: opts.subject ?? null,
      bodyPreview: opts.bodyPreview ? opts.bodyPreview.slice(0, 280) : null,
      status: opts.status ?? "logged",
      metadataJson: opts.metadata ?? null,
      createdByUserId: opts.createdByUserId ?? null,
    });
  } catch {
    // Communication logging should never break the main flow
  }
}
