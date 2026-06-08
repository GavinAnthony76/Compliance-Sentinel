import { logger } from "./logger";

interface EmailPayload {
  to: string;
  subject: string;
  body: string;
}

interface SMSPayload {
  to: string;
  body: string;
}

const isDev = process.env.NODE_ENV !== "production";

function isSMSMockMode(): boolean {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_PHONE_NUMBER) {
    const msg = "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_PHONE_NUMBER is not set — SMS delivery is disabled";
    if (isDev) {
      logger.warn(`[SMS] ${msg}`);
    } else {
      logger.error(`[SMS] ${msg}`);
    }
    return true;
  }
  return false;
}

function isEmailMockMode(): boolean {
  if (!process.env.SENDGRID_API_KEY) {
    const msg = "SENDGRID_API_KEY is not set — email delivery is disabled";
    if (isDev) {
      logger.warn(`[Email] ${msg}`);
    } else {
      logger.error(`[Email] ${msg}`);
    }
    return true;
  }
  return false;
}

export function resolveBaseUrl(): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL;
  const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0];
  if (replitDomain) return `https://${replitDomain}`;
  return "http://localhost:3000";
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
  if (isEmailMockMode()) {
    logger.info({ mock: true, to: payload.to, subject: payload.subject }, "[MOCK EMAIL] Would send email");
    return;
  }

  try {
    const sgMail = (await import("@sendgrid/mail")).default;
    sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

    const fromAddress = process.env.SENDGRID_FROM_EMAIL || "noreply@greensync.app";

    await sgMail.send({
      from: fromAddress,
      to: payload.to,
      subject: payload.subject,
      text: payload.body,
    });

    logger.info({ to: payload.to, subject: payload.subject }, "Email sent via SendGrid");
  } catch (err) {
    logger.error({ err, to: payload.to, subject: payload.subject }, "Failed to send email via SendGrid");
  }
}

export async function sendSMS(payload: SMSPayload): Promise<void> {
  if (isSMSMockMode()) {
    logger.info({ mock: true, to: payload.to }, "[MOCK SMS] Would send SMS");
    return;
  }

  try {
    const twilio = (await import("twilio")).default;
    const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
    await client.messages.create({
      body: payload.body,
      from: process.env.TWILIO_PHONE_NUMBER!,
      to: payload.to,
    });
    logger.info({ to: payload.to }, "SMS sent via Twilio");
  } catch (err) {
    logger.error({ err, to: payload.to }, "Failed to send SMS");
  }
}

export async function sendReminder(opts: {
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  scheduledStart: Date;
  serviceName?: string;
  channel: "sms" | "email";
}): Promise<void> {
  const dateStr = opts.scheduledStart.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  const timeStr = opts.scheduledStart.toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit",
  });

  if (opts.channel === "email" && opts.customerEmail) {
    await sendEmail({
      to: opts.customerEmail,
      subject: `Appointment Reminder: ${opts.serviceName || "Lawn Care"} on ${dateStr}`,
      body: `Hi ${opts.customerName},\n\nThis is a reminder for your upcoming appointment on ${dateStr} at ${timeStr}.\n\nService: ${opts.serviceName || "Lawn Care"}\n\nThank you!`,
    });
  } else if (opts.channel === "sms" && opts.customerPhone) {
    await sendSMS({
      to: opts.customerPhone,
      body: `Reminder: Your ${opts.serviceName || "lawn care"} appointment is on ${dateStr} at ${timeStr}. Reply STOP to opt out.`,
    });
  }
}

export async function sendReviewRequestNotification(opts: {
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  reviewUrl: string;
  companyName: string;
  channel: "sms" | "email";
}): Promise<void> {
  if (opts.channel === "email" && opts.customerEmail) {
    await sendEmail({
      to: opts.customerEmail,
      subject: `How was your experience with ${opts.companyName}?`,
      body: `Hi ${opts.customerName},\n\nThank you for choosing ${opts.companyName}! We'd love to hear your feedback.\n\nLeave a review: ${opts.reviewUrl}\n\nThank you!`,
    });
  } else if (opts.channel === "sms" && opts.customerPhone) {
    await sendSMS({
      to: opts.customerPhone,
      body: `Hi ${opts.customerName}! Thanks for using ${opts.companyName}. Please leave us a review: ${opts.reviewUrl}`,
    });
  }
}

export async function sendInvoiceEmail(opts: {
  customerEmail: string;
  customerName: string;
  companyName: string;
  invoiceNumber: string;
  dueDate?: Date | null;
  lineItems: Array<{ description: string; quantity: number; unitPrice: number; lineTotal: number }>;
  total: number;
  portalUrl: string;
}): Promise<void> {
  const dueDateStr = opts.dueDate
    ? new Date(opts.dueDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : "Upon receipt";

  const lineItemsText = opts.lineItems
    .map(li => `  - ${li.description} (x${li.quantity}) @ $${li.unitPrice.toFixed(2)} = $${li.lineTotal.toFixed(2)}`)
    .join("\n");

  const body = [
    `Hi ${opts.customerName},`,
    ``,
    `${opts.companyName} has sent you invoice ${opts.invoiceNumber}.`,
    ``,
    `Due Date: ${dueDateStr}`,
    ``,
    `Items:`,
    lineItemsText || `  (No line items)`,
    ``,
    `Total Due: $${opts.total.toFixed(2)}`,
    ``,
    `View and pay your invoice online:`,
    opts.portalUrl,
    ``,
    `Thank you for your business,`,
    `${opts.companyName}`,
  ].join("\n");

  await sendEmail({
    to: opts.customerEmail,
    subject: `Invoice ${opts.invoiceNumber} from ${opts.companyName} — $${opts.total.toFixed(2)} due`,
    body,
  });
}

export async function sendTeamInviteEmail(opts: {
  to: string;
  firstName: string;
  lastName: string;
  companyName: string;
  temporaryPassword: string;
  loginUrl: string;
}): Promise<void> {
  await sendEmail({
    to: opts.to,
    subject: `You've been invited to join ${opts.companyName} on GreenSync`,
    body: `Hi ${opts.firstName},\n\nYou have been added as a team member at ${opts.companyName} on GreenSync.\n\nHere are your login credentials:\n\nEmail: ${opts.to}\nTemporary Password: ${opts.temporaryPassword}\n\nLogin here: ${opts.loginUrl}\n\nPlease change your password after your first login.\n\nThank you,\nThe GreenSync Team`,
  });
}
