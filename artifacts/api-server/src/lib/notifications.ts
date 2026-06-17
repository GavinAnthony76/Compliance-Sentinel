import { db, invoicesTable, invoiceLineItemsTable, customersTable, companiesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";
import { resolveEmailCredentials } from "./resend";

interface EmailPayload {
  to: string;
  subject: string;
  body: string;
  html?: string;
  replyTo?: string;
  attachments?: { filename: string; content: Buffer }[];
}

// Result of an email send attempt. `delivered` is the single source of truth for
// whether the message actually went out — callers that tie state to delivery
// (e.g. marking an invoice "sent") MUST gate on this rather than assuming success.
export interface EmailResult {
  delivered: boolean;
  reason?: "no_credentials" | "provider_rejected" | "exception";
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

export async function sendEmail(payload: EmailPayload): Promise<EmailResult> {
  const creds = await resolveEmailCredentials();
  if (!creds) {
    const msg =
      "No Resend credentials available (RESEND_API_KEY unset) — email delivery is disabled";
    if (isDev) {
      logger.warn(`[Email] ${msg}`);
    } else {
      logger.error(`[Email] ${msg}`);
    }
    logger.info({ mock: true, to: payload.to, subject: payload.subject }, "[MOCK EMAIL] Would send email");
    return { delivered: false, reason: "no_credentials" };
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
      ...(payload.attachments && payload.attachments.length > 0
        ? { attachments: payload.attachments.map(a => ({ filename: a.filename, content: a.content })) }
        : {}),
    });

    if (error) {
      logger.error({ error, to: payload.to, subject: payload.subject }, "Resend rejected email");
      return { delivered: false, reason: "provider_rejected" };
    }

    logger.info({ to: payload.to, subject: payload.subject }, "Email sent via Resend");
    return { delivered: true };
  } catch (err) {
    logger.error({ err, to: payload.to, subject: payload.subject }, "Failed to send email via Resend");
    return { delivered: false, reason: "exception" };
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
  companyName?: string;
  companyEmail?: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
}): Promise<void> {
  const dateStr = opts.scheduledStart.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  const timeStr = opts.scheduledStart.toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit",
  });

  if (opts.channel === "email" && opts.customerEmail) {
    const serviceName = opts.serviceName || "Lawn Care";
    const companyName = opts.companyName || "Your Service Provider";
    const bodyHtml = `
            <p style="margin:0 0 16px;font-size:16px;color:#111827;">Hi ${escapeHtml(opts.customerName)},</p>
            <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.5;">This is a friendly reminder about your upcoming appointment with ${escapeHtml(companyName)}.</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;border:1px solid #e5e7eb;border-radius:6px;background-color:#f9fafb;">
              <tr><td style="padding:16px 20px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="font-size:14px;color:#6b7280;padding:2px 12px 2px 0;">Service:</td>
                    <td style="font-size:14px;color:#111827;font-weight:600;padding:2px 0;">${escapeHtml(serviceName)}</td>
                  </tr>
                  <tr>
                    <td style="font-size:14px;color:#6b7280;padding:2px 12px 2px 0;">Date:</td>
                    <td style="font-size:14px;color:#111827;font-weight:600;padding:2px 0;">${escapeHtml(dateStr)}</td>
                  </tr>
                  <tr>
                    <td style="font-size:14px;color:#6b7280;padding:2px 12px 2px 0;">Time:</td>
                    <td style="font-size:14px;color:#111827;font-weight:600;padding:2px 0;">${escapeHtml(timeStr)}</td>
                  </tr>
                </table>
              </td></tr>
            </table>`;
    const html = buildBrandedEmailHtml({
      title: `Appointment Reminder — ${serviceName}`,
      companyName,
      bodyHtml,
      footerHtml: `See you soon,<br /><strong>${escapeHtml(companyName)}</strong>`,
      logoUrl: opts.logoUrl,
      primaryColor: opts.primaryColor,
    });
    await sendEmail({
      to: opts.customerEmail,
      subject: `Appointment Reminder: ${serviceName} on ${dateStr}`,
      body: `Hi ${opts.customerName},\n\nThis is a reminder for your upcoming appointment on ${dateStr} at ${timeStr}.\n\nService: ${serviceName}\n\nThank you!`,
      html,
      replyTo: opts.companyEmail,
    });
  } else if (opts.channel === "sms" && opts.customerPhone) {
    await sendSMS({
      to: opts.customerPhone,
      body: `Reminder: Your ${opts.serviceName || "lawn care"} appointment is on ${dateStr} at ${timeStr}. Reply STOP to opt out.`,
    });
  }
}

export async function sendAppointmentConfirmationEmail(opts: {
  customerName: string;
  customerEmail: string;
  scheduledStart: Date;
  serviceName?: string;
  companyName?: string;
  companyEmail?: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
}): Promise<void> {
  const dateStr = opts.scheduledStart.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  const timeStr = opts.scheduledStart.toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit",
  });
  const serviceName = opts.serviceName || "Lawn Care";
  const companyName = opts.companyName || "Your Service Provider";

  const bodyHtml = `
            <p style="margin:0 0 16px;font-size:16px;color:#111827;">Hi ${escapeHtml(opts.customerName)},</p>
            <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.5;">Good news! Your appointment with ${escapeHtml(companyName)} has been confirmed.</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;border:1px solid #e5e7eb;border-radius:6px;background-color:#f9fafb;">
              <tr><td style="padding:16px 20px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="font-size:14px;color:#6b7280;padding:2px 12px 2px 0;">Service:</td>
                    <td style="font-size:14px;color:#111827;font-weight:600;padding:2px 0;">${escapeHtml(serviceName)}</td>
                  </tr>
                  <tr>
                    <td style="font-size:14px;color:#6b7280;padding:2px 12px 2px 0;">Date:</td>
                    <td style="font-size:14px;color:#111827;font-weight:600;padding:2px 0;">${escapeHtml(dateStr)}</td>
                  </tr>
                  <tr>
                    <td style="font-size:14px;color:#6b7280;padding:2px 12px 2px 0;">Time:</td>
                    <td style="font-size:14px;color:#111827;font-weight:600;padding:2px 0;">${escapeHtml(timeStr)}</td>
                  </tr>
                </table>
              </td></tr>
            </table>`;
  const html = buildBrandedEmailHtml({
    title: `Appointment Confirmed — ${serviceName}`,
    companyName,
    bodyHtml,
    footerHtml: `Thank you,<br /><strong>${escapeHtml(companyName)}</strong>`,
    logoUrl: opts.logoUrl,
    primaryColor: opts.primaryColor,
  });
  await sendEmail({
    to: opts.customerEmail,
    subject: `Appointment Confirmed — ${serviceName} on ${dateStr}`,
    body: `Hi ${opts.customerName},\n\nYour ${serviceName} appointment with ${companyName} has been confirmed!\n\nDate: ${dateStr}\nTime: ${timeStr}\n\nThank you!`,
    html,
    replyTo: opts.companyEmail,
  });
}

