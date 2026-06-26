/**
 * Twilio inbound SMS webhook.
 *
 * Mounted at POST /api/sms/webhook.
 * Twilio sends an application/x-www-form-urlencoded POST with:
 *   From, To, Body, MessageSid, AccountSid, etc.
 *
 * Keyword handling (case-insensitive, trimmed):
 *   STOP / STOPALL / UNSUBSCRIBE / CANCEL / END / QUIT → opt-out
 *   START / YES / UNSTOP                               → re-subscribe
 *   HELP / INFO                                        → help reply
 *
 * Responses use TwiML XML. All responses are 200 (Twilio requires 200).
 * Twilio request-signature validation is enforced when
 * TWILIO_AUTH_TOKEN + APP_BASE_URL are present.
 */

import { Router } from "express";
import { logger } from "../lib/logger";
import { optOutByPhone, reSubscribeByPhone, appendSmsConsentEvent, findCustomersByPhone } from "../lib/sms-consent";

const router = Router();

// ─── Required carrier copy — do NOT change these strings ─────────────────────
const STOP_REPLY =
  "You have been unsubscribed from GreenSynk SMS alerts. " +
  "You will receive no further messages. " +
  "Reply START to re-subscribe. Reply HELP for help.";

const START_REPLY =
  "You have been re-subscribed to GreenSynk SMS alerts. " +
  "Message & data rates may apply. " +
  "Reply STOP to cancel. Reply HELP for help.";

const HELP_REPLY =
  "GreenSynk Alerts: appointment reminders, estimates, and invoices from your lawn care provider. " +
  "Msg & data rates may apply. ~4 msg/mo. " +
  "Reply STOP to cancel. Visit greensynk.com/sms-policy for info.";
// ─────────────────────────────────────────────────────────────────────────────

const STOP_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START_KEYWORDS = new Set(["START", "YES", "UNSTOP"]);
const HELP_KEYWORDS = new Set(["HELP", "INFO"]);

function twiml(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

async function validateTwilioSignature(req: any): Promise<boolean> {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const baseUrl = process.env.APP_BASE_URL;
  if (!authToken || !baseUrl) {
    // Fail CLOSED in production: an unsigned/unverifiable request must never be
    // allowed to mutate consent state. Only skip validation in dev/test where
    // Twilio credentials are intentionally absent.
    if (process.env.NODE_ENV === "production") {
      logger.error("[SMS Webhook] Rejecting inbound SMS — TWILIO_AUTH_TOKEN or APP_BASE_URL not configured in production");
      return false;
    }
    logger.warn("[SMS Webhook] Skipping Twilio signature validation — TWILIO_AUTH_TOKEN or APP_BASE_URL not set (non-production)");
    return true;
  }
  try {
    const twilio = (await import("twilio")).default;
    const twilioSignature = req.headers["x-twilio-signature"] ?? "";
    const fullUrl = `${baseUrl}/api/sms/webhook`;
    return twilio.validateRequest(authToken, twilioSignature as string, fullUrl, req.body ?? {});
  } catch (err) {
    logger.error({ err }, "[SMS Webhook] Signature validation error");
    return false;
  }
}

// Twilio sends URL-encoded bodies; ensure express parses them.
// The main app.ts already mounts express.urlencoded() globally, but we add
// it here as a safety net for test environments.
router.use("/webhook", (req, _res, next) => {
  if (!req.body && req.headers["content-type"]?.includes("application/x-www-form-urlencoded")) {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      req.body = Object.fromEntries(new URLSearchParams(body));
      next();
    });
  } else {
    next();
  }
});

router.post("/webhook", async (req, res) => {
  res.set("Content-Type", "text/xml");

  // Validate Twilio signature
  const valid = await validateTwilioSignature(req);
  if (!valid) {
    logger.warn("[SMS Webhook] Invalid Twilio signature — request rejected");
    // Still return 200 with empty TwiML so Twilio doesn't retry, but don't act on it.
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
  }

  const from: string = (req.body?.From ?? "").trim();
  const rawBody: string = (req.body?.Body ?? "").trim();
  const keyword = rawBody.toUpperCase().trim();

  if (!from) {
    logger.warn("[SMS Webhook] Missing From field");
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
  }

  logger.info({ from, keyword }, "[SMS Webhook] Inbound message received");

  const source = "inbound_sms";

  if (STOP_KEYWORDS.has(keyword)) {
    const count = await optOutByPhone(from, keyword, source);
    logger.info({ from, keyword, recordsUpdated: count }, "[SMS Webhook] STOP processed");
    // Record a help-type audit event for the keyword itself (fan-out records opt_out per record)
    if (count === 0) {
      // No matching records found — still log the inbound keyword
      await appendSmsConsentEvent({ subjectType: "customer", subjectId: 0, phone: from, eventType: "stop", keyword, source });
    }
    return res.status(200).send(twiml(STOP_REPLY));
  }

  if (START_KEYWORDS.has(keyword)) {
    const count = await reSubscribeByPhone(from, keyword, source);
    logger.info({ from, keyword, recordsUpdated: count }, "[SMS Webhook] START processed");
    if (count === 0) {
      await appendSmsConsentEvent({ subjectType: "customer", subjectId: 0, phone: from, eventType: "start", keyword, source });
    }
    return res.status(200).send(twiml(START_REPLY));
  }

  if (HELP_KEYWORDS.has(keyword)) {
    // Log the HELP event — fan out across all matching customer records
    const customers = await findCustomersByPhone(from);
    if (customers.length > 0) {
      for (const c of customers) {
        await appendSmsConsentEvent({ subjectType: "customer", subjectId: c.id, phone: from, eventType: "help", keyword, source });
      }
    } else {
      await appendSmsConsentEvent({ subjectType: "customer", subjectId: 0, phone: from, eventType: "help", keyword, source });
    }
    logger.info({ from }, "[SMS Webhook] HELP processed");
    return res.status(200).send(twiml(HELP_REPLY));
  }

  // Non-keyword message — acknowledge silently
  logger.info({ from, rawBody: rawBody.slice(0, 80) }, "[SMS Webhook] Non-keyword message received — no action");
  return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
});

export default router;
