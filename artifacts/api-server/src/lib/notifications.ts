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
  attachments?: { filename: string; content: Buffer }[];
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
      "No Resend credentials available (RESEND_API_KEY unset) — email delivery is disabled";
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
      ...(payload.attachments && payload.attachments.length > 0
        ? { attachments: payload.attachments.map(a => ({ filename: a.filename, content: a.content })) }
        : {}),
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
}): Promise<void> {
  const dateStr = opts.preferredDate
    ? new Date(opts.preferredDate).toLocaleDateString("en-US", {
        weekday: "long", year: "numeric", month: "long", day: "numeric",
      })
    : "your preferred date (we'll confirm a time with you)";

  await sendEmail({
    to: opts.to,
    subject: `We received your booking request — ${opts.companyName}`,
    body: [
      `Hi ${opts.customerName},`,
      ``,
      `Thanks for your booking request with ${opts.companyName}! We've received it and will reach out shortly to confirm the details.`,
      ``,
      `Here's what you requested:`,
      `  Service: ${opts.serviceName || "Lawn care"}`,
      `  Preferred date: ${dateStr}`,
      ...(opts.address ? [`  Address: ${opts.address}`] : []),
      ``,
      `If anything looks off or you need to make a change, just reply to this email${opts.companyPhone ? ` or call us at ${opts.companyPhone}` : ""}.`,
      ``,
      `Thank you,`,
      opts.companyName,
    ].join("\n"),
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
  const accent = opts.primaryColor && /^#[0-9a-fA-F]{3,8}$/.test(opts.primaryColor) ? opts.primaryColor : "#16a34a";
  const companyName = escapeHtml(opts.companyName);
  const invoiceNumber = escapeHtml(opts.invoiceNumber);
  const customerName = escapeHtml(opts.customerName);
  const payNowUrl = opts.payNowUrl ? escapeHtml(opts.payNowUrl) : null;
  const paymentInstructions = (opts.paymentInstructions ?? []).map(escapeHtml);

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
}): Promise<void> {
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
    await sendEmail({
      to: company.email,
      subject: `Payment received: ${customerName} paid invoice ${inv.invoiceNumber} — $${Number(inv.total).toFixed(2)}`,
      body: [
        `Good news — you've been paid!`,
        ``,
        `${customerName} has paid invoice ${inv.invoiceNumber}.`,
        ``,
        `Amount: $${Number(inv.total).toFixed(2)}`,
        `Payment date: ${paymentDateStr}`,
        ...(inv.paymentMethod ? [`Method: ${inv.paymentMethod}`] : []),
        ``,
        `View it in your dashboard:`,
        `${baseUrl}/invoices`,
        ``,
        `— GreenSynk`,
      ].join("\n"),
    });
  } catch (err) {
    logger.error({ err, invoiceId, companyId }, "Failed to dispatch owner payment notification");
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
}): Promise<void> {
  const subject =
    opts.intent === "invite"
      ? `${opts.companyName} invited you to your customer portal`
      : `Your ${opts.companyName} portal login link`;

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

  await sendEmail({
    to: opts.to,
    subject,
    body: (opts.intent === "invite" ? inviteBody : loginBody).join("\n"),
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
