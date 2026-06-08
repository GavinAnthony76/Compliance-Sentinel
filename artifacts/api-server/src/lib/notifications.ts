import { db, invoicesTable, customersTable, companiesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";
import { resolveEmailCredentials } from "./resend";

interface EmailPayload {
  to: string;
  subject: string;
  body: string;
  html?: string;
  replyTo?: string;
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

export function resolveBaseUrl(): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL;
  const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0];
  if (replitDomain) return `https://${replitDomain}`;
  return "http://localhost:3000";
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
  const creds = await resolveEmailCredentials();
  if (!creds) {
    const msg =
      "No SendGrid credentials available (managed connector not connected and SENDGRID_API_KEY unset) — email delivery is disabled";
    if (isDev) {
      logger.warn(`[Email] ${msg}`);
    } else {
      logger.error(`[Email] ${msg}`);
    }
    logger.info({ mock: true, to: payload.to, subject: payload.subject }, "[MOCK EMAIL] Would send email");
    return;
  }

  try {
    const { Resend } = await import("resend");
    const resend = new Resend(creds.apiKey);

    const { error } = await resend.emails.send({
      from: creds.fromEmail,
      to: payload.to,
      subject: payload.subject,
      text: payload.body,
      ...(payload.html ? { html: payload.html } : {}),
      ...(payload.replyTo ? { reply_to: payload.replyTo } : {}),
    });

    if (error) {
      logger.error({ error, to: payload.to, subject: payload.subject }, "Resend rejected email");
      return;
    }

    logger.info({ to: payload.to, subject: payload.subject }, "Email sent via Resend");
  } catch (err) {
    logger.error({ err, to: payload.to, subject: payload.subject }, "Failed to send email via Resend");
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
  companyEmail?: string;
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
      replyTo: opts.companyEmail,
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
  companyEmail?: string;
}): Promise<void> {
  if (opts.channel === "email" && opts.customerEmail) {
    await sendEmail({
      to: opts.customerEmail,
      subject: `How was your experience with ${opts.companyName}?`,
      body: `Hi ${opts.customerName},\n\nThank you for choosing ${opts.companyName}! We'd love to hear your feedback.\n\nLeave a review: ${opts.reviewUrl}\n\nThank you!`,
      replyTo: opts.companyEmail,
    });
  } else if (opts.channel === "sms" && opts.customerPhone) {
    await sendSMS({
      to: opts.customerPhone,
      body: `Hi ${opts.customerName}! Thanks for using ${opts.companyName}. Please leave us a review: ${opts.reviewUrl}`,
    });
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildInvoiceEmailHtml(opts: {
  customerName: string;
  companyName: string;
  invoiceNumber: string;
  dueDateStr: string;
  lineItems: Array<{ description: string; quantity: number; unitPrice: number; lineTotal: number }>;
  total: number;
  portalUrl: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
}): string {
  const accent = opts.primaryColor && /^#[0-9a-fA-F]{3,8}$/.test(opts.primaryColor) ? opts.primaryColor : "#16a34a";
  const companyName = escapeHtml(opts.companyName);
  const invoiceNumber = escapeHtml(opts.invoiceNumber);
  const customerName = escapeHtml(opts.customerName);
  const portalUrl = escapeHtml(opts.portalUrl);

  const header = opts.logoUrl
    ? `<img src="${escapeHtml(opts.logoUrl)}" alt="${companyName}" style="max-height:56px;max-width:200px;display:block;" />`
    : `<span style="font-size:22px;font-weight:700;color:#ffffff;">${companyName}</span>`;

  const rows = opts.lineItems.length
    ? opts.lineItems
        .map(
          (li, i) => `
          <tr style="background-color:${i % 2 === 0 ? "#ffffff" : "#f9fafb"};">
            <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;">${escapeHtml(li.description)}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;text-align:center;">${li.quantity}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;text-align:right;">$${li.unitPrice.toFixed(2)}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;text-align:right;">$${li.lineTotal.toFixed(2)}</td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="4" style="padding:12px;font-size:14px;color:#6b7280;text-align:center;">No line items</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Invoice ${invoiceNumber}</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:24px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr>
          <td style="background-color:${accent};padding:24px 32px;">${header}</td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 16px;font-size:16px;color:#111827;">Hi ${customerName},</p>
            <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.5;">${companyName} has sent you invoice <strong>${invoiceNumber}</strong>.</p>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
              <tr>
                <td style="font-size:14px;color:#6b7280;padding-right:8px;">Due Date:</td>
                <td style="font-size:14px;color:#111827;font-weight:600;">${escapeHtml(opts.dueDateStr)}</td>
              </tr>
            </table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 24px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
              <thead>
                <tr style="background-color:#f3f4f6;">
                  <th style="padding:10px 12px;font-size:12px;color:#6b7280;text-align:left;text-transform:uppercase;letter-spacing:0.04em;">Description</th>
                  <th style="padding:10px 12px;font-size:12px;color:#6b7280;text-align:center;text-transform:uppercase;letter-spacing:0.04em;">Qty</th>
                  <th style="padding:10px 12px;font-size:12px;color:#6b7280;text-align:right;text-transform:uppercase;letter-spacing:0.04em;">Unit</th>
                  <th style="padding:10px 12px;font-size:12px;color:#6b7280;text-align:right;text-transform:uppercase;letter-spacing:0.04em;">Total</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
              <tfoot>
                <tr>
                  <td colspan="3" style="padding:12px;font-size:15px;color:#111827;font-weight:700;text-align:right;border-top:2px solid #e5e7eb;">Total Due</td>
                  <td style="padding:12px;font-size:15px;color:#111827;font-weight:700;text-align:right;border-top:2px solid #e5e7eb;">$${opts.total.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
              <tr>
                <td style="border-radius:6px;background-color:${accent};">
                  <a href="${portalUrl}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">Pay Now</a>
                </td>
              </tr>
            </table>
            <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5;">If the button doesn't work, copy and paste this link into your browser:<br /><a href="${portalUrl}" style="color:${accent};word-break:break-all;">${portalUrl}</a></p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px;border-top:1px solid #e5e7eb;">
            <p style="margin:0;font-size:14px;color:#374151;">Thank you for your business,<br /><strong>${companyName}</strong></p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

export async function sendInvoiceEmail(opts: {
  customerEmail: string;
  customerName: string;
  companyName: string;
  companyEmail?: string;
  invoiceNumber: string;
  dueDate?: Date | null;
  lineItems: Array<{ description: string; quantity: number; unitPrice: number; lineTotal: number }>;
  total: number;
  portalUrl: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
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

  const html = buildInvoiceEmailHtml({
    customerName: opts.customerName,
    companyName: opts.companyName,
    invoiceNumber: opts.invoiceNumber,
    dueDateStr,
    lineItems: opts.lineItems,
    total: opts.total,
    portalUrl: opts.portalUrl,
    logoUrl: opts.logoUrl,
    primaryColor: opts.primaryColor,
  });

  await sendEmail({
    to: opts.customerEmail,
    subject: `Invoice ${opts.invoiceNumber} from ${opts.companyName} — $${opts.total.toFixed(2)} due`,
    body,
    html,
    replyTo: opts.companyEmail,
  });
}

export async function sendPaymentReceiptEmail(opts: {
  customerEmail: string;
  customerName: string;
  companyName: string;
  companyEmail?: string;
  invoiceNumber: string;
  amountPaid: number;
  paymentDate: Date;
  portalUrl?: string;
}): Promise<void> {
  const paymentDateStr = new Date(opts.paymentDate).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });

  const body = [
    `Hi ${opts.customerName},`,
    ``,
    `Thank you for your payment! We've received your payment for invoice ${opts.invoiceNumber}.`,
    ``,
    `Invoice Number: ${opts.invoiceNumber}`,
    `Amount Paid: $${opts.amountPaid.toFixed(2)}`,
    `Payment Date: ${paymentDateStr}`,
    ``,
    ...(opts.portalUrl ? [`View your invoice online:`, opts.portalUrl, ``] : []),
    `We appreciate your business!`,
    ``,
    `${opts.companyName}`,
  ].join("\n");

  await sendEmail({
    to: opts.customerEmail,
    subject: `Payment Received for Invoice ${opts.invoiceNumber} — Thank You!`,
    body,
    replyTo: opts.companyEmail,
  });
}

export async function dispatchPaymentReceiptEmail(invoiceId: number, companyId: number): Promise<void> {
  try {
    const [inv] = await db.select().from(invoicesTable).where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.companyId, companyId))).limit(1);
    if (!inv) return;
    const [customer] = await db.select().from(customersTable).where(and(eq(customersTable.id, inv.customerId), eq(customersTable.companyId, companyId))).limit(1);
    if (!customer?.email) return;
    const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
    const companyName = company?.name || "Your Service Provider";
    const companySlug = company?.slug || "";
    const baseUrl = resolveBaseUrl();
    const portalUrl = companySlug ? `${baseUrl}/portal/${companySlug}/invoices` : undefined;
    const customerName = `${customer.firstName} ${customer.lastName}`.trim() || customer.email;
    await sendPaymentReceiptEmail({
      customerEmail: customer.email,
      customerName,
      companyName,
      companyEmail: company?.email ?? undefined,
      invoiceNumber: inv.invoiceNumber,
      amountPaid: Number(inv.total),
      paymentDate: inv.paidAt ? new Date(inv.paidAt) : new Date(),
      portalUrl,
    });
  } catch (err) {
    logger.error({ err, invoiceId, companyId }, "Failed to dispatch payment receipt email");
  }
}

