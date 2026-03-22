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

function isMockMode(): boolean {
  return !process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN;
}

function isEmailMockMode(): boolean {
  return !process.env.EMAIL_PROVIDER_API_KEY;
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
  if (isEmailMockMode()) {
    logger.info({ mock: true, payload }, "[MOCK EMAIL] Would send email");
    return;
  }
  logger.info({ to: payload.to, subject: payload.subject }, "Sending email");
}

export async function sendSMS(payload: SMSPayload): Promise<void> {
  if (isMockMode()) {
    logger.info({ mock: true, payload }, "[MOCK SMS] Would send SMS");
    return;
  }

  try {
    const twilio = (await import('twilio')).default;
    const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
    await client.messages.create({
      body: payload.body,
      from: process.env.TWILIO_PHONE_NUMBER!,
      to: payload.to,
    });
    logger.info({ to: payload.to }, "SMS sent via Twilio");
  } catch (err) {
    logger.error({ err, payload }, "Failed to send SMS");
  }
}

export async function sendReminder(opts: {
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  scheduledStart: Date;
  serviceName?: string;
  channel: 'sms' | 'email';
}): Promise<void> {
  const dateStr = opts.scheduledStart.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const timeStr = opts.scheduledStart.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit',
  });

  if (opts.channel === 'email' && opts.customerEmail) {
    await sendEmail({
      to: opts.customerEmail,
      subject: `Appointment Reminder: ${opts.serviceName || 'Lawn Care'} on ${dateStr}`,
      body: `Hi ${opts.customerName},\n\nThis is a reminder for your upcoming appointment on ${dateStr} at ${timeStr}.\n\nService: ${opts.serviceName || 'Lawn Care'}\n\nThank you!`,
    });
  } else if (opts.channel === 'sms' && opts.customerPhone) {
    await sendSMS({
      to: opts.customerPhone,
      body: `Reminder: Your ${opts.serviceName || 'lawn care'} appointment is on ${dateStr} at ${timeStr}. Reply STOP to opt out.`,
    });
  }
}

export async function sendReviewRequestNotification(opts: {
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  reviewUrl: string;
  companyName: string;
  channel: 'sms' | 'email';
}): Promise<void> {
  if (opts.channel === 'email' && opts.customerEmail) {
    await sendEmail({
      to: opts.customerEmail,
      subject: `How was your experience with ${opts.companyName}?`,
      body: `Hi ${opts.customerName},\n\nThank you for choosing ${opts.companyName}! We'd love to hear your feedback.\n\nLeave a review: ${opts.reviewUrl}\n\nThank you!`,
    });
  } else if (opts.channel === 'sms' && opts.customerPhone) {
    await sendSMS({
      to: opts.customerPhone,
      body: `Hi ${opts.customerName}! Thanks for using ${opts.companyName}. Please leave us a review: ${opts.reviewUrl}`,
    });
  }
}