export async function sendReviewRequestNotification(opts: {
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  reviewUrl: string;
  companyName: string;
  channel: "sms" | "email";
  companyEmail?: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
}): Promise<void> {
  if (opts.channel === "email" && opts.customerEmail) {
    const bodyHtml = `
            <p style="margin:0 0 16px;font-size:16px;color:#111827;">Hi ${escapeHtml(opts.customerName)},</p>
            <p style="margin:0 0 8px;font-size:15px;color:#374151;line-height:1.5;">Thank you for choosing ${escapeHtml(opts.companyName)}! We'd love to hear about your experience.</p>
            <p style="margin:0 0 8px;font-size:15px;color:#374151;line-height:1.5;">It only takes a moment, and your feedback helps us serve you better.</p>`;
    const html = buildBrandedEmailHtml({
      title: `How was your experience with ${opts.companyName}?`,
      companyName: opts.companyName,
      bodyHtml,
      cta: { label: "Leave a Review", url: opts.reviewUrl },
      footerHtml: `Thank you,<br /><strong>${escapeHtml(opts.companyName)}</strong>`,
      logoUrl: opts.logoUrl,
      primaryColor: opts.primaryColor,
    });
    await sendEmail({
      to: opts.customerEmail,
      subject: `How was your experience with ${opts.companyName}?`,
      body: `Hi ${opts.customerName},\n\nThank you for choosing ${opts.companyName}! We'd love to hear your feedback.\n\nLeave a review: ${opts.reviewUrl}\n\nThank you!`,
      html,
      replyTo: opts.companyEmail,
    });
  } else if (opts.channel === "sms" && opts.customerPhone) {
    await sendSMS({
      to: opts.customerPhone,
      body: `Hi ${opts.customerName}! Thanks for using ${opts.companyName}. Please leave us a review: ${opts.reviewUrl}`,
    });
  }
}

export async function sendBookingRequestNotification(opts: {
  companyEmail: string;
  companyName: string;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  serviceName?: string | null;
  address?: string | null;
  preferredDate?: Date | null;
  notes?: string | null;
}): Promise<void> {
  const dateStr = opts.preferredDate
    ? new Date(opts.preferredDate).toLocaleDateString("en-US", {
        weekday: "long", year: "numeric", month: "long", day: "numeric",
      })
    : "Not specified (customer is flexible)";

  const body = [
    `You have a new booking request from ${opts.customerName}.`,
    ``,
    `Service: ${opts.serviceName || "Not specified"}`,
    `Preferred date: ${dateStr}`,
    ...(opts.address ? [`Address: ${opts.address}`] : []),
    ``,
    `Customer contact:`,
    ...(opts.customerEmail ? [`  Email: ${opts.customerEmail}`] : []),
    ...(opts.customerPhone ? [`  Phone: ${opts.customerPhone}`] : []),
    ...(opts.notes ? [``, `Notes: ${opts.notes}`] : []),
    ``,
    `This request is now in your dashboard under Appointments (status: pending). Confirm it to notify the customer.`,
  ].join("\n");

  await sendEmail({
    to: opts.companyEmail,
    subject: `New booking request from ${opts.customerName}`,
    body,
    replyTo: opts.customerEmail || undefined,
  });
}