export async function sendWelcomeEmail(opts: {
  to: string;
  firstName: string;
  companyName: string;
  loginUrl: string;
}): Promise<void> {
  await sendEmail({
    to: opts.to,
    subject: `Welcome to GreenSync, ${opts.firstName}!`,
    body: [
      `Hi ${opts.firstName},`,
      ``,
      `Welcome to GreenSync! Your company "${opts.companyName}" is all set up and your 14-day free trial has started.`,
      ``,
      `Here are a few things you can do right away:`,
      `  • Add your customers and properties`,
      `  • Schedule appointments and dispatch your crew`,
      `  • Send estimates and invoices, and get paid online`,
      ``,
      `Log in any time here:`,
      opts.loginUrl,
      ``,
      `If you have any questions, just reply to this email — we're happy to help.`,
      ``,
      `Welcome aboard,`,
      `The GreenSync Team`,
    ].join("\n"),
  });
}

// Passwordless customer-portal access email. Used both for the initial invite
// and for "email me a login link". The link signs the customer straight in —
// no password required.
export async function sendPortalAccessEmail(opts: {
  to: string;
  customerName: string;
  companyName: string;
  companyEmail?: string;
  loginUrl: string;
  intent: "invite" | "login";
  expiresLabel: string;
}): Promise<void> {
  const subject =
    opts.intent === "invite"
      ? `${opts.companyName} invited you to your customer portal`
      : `Your ${opts.companyName} portal login link`;
  const intro =
    opts.intent === "invite"
      ? `${opts.companyName} has set up a customer portal for you. You can view your appointments, invoices, and service history any time.`
      : `Here is your secure login link for the ${opts.companyName} customer portal.`;
  await sendEmail({
    to: opts.to,
    subject,
    body: [
      `Hi ${opts.customerName},`,
      ``,
      intro,
      ``,
      `Click the link below to sign in — no password required:`,
      opts.loginUrl,
      ``,
      `This link expires ${opts.expiresLabel}. If you didn't request it, you can safely ignore this email.`,
      ``,
      `Thank you,`,
      opts.companyName,
    ].join("\n"),
    replyTo: opts.companyEmail,
  });
}

// Customer-facing notification when an appointment's status changes.
export async function sendAppointmentStatusEmail(opts: {
  to: string;
  customerName: string;
  companyName: string;
  companyEmail?: string;
  serviceName: string;
  dateStr: string;
  timeStr: string;
  subject: string;
  message: string;
}): Promise<void> {
  await sendEmail({
    to: opts.to,
    subject: opts.subject,
    body: [
      `Hi ${opts.customerName},`,
      ``,
      opts.message,
      ``,
      `Service: ${opts.serviceName}`,
      `Date: ${opts.dateStr}${opts.timeStr ? ` at ${opts.timeStr}` : ""}`,
      ``,
      `Thank you,`,
      opts.companyName,
    ].join("\n"),
    replyTo: opts.companyEmail,
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