// Customer-facing confirmation when they submit a public booking request.
export async function sendBookingConfirmationEmail(opts: {
  to: string;
  customerName: string;
  companyName: string;
  companyEmail?: string;
  companyPhone?: string | null;
  serviceName?: string | null;
  preferredDate?: Date | null;
  address?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
}): Promise<void> {
  const dateStr = opts.preferredDate
    ? new Date(opts.preferredDate).toLocaleDateString("en-US", {
        weekday: "long", year: "numeric", month: "long", day: "numeric",
      })
    : "your preferred date (we'll confirm a time with you)";

  const serviceName = opts.serviceName || "Lawn care";
  const bodyHtml = `
            <p style="margin:0 0 16px;font-size:16px;color:#111827;">Hi ${escapeHtml(opts.customerName)},</p>
            <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.5;">Thanks for your booking request with ${escapeHtml(opts.companyName)}! We've received it and will reach out shortly to confirm the details.</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border:1px solid #e5e7eb;border-radius:6px;background-color:#f9fafb;">
              <tr><td style="padding:16px 20px;">
                <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;">What you requested</p>
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="font-size:14px;color:#6b7280;padding:2px 12px 2px 0;">Service:</td>
                    <td style="font-size:14px;color:#111827;font-weight:600;padding:2px 0;">${escapeHtml(serviceName)}</td>
                  </tr>
                  <tr>
                    <td style="font-size:14px;color:#6b7280;padding:2px 12px 2px 0;">Preferred date:</td>
                    <td style="font-size:14px;color:#111827;font-weight:600;padding:2px 0;">${escapeHtml(dateStr)}</td>
                  </tr>
                  ${opts.address ? `<tr>
                    <td style="font-size:14px;color:#6b7280;padding:2px 12px 2px 0;">Address:</td>
                    <td style="font-size:14px;color:#111827;font-weight:600;padding:2px 0;">${escapeHtml(opts.address)}</td>
                  </tr>` : ""}
                </table>
              </td></tr>
            </table>
            <p style="margin:0;font-size:14px;color:#374151;line-height:1.5;">If anything looks off or you need to make a change, just reply to this email${opts.companyPhone ? ` or call us at ${escapeHtml(opts.companyPhone)}` : ""}.</p>`;

  const html = buildBrandedEmailHtml({
    title: `We received your booking request — ${opts.companyName}`,
    companyName: opts.companyName,
    bodyHtml,
    footerHtml: `Thank you,<br /><strong>${escapeHtml(opts.companyName)}</strong>`,
    logoUrl: opts.logoUrl,
    primaryColor: opts.primaryColor,
  });

  await sendEmail({
    to: opts.to,
    subject: `We received your booking request — ${opts.companyName}`,
    body: [
      `Hi ${opts.customerName},`,
      ``,
      `Thanks for your booking request with ${opts.companyName}! We've received it and will reach out shortly to confirm the details.`,
      ``,
      `Here's what you requested:`,
      `  Service: ${serviceName}`,
      `  Preferred date: ${dateStr}`,
      ...(opts.address ? [`  Address: ${opts.address}`] : []),
      ``,
      `If anything looks off or you need to make a change, just reply to this email${opts.companyPhone ? ` or call us at ${opts.companyPhone}` : ""}.`,
      ``,
      `Thank you,`,
      opts.companyName,
    ].join("\n"),
    html,
    replyTo: opts.companyEmail,
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Shared branded styling for all customer-facing HTML emails. Resolves the
// company accent color (falling back to the GreenSynk green) and renders the
// logo/name header used across invoices, reminders, and review requests.
function resolveAccent(primaryColor?: string | null): string {
  return primaryColor && /^#[0-9a-fA-F]{3,8}$/.test(primaryColor) ? primaryColor : "#16a34a";
}

function buildBrandedHeader(companyName: string, logoUrl?: string | null): string {
  return logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(companyName)}" style="max-height:56px;max-width:200px;display:block;" />`
    : `<span style="font-size:22px;font-weight:700;color:#ffffff;">${escapeHtml(companyName)}</span>`;
}

// Generic branded email shell: header band, content area, optional call-to-action
// button (matching the invoice "Pay Now" style), and a signature footer.
function buildBrandedEmailHtml(opts: {
  title: string;
  companyName: string;
  bodyHtml: string;
  cta?: { label: string; url: string } | null;
  footerHtml?: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
}): string {
  const accent = resolveAccent(opts.primaryColor);
  const companyName = escapeHtml(opts.companyName);
  const header = buildBrandedHeader(opts.companyName, opts.logoUrl);
  const ctaUrl = opts.cta ? escapeHtml(opts.cta.url) : null;
  const ctaLabel = opts.cta ? escapeHtml(opts.cta.label) : null;

  const ctaBlock = ctaUrl && ctaLabel
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;">
              <tr>
                <td style="border-radius:6px;background-color:${accent};">
                  <a href="${ctaUrl}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">${ctaLabel}</a>
                </td>
              </tr>
            </table>
            <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5;">If the button doesn't work, copy and paste this link into your browser:<br /><a href="${ctaUrl}" style="color:${accent};word-break:break-all;">${ctaUrl}</a></p>`
    : "";

  const footerBlock = opts.footerHtml
    ? `<tr>
          <td style="padding:24px 32px;border-top:1px solid #e5e7eb;">
            <p style="margin:0;font-size:14px;color:#374151;">${opts.footerHtml}</p>
          </td>
        </tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(opts.title)}</title>
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
            ${opts.bodyHtml}
            ${ctaBlock}
          </td>
        </tr>
        ${footerBlock}
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function buildInvoiceEmailHtml(opts: {
  customerName: string;
  companyName: string;
  invoiceNumber: string;
  dueDateStr: string;
  lineItems: Array<{ description: string; quantity: number; unitPrice: number; lineTotal: number }>;
  total: number;
  payNowUrl?: string | null;
  paymentInstructions?: string[];
  logoUrl?: string | null;
  primaryColor?: string | null;
}): string {
  const accent = resolveAccent(opts.primaryColor);
  const companyName = escapeHtml(opts.companyName);
  const invoiceNumber = escapeHtml(opts.invoiceNumber);
  const customerName = escapeHtml(opts.customerName);
  const payNowUrl = opts.payNowUrl ? escapeHtml(opts.payNowUrl) : null;
  const paymentInstructions = (opts.paymentInstructions ?? []).map(escapeHtml);

  const header = buildBrandedHeader(opts.companyName, opts.logoUrl);

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
            ${payNowUrl
              ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
              <tr>
                <td style="border-radius:6px;background-color:${accent};">
                  <a href="${payNowUrl}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">Pay Now</a>
                </td>
              </tr>
            </table>
            <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5;">If the button doesn't work, copy and paste this link into your browser:<br /><a href="${payNowUrl}" style="color:${accent};word-break:break-all;">${payNowUrl}</a></p>`
              : paymentInstructions.length
              ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;border:1px solid #e5e7eb;border-radius:6px;background-color:#f9fafb;">
              <tr><td style="padding:16px 20px;">
                <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;">How to Pay</p>
                ${paymentInstructions.map(p => `<p style="margin:0 0 4px;font-size:14px;color:#374151;line-height:1.5;">${p}</p>`).join("")}
              </td></tr>
            </table>`
              : `<p style="margin:0;font-size:14px;color:#374151;line-height:1.5;">Please reply to this email to arrange payment.</p>`}
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
  payNowUrl?: string | null;
  paymentInstructions?: string[];
  logoUrl?: string | null;
  primaryColor?: string | null;
}): Promise<EmailResult> {
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
    ...(opts.payNowUrl
      ? [`View and pay your invoice online:`, opts.payNowUrl, ``]
      : (opts.paymentInstructions && opts.paymentInstructions.length)
        ? [`How to pay:`, ...opts.paymentInstructions, ``]
        : [`Please reply to this email to arrange payment.`, ``]),
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
    payNowUrl: opts.payNowUrl,
    paymentInstructions: opts.paymentInstructions,
    logoUrl: opts.logoUrl,
    primaryColor: opts.primaryColor,
  });

  return await sendEmail({
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
  attachments?: { filename: string; content: Buffer }[];
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
    ...(opts.attachments && opts.attachments.length > 0 ? { attachments: opts.attachments } : {}),
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

    // Generate a paid-invoice receipt PDF to attach, mirroring the invoice email.
    // Graceful fallback: if PDF generation fails, still send the receipt email.
    let attachments: { filename: string; content: Buffer }[] | undefined;
    try {
      const lineItems = await db.select().from(invoiceLineItemsTable)
        .where(eq(invoiceLineItemsTable.invoiceId, invoiceId))
        .orderBy(invoiceLineItemsTable.sortOrder);
      const { buildInvoicePdf } = await import("./invoice-pdf");
      const pdfBuffer = await buildInvoicePdf({
        invoice: inv,
        customer,
        company,
        lineItems,
        documentType: "receipt",
      });
      attachments = [{ filename: `receipt-${inv.invoiceNumber}.pdf`, content: pdfBuffer }];
    } catch (pdfErr) {
      logger.error({ err: pdfErr, invoiceId, companyId }, "Failed to generate receipt PDF for payment receipt email; sending without attachment");
    }

    await sendPaymentReceiptEmail({
      customerEmail: customer.email,
      customerName,
      companyName,
      companyEmail: company?.email ?? undefined,
      invoiceNumber: inv.invoiceNumber,
      amountPaid: Number(inv.total),
      paymentDate: inv.paidAt ? new Date(inv.paidAt) : new Date(),
      portalUrl,
      attachments,
    });
  } catch (err) {
    logger.error({ err, invoiceId, companyId }, "Failed to dispatch payment receipt email");
  }
}

// Customer-facing welcome email with a link to book appointments online. Sent
// on customer creation for plans without the customer portal (e.g. Starter), so
// every customer still gets a way to self-schedule via the public booking page.
export async function sendCustomerWelcomeBookingEmail(opts: {
  to: string;
  customerName: string;
  companyName: string;
  companyEmail?: string;
  companyPhone?: string | null;
  bookingUrl: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
}): Promise<void> {
  const bodyHtml = `
            <p style="margin:0 0 16px;font-size:16px;color:#111827;">Hi ${escapeHtml(opts.customerName)},</p>
            <p style="margin:0 0 8px;font-size:15px;color:#374151;line-height:1.5;">Thanks for being a customer of ${escapeHtml(opts.companyName)}! You can request and schedule appointments online any time using the button below.</p>
            <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.5;">Just choose a service and your preferred date, and we'll take it from there.</p>`;

  const html = buildBrandedEmailHtml({
    title: `Welcome to ${opts.companyName} — book your next appointment`,
    companyName: opts.companyName,
    bodyHtml,
    cta: { label: "Book an Appointment", url: opts.bookingUrl },
    footerHtml: `${
      opts.companyPhone
        ? `Questions? Call us at ${escapeHtml(opts.companyPhone)} or reply to this email.`
        : `Questions? Just reply to this email.`
    }<br /><br />Thank you,<br /><strong>${escapeHtml(opts.companyName)}</strong>`,
    logoUrl: opts.logoUrl,
    primaryColor: opts.primaryColor,
  });

  await sendEmail({
    to: opts.to,
    subject: `Welcome to ${opts.companyName} — book your next appointment`,
    body: [
      `Hi ${opts.customerName},`,
      ``,
      `Thanks for being a customer of ${opts.companyName}! You can request and schedule appointments online any time using the link below:`,
      ``,
      opts.bookingUrl,
      ``,
      `Just choose a service and your preferred date, and we'll take it from there.`,
      ``,
      opts.companyPhone
        ? `Questions? Call us at ${opts.companyPhone} or reply to this email.`
        : `Questions? Just reply to this email.`,
      ``,
      `Thank you,`,
      opts.companyName,
    ].join("\n"),
    html,
    replyTo: opts.companyEmail,
  });
}

// Owner/company-facing notification that a customer has paid an invoice.
// Mirrors dispatchPaymentReceiptEmail (which notifies the customer) so the
// business owner is alerted the moment money comes in, on any payment path.
export async function dispatchOwnerPaymentNotification(invoiceId: number, companyId: number): Promise<void> {
  try {
    const [inv] = await db.select().from(invoicesTable).where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.companyId, companyId))).limit(1);
    if (!inv) return;
    const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
    if (!company?.email) return;
    const [customer] = await db.select().from(customersTable).where(and(eq(customersTable.id, inv.customerId), eq(customersTable.companyId, companyId))).limit(1);
    const customerName = customer
      ? (`${customer.firstName} ${customer.lastName}`.trim() || customer.email || "A customer")
      : "A customer";
    const paymentDate = inv.paidAt ? new Date(inv.paidAt) : new Date();
    const paymentDateStr = paymentDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const baseUrl = resolveBaseUrl();
    const companyName = company.name || "Your Business";
    const amountStr = `$${Number(inv.total).toFixed(2)}`;
    const dashboardUrl = `${baseUrl}/invoices`;

    const bodyHtml = `
            <p style="margin:0 0 16px;font-size:16px;color:#111827;">Good news — you've been paid!</p>
            <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.5;">${escapeHtml(customerName)} has paid invoice <strong>${escapeHtml(inv.invoiceNumber)}</strong>.</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;border:1px solid #e5e7eb;border-radius:6px;background-color:#f9fafb;">
              <tr><td style="padding:16px 20px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="font-size:14px;color:#6b7280;padding:2px 12px 2px 0;">Amount:</td>
                    <td style="font-size:14px;color:#111827;font-weight:600;padding:2px 0;">${escapeHtml(amountStr)}</td>
                  </tr>
                  <tr>
                    <td style="font-size:14px;color:#6b7280;padding:2px 12px 2px 0;">Payment date:</td>
                    <td style="font-size:14px;color:#111827;font-weight:600;padding:2px 0;">${escapeHtml(paymentDateStr)}</td>
                  </tr>
                  ${inv.paymentMethod ? `<tr>
                    <td style="font-size:14px;color:#6b7280;padding:2px 12px 2px 0;">Method:</td>
                    <td style="font-size:14px;color:#111827;font-weight:600;padding:2px 0;">${escapeHtml(inv.paymentMethod)}</td>
                  </tr>` : ""}
                </table>
              </td></tr>
            </table>`;

    const html = buildBrandedEmailHtml({
      title: `Payment received — invoice ${inv.invoiceNumber}`,
      companyName,
      bodyHtml,
      cta: { label: "View in Dashboard", url: dashboardUrl },
      footerHtml: `Thank you,<br /><strong>${escapeHtml(companyName)}</strong>`,
      logoUrl: company.logoUrl,
      primaryColor: company.primaryColor,
    });

    // Attach the same paid-invoice receipt PDF the customer receives, giving the
    // owner a clean document for their records. Graceful fallback: if PDF
    // generation fails, still send the owner notification without the attachment.
    let attachments: { filename: string; content: Buffer }[] | undefined;
    try {
      const lineItems = await db.select().from(invoiceLineItemsTable)
        .where(eq(invoiceLineItemsTable.invoiceId, invoiceId))
        .orderBy(invoiceLineItemsTable.sortOrder);
      const { buildInvoicePdf } = await import("./invoice-pdf");
      const pdfBuffer = await buildInvoicePdf({
        invoice: inv,
        customer,
        company,
        lineItems,
        documentType: "receipt",
      });
      attachments = [{ filename: `receipt-${inv.invoiceNumber}.pdf`, content: pdfBuffer }];
    } catch (pdfErr) {
      logger.error({ err: pdfErr, invoiceId, companyId }, "Failed to generate receipt PDF for owner payment notification; sending without attachment");
    }

    await sendEmail({
      to: company.email,
      subject: `Payment received: ${customerName} paid invoice ${inv.invoiceNumber} — ${amountStr}`,
      body: [
        `Good news — you've been paid!`,
        ``,
        `${customerName} has paid invoice ${inv.invoiceNumber}.`,
        ``,
        `Amount: ${amountStr}`,
        `Payment date: ${paymentDateStr}`,
        ...(inv.paymentMethod ? [`Method: ${inv.paymentMethod}`] : []),
        ``,
        `View it in your dashboard:`,
        dashboardUrl,
        ``,
        `— GreenSynk`,
      ].join("\n"),
      html,
      attachments,
    });
  } catch (err) {
    logger.error({ err, invoiceId, companyId }, "Failed to dispatch owner payment notification");
  }
}

// Owner-facing alert that Stripe flipped the company's subscription billing
// status. Sent only on a genuine flip (the caller reuses buildStatusFlipLog's
// change-guard, so Stripe retries/replays of the same invoice event don't spam
// the owner). Two transitions matter: any -> past_due (a failed payment, the
// account is degrading) and past_due -> active (the payment recovered). Other
// flips (e.g. trialing -> active) are silent.
export async function dispatchBillingStatusEmail(
  companyId: number,
  previousStatus: string | null,
  nextStatus: string,
): Promise<void> {
  try {
    const isFailure = nextStatus === "past_due";
    const isRecovery = nextStatus === "active" && previousStatus === "past_due";
    if (!isFailure && !isRecovery) return;

    const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
    if (!company?.email) return;
    const baseUrl = resolveBaseUrl();
    const billingUrl = `${baseUrl}/billing`;

    if (isFailure) {
      await sendEmail({
        to: company.email,
        subject: `Action needed: your GreenSynk payment failed`,
        body: [
          `Hi ${company.name || "there"},`,
          ``,
          `We weren't able to process the latest payment for your GreenSynk subscription, so your account has been marked past due.`,
          ``,
          `To avoid any interruption to your service, please update your payment method or settle the outstanding balance as soon as you can:`,
          billingUrl,
          ``,
          `If you've already updated your billing details, you can safely ignore this message — Stripe will retry the charge automatically.`,
          ``,
          `Need a hand? Just reply to this email.`,
          ``,
          `— GreenSynk`,
        ].join("\n"),
      });
    } else {
      await sendEmail({
        to: company.email,
        subject: `You're all set — your GreenSynk subscription is active again`,
        body: [
          `Hi ${company.name || "there"},`,
          ``,
          `Good news — your latest payment went through and your GreenSynk subscription is active again. There's nothing more you need to do.`,
          ``,
          `View your billing details any time:`,
          billingUrl,
          ``,
          `Thanks for being with GreenSynk!`,
          ``,
          `— GreenSynk`,
        ].join("\n"),
      });
    }
  } catch (err) {
    logger.error({ err, companyId, previousStatus, nextStatus }, "Failed to dispatch billing status email");
  }
}

export async function sendWelcomeEmail(opts: {
  to: string;
  firstName: string;
  companyName: string;
  loginUrl: string;
}): Promise<void> {
  const bodyHtml = `
            <p style="margin:0 0 16px;font-size:16px;color:#111827;">Hi ${escapeHtml(opts.firstName)},</p>
            <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.5;">Welcome to GreenSynk! Your company <strong>${escapeHtml(opts.companyName)}</strong> is all set up and your 14-day free trial has started.</p>
            <p style="margin:0 0 12px;font-size:15px;color:#374151;line-height:1.5;">Here are a few things you can do right away:</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border:1px solid #e5e7eb;border-radius:6px;background-color:#f9fafb;">
              <tr><td style="padding:16px 20px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr><td style="font-size:14px;color:#374151;padding:2px 0;line-height:1.5;">• Add your customers and properties</td></tr>
                  <tr><td style="font-size:14px;color:#374151;padding:2px 0;line-height:1.5;">• Schedule appointments and dispatch your crew</td></tr>
                  <tr><td style="font-size:14px;color:#374151;padding:2px 0;line-height:1.5;">• Send estimates and invoices, and get paid online</td></tr>
                </table>
              </td></tr>
            </table>`;

  const html = buildBrandedEmailHtml({
    title: `Welcome to GreenSynk, ${opts.firstName}!`,
    companyName: "GreenSynk",
    bodyHtml,
    cta: { label: "Log in to GreenSynk", url: opts.loginUrl },
    footerHtml: `If you have any questions, just reply to this email — we're happy to help.<br /><br />Welcome aboard,<br /><strong>The GreenSynk Team</strong>`,
  });

  await sendEmail({
    to: opts.to,
    subject: `Welcome to GreenSynk, ${opts.firstName}!`,
    body: [
      `Hi ${opts.firstName},`,
      ``,
      `Welcome to GreenSynk! Your company "${opts.companyName}" is all set up and your 14-day free trial has started.`,
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
      `The GreenSynk Team`,
    ].join("\n"),
    html,
  });
}

// Customer-portal access email. Used both for the initial invite and for
// "email me a login link". The link is a one-click magic link that signs the
// customer in instantly; on first visit they're prompted to set a password so
// they can log in any time afterwards.
export async function sendPortalAccessEmail(opts: {
  to: string;
  customerName: string;
  companyName: string;
  companyEmail?: string;
  loginUrl: string;
  portalUrl?: string;
  intent: "invite" | "login";
  expiresLabel: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
}): Promise<void> {
  const subject =
    opts.intent === "invite"
      ? `${opts.companyName} invited you to your customer portal`
      : `Your ${opts.companyName} portal login link`;

  const customerName = escapeHtml(opts.customerName);
  const companyName = escapeHtml(opts.companyName);
  const ctaLabel = opts.intent === "invite" ? "Get Started" : "Log In";

  const inviteBody = [
    `Hi ${opts.customerName},`,
    ``,
    `${opts.companyName} has set up a customer portal for you, where you can view your appointments, invoices, and service history any time.`,
    ``,
    `Click the secure link below to get started. It signs you in instantly — and on your first visit you'll be asked to choose a password so you can log in any time afterwards:`,
    opts.loginUrl,
    ``,
    ...(opts.portalUrl ? [`After setting your password, you can log in any time at:`, opts.portalUrl, ``] : []),
    `This sign-in link expires ${opts.expiresLabel}. If you didn't expect this email, you can safely ignore it.`,
    ``,
    `Thank you,`,
    opts.companyName,
  ];

  const loginBody = [
    `Hi ${opts.customerName},`,
    ``,
    `Here is your secure, one-click login link for the ${opts.companyName} customer portal — no password needed:`,
    opts.loginUrl,
    ``,
    ...(opts.portalUrl ? [`You can also log in with your email and password any time at:`, opts.portalUrl, ``] : []),
    `This link expires ${opts.expiresLabel}. If you didn't request it, you can safely ignore this email.`,
    ``,
    `Thank you,`,
    opts.companyName,
  ];

  const inviteHtml = `
            <p style="margin:0 0 16px;font-size:16px;color:#111827;">Hi ${customerName},</p>
            <p style="margin:0 0 8px;font-size:15px;color:#374151;line-height:1.5;">${companyName} has set up a customer portal for you, where you can view your appointments, invoices, and service history any time.</p>
            <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.5;">Click the secure button below to get started. It signs you in instantly — and on your first visit you'll be asked to choose a password so you can log in any time afterwards.</p>
            ${opts.portalUrl ? `<p style="margin:0 0 8px;font-size:14px;color:#6b7280;line-height:1.5;">After setting your password, you can log in any time at:<br /><a href="${escapeHtml(opts.portalUrl)}" style="color:${resolveAccent(opts.primaryColor)};word-break:break-all;">${escapeHtml(opts.portalUrl)}</a></p>` : ""}`;

  const loginHtml = `
            <p style="margin:0 0 16px;font-size:16px;color:#111827;">Hi ${customerName},</p>
            <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.5;">Here is your secure, one-click login link for the ${companyName} customer portal — no password needed. Just tap the button below.</p>
            ${opts.portalUrl ? `<p style="margin:0 0 8px;font-size:14px;color:#6b7280;line-height:1.5;">You can also log in with your email and password any time at:<br /><a href="${escapeHtml(opts.portalUrl)}" style="color:${resolveAccent(opts.primaryColor)};word-break:break-all;">${escapeHtml(opts.portalUrl)}</a></p>` : ""}`;

  const html = buildBrandedEmailHtml({
    title: subject,
    companyName: opts.companyName,
    bodyHtml: opts.intent === "invite" ? inviteHtml : loginHtml,
    cta: { label: ctaLabel, url: opts.loginUrl },
    footerHtml: `This link expires ${escapeHtml(opts.expiresLabel)}. If you didn't ${
      opts.intent === "invite" ? "expect this email" : "request it"
    }, you can safely ignore it.<br /><br />Thank you,<br /><strong>${companyName}</strong>`,
    logoUrl: opts.logoUrl,
    primaryColor: opts.primaryColor,
  });

  await sendEmail({
    to: opts.to,
    subject,
    body: (opts.intent === "invite" ? inviteBody : loginBody).join("\n"),
    html,
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

function buildLeadAssignmentEmailHtml(opts: {
  staffName: string;
  companyName: string;
  leadName: string;
  details: Array<{ label: string; value: string }>;
  leadsUrl?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
}): string {
  const accent = opts.primaryColor && /^#[0-9a-fA-F]{3,8}$/.test(opts.primaryColor) ? opts.primaryColor : "#16a34a";
  const companyName = escapeHtml(opts.companyName);
  const staffName = escapeHtml(opts.staffName);
  const leadName = escapeHtml(opts.leadName);
  const leadsUrl = opts.leadsUrl ? escapeHtml(opts.leadsUrl) : null;

  const header = opts.logoUrl
    ? `<img src="${escapeHtml(opts.logoUrl)}" alt="${companyName}" style="max-height:56px;max-width:200px;display:block;" />`
    : `<span style="font-size:22px;font-weight:700;color:#ffffff;">${companyName}</span>`;

  const detailRows = opts.details.length
    ? opts.details
        .map(
          d => `
              <tr>
                <td style="font-size:14px;color:#6b7280;padding:4px 12px 4px 0;white-space:nowrap;vertical-align:top;">${escapeHtml(d.label)}</td>
                <td style="font-size:14px;color:#111827;font-weight:600;padding:4px 0;">${escapeHtml(d.value)}</td>
              </tr>`
        )
        .join("")
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>New lead assigned</title>
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
            <p style="margin:0 0 16px;font-size:16px;color:#111827;">Hi ${staffName},</p>
            <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.5;">A lead has been assigned to you: <strong>${leadName}</strong>.</p>
            ${detailRows
              ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border:1px solid #e5e7eb;border-radius:6px;background-color:#f9fafb;">
              <tr><td style="padding:16px 20px;">
                <table role="presentation" cellpadding="0" cellspacing="0">${detailRows}</table>
              </td></tr>
            </table>`
              : ""}
            ${leadsUrl
              ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
              <tr>
                <td style="border-radius:6px;background-color:${accent};">
                  <a href="${leadsUrl}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">View in Pipeline</a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 24px;font-size:13px;color:#6b7280;line-height:1.5;">If the button doesn't work, copy and paste this link into your browser:<br /><a href="${leadsUrl}" style="color:${accent};word-break:break-all;">${leadsUrl}</a></p>`
              : ""}
            <p style="margin:0;font-size:14px;color:#374151;line-height:1.5;">Reach out promptly so this lead doesn't go cold.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px;border-top:1px solid #e5e7eb;">
            <p style="margin:0;font-size:14px;color:#374151;">Thank you,<br /><strong>${companyName}</strong></p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

// Staff-facing notification when a lead is assigned (or reassigned) to them.
export async function sendLeadAssignmentEmail(opts: {
  to: string;
  staffName: string;
  companyName: string;
  companyEmail?: string;
  leadName: string;
  leadStatus?: string | null;
  leadSource?: string | null;
  estimatedValue?: string | null;
  leadPhone?: string | null;
  leadEmail?: string | null;
  leadsUrl?: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
}): Promise<void> {
  const body = [
    `Hi ${opts.staffName},`,
    ``,
    `A lead has been assigned to you: ${opts.leadName}.`,
    ``,
    ...(opts.leadStatus ? [`Status: ${opts.leadStatus}`] : []),
    ...(opts.leadSource ? [`Source: ${opts.leadSource}`] : []),
    ...(opts.estimatedValue ? [`Estimated value: $${opts.estimatedValue}`] : []),
    ...(opts.leadPhone ? [`Phone: ${opts.leadPhone}`] : []),
    ...(opts.leadEmail ? [`Email: ${opts.leadEmail}`] : []),
    ``,
    ...(opts.leadsUrl ? [`View it in your pipeline:`, opts.leadsUrl, ``] : []),
    `Reach out promptly so this lead doesn't go cold.`,
    ``,
    `Thank you,`,
    opts.companyName,
  ].join("\n");

  const details: Array<{ label: string; value: string }> = [
    ...(opts.leadStatus ? [{ label: "Status:", value: opts.leadStatus }] : []),
    ...(opts.leadSource ? [{ label: "Source:", value: opts.leadSource }] : []),
    ...(opts.estimatedValue ? [{ label: "Estimated value:", value: `$${opts.estimatedValue}` }] : []),
    ...(opts.leadPhone ? [{ label: "Phone:", value: opts.leadPhone }] : []),
    ...(opts.leadEmail ? [{ label: "Email:", value: opts.leadEmail }] : []),
  ];

  const html = buildLeadAssignmentEmailHtml({
    staffName: opts.staffName,
    companyName: opts.companyName,
    leadName: opts.leadName,
    details,
    leadsUrl: opts.leadsUrl,
    logoUrl: opts.logoUrl,
    primaryColor: opts.primaryColor,
  });

  await sendEmail({
    to: opts.to,
    subject: `New lead assigned to you: ${opts.leadName}`,
    body,
    html,
    replyTo: opts.companyEmail,
  });
}

export async function sendLeadAssignmentSMS(opts: {
  to: string;
  staffName: string;
  companyName: string;
  leadName: string;
  leadPhone?: string | null;
  leadsUrl?: string;
}): Promise<void> {
  const firstName = opts.staffName.split(" ")[0] || opts.staffName;
  const body = [
    `Hi ${firstName}, a new lead was assigned to you: ${opts.leadName}.`,
    ...(opts.leadPhone ? [`Phone: ${opts.leadPhone}`] : []),
    ...(opts.leadsUrl ? [`View it: ${opts.leadsUrl}`] : []),
    `— ${opts.companyName}`,
  ].join(" ");

  await sendSMS({ to: opts.to, body });
}

// ─── Platform-admin (GreenSynk-branded) emails ──────────────────────────────
// Shared branded HTML shell for platform-level emails sent from GreenSynk
// itself (not company-branded). Mirrors the look of the invoice email: green
// header bar, white card body, optional call-to-action button, and footer.
const GREENSYNK_ACCENT = "#16a34a";

function buildPlatformEmailHtml(opts: {
  title: string;
  paragraphs: string[];
  button?: { label: string; url: string } | null;
}): string {
  const accent = GREENSYNK_ACCENT;
  const title = escapeHtml(opts.title);
  const paras = opts.paragraphs
    .map(p => `<p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">${p}</p>`)
    .join("");
  const button = opts.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;">
              <tr>
                <td style="border-radius:6px;background-color:${accent};">
                  <a href="${escapeHtml(opts.button.url)}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">${escapeHtml(opts.button.label)}</a>
                </td>
              </tr>
            </table>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:24px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr>
          <td style="background-color:${accent};padding:24px 32px;">
            <span style="font-size:22px;font-weight:700;color:#ffffff;">GreenSynk</span>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            ${paras}
            ${button}
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px;border-top:1px solid #e5e7eb;">
            <p style="margin:0;font-size:14px;color:#374151;">— The GreenSynk Team</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

// Notify a platform admin that their admin access has been disabled. `reason`
// distinguishes the automatic dormancy sweep ("inactivity") from a manual
// single deactivation by another admin ("manual").
export async function sendAdminDeactivationEmail(opts: {
  to: string;
  firstName?: string | null;
  reason: "inactivity" | "manual";
  /** Optional free-text note from the acting admin (manual deactivations only). */
  note?: string | null;
  supportEmail: string;
}): Promise<void> {
  const name = (opts.firstName || "there").trim();
  const cause =
    opts.reason === "inactivity"
      ? "due to a period of inactivity on your account"
      : "by a platform administrator";
  const note = (opts.note || "").trim();

  const paragraphs = [
    `Hi ${escapeHtml(name)},`,
    `Your GreenSynk platform-admin access has been disabled ${cause}. You will no longer be able to sign in to the platform admin console until your access is restored.`,
  ];
  if (note) {
    paragraphs.push(
      `Note from the administrator: <span style="display:block;margin-top:8px;padding:12px 16px;border-left:3px solid ${GREENSYNK_ACCENT};background:#f3f4f6;color:#374151;border-radius:4px;">${escapeHtml(note)}</span>`,
    );
  }
  paragraphs.push(
    `If you believe this was a mistake, or you'd like your access reinstated, please contact a GreenSynk platform administrator at <a href="mailto:${escapeHtml(opts.supportEmail)}" style="color:${GREENSYNK_ACCENT};">${escapeHtml(opts.supportEmail)}</a>.`,
    `If you no longer need access, no action is required.`,
  );

  const body = [
    `Hi ${name},`,
    ``,
    `Your GreenSynk platform-admin access has been disabled ${cause}. You will no longer be able to sign in to the platform admin console until your access is restored.`,
    ...(note ? [``, `Note from the administrator: ${note}`] : []),
    ``,
    `If you believe this was a mistake, or you'd like your access reinstated, please contact a GreenSynk platform administrator at ${opts.supportEmail}.`,
    ``,
    `If you no longer need access, no action is required.`,
    ``,
    `— The GreenSynk Team`,
  ].join("\n");

  await sendEmail({
    to: opts.to,
    subject: "Your GreenSynk admin access has been disabled",
    body,
    html: buildPlatformEmailHtml({ title: "Admin access disabled", paragraphs }),
    replyTo: opts.supportEmail,
  });
}

// Notify a platform admin that their previously disabled access has been restored.
export async function sendAdminReactivationEmail(opts: {
  to: string;
  firstName?: string | null;
  loginUrl: string;
  supportEmail: string;
}): Promise<void> {
  const name = (opts.firstName || "there").trim();

  const paragraphs = [
    `Hi ${escapeHtml(name)},`,
    `Good news — your GreenSynk platform-admin access has been restored. You can sign in to the admin console again using the button below.`,
    `If you have any questions, reach out to us at <a href="mailto:${escapeHtml(opts.supportEmail)}" style="color:${GREENSYNK_ACCENT};">${escapeHtml(opts.supportEmail)}</a>.`,
  ];

  const body = [
    `Hi ${name},`,
    ``,
    `Good news — your GreenSynk platform-admin access has been restored. You can sign in to the admin console again here:`,
    opts.loginUrl,
    ``,
    `If you have any questions, reach out to us at ${opts.supportEmail}.`,
    ``,
    `— The GreenSynk Team`,
  ].join("\n");

  await sendEmail({
    to: opts.to,
    subject: "Your GreenSynk admin access has been restored",
    body,
    html: buildPlatformEmailHtml({
      title: "Admin access restored",
      paragraphs,
      button: { label: "Sign in to GreenSynk", url: opts.loginUrl },
    }),
    replyTo: opts.supportEmail,
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
    subject: `You've been invited to join ${opts.companyName} on GreenSynk`,
    body: `Hi ${opts.firstName},\n\nYou have been added as a team member at ${opts.companyName} on GreenSynk.\n\nHere are your login credentials:\n\nEmail: ${opts.to}\nTemporary Password: ${opts.temporaryPassword}\n\nLogin here: ${opts.loginUrl}\n\nPlease change your password after your first login.\n\nThank you,\nThe GreenSynk Team`,
  });
}
