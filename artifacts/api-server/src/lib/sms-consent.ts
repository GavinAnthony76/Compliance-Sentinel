/**
 * SMS consent enforcement layer.
 *
 * All outbound SMS must go through sendSMSWithConsent() rather than sendSMS()
 * directly. sendSMS() remains the raw primitive (test suppression, mock mode,
 * Twilio dispatch) — this module layers consent checking and footer injection
 * on top of it.
 *
 * Categories map 1-to-1 with the per-customer preference columns:
 *   appointments   → smsPrefAppointments
 *   estimates      → smsPrefEstimates
 *   invoices       → smsPrefInvoices
 *   service_updates → smsPrefServiceUpdates
 */

import { db, customersTable, smsConsentEventsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { sendSMS } from "./notifications";
import { logger } from "./logger";

export type SmsCategory =
  | "appointments"
  | "estimates"
  | "invoices"
  | "service_updates";

const STOP_FOOTER = "\nReply STOP to opt out.";

// Maps category string → customer table preference column name
const CATEGORY_PREF: Record<
  SmsCategory,
  "smsPrefAppointments" | "smsPrefEstimates" | "smsPrefInvoices" | "smsPrefServiceUpdates"
> = {
  appointments: "smsPrefAppointments",
  estimates: "smsPrefEstimates",
  invoices: "smsPrefInvoices",
  service_updates: "smsPrefServiceUpdates",
};

export type ConsentSubject =
  | { type: "customer"; id: number; companyId: number }
  | { type: "company"; id: number };

/**
 * Sends an SMS only when the recipient has opted in and the relevant category
 * preference is enabled. Appends a STOP footer when not already present.
 * Non-fatal: a consent check failure is logged and skips the send rather than
 * throwing, so the calling route is never blocked.
 */
export async function sendSMSWithConsent(opts: {
  to: string;
  body: string;
  category: SmsCategory;
  subject: ConsentSubject;
}): Promise<{ sent: boolean; reason?: string }> {
  try {
    if (opts.subject.type === "customer") {
      const [customer] = await db
        .select({
          smsOptOut: customersTable.smsOptOut,
          smsOptIn: customersTable.smsOptIn,
          smsPrefAppointments: customersTable.smsPrefAppointments,
          smsPrefEstimates: customersTable.smsPrefEstimates,
          smsPrefInvoices: customersTable.smsPrefInvoices,
          smsPrefServiceUpdates: customersTable.smsPrefServiceUpdates,
        })
        .from(customersTable)
        .where(
          and(
            eq(customersTable.id, opts.subject.id),
            eq(customersTable.companyId, opts.subject.companyId),
          ),
        )
        .limit(1);

      if (!customer) {
        logger.warn({ customerId: opts.subject.id }, "[SMS] Customer not found, skipping send");
        return { sent: false, reason: "customer_not_found" };
      }

      if (customer.smsOptOut) {
        logger.info({ customerId: opts.subject.id, to: opts.to }, "[SMS] Skipped — customer opted out");
        return { sent: false, reason: "opted_out" };
      }

      // If the customer has never explicitly opted in we still allow sends for
      // existing customers who were added before consent capture existed, but
      // the STOP footer is always present. New customers created after the
      // consent UI ships will have smsOptIn=true (set at booking).
      const prefKey = CATEGORY_PREF[opts.category];
      if (customer[prefKey] === false) {
        logger.info({ customerId: opts.subject.id, category: opts.category }, "[SMS] Skipped — category disabled");
        return { sent: false, reason: "category_disabled" };
      }
    }

    // Ensure the required STOP footer is present on every outbound message
    const body = opts.body.includes("Reply STOP") ? opts.body : `${opts.body}${STOP_FOOTER}`;

    await sendSMS({ to: opts.to, body });
    return { sent: true };
  } catch (err) {
    logger.error({ err, to: opts.to }, "[SMS] Consent-gated send failed");
    return { sent: false, reason: "error" };
  }
}

/**
 * Append an immutable consent event to the audit log.
 * Insert-only — no update or delete paths are called from this function.
 */
export async function appendSmsConsentEvent(event: {
  subjectType: "customer" | "company";
  subjectId: number;
  phone?: string | null;
  eventType: "opt_in" | "opt_out" | "stop" | "start" | "help" | "pref_update";
  keyword?: string | null;
  source: string;
  prefCategory?: string | null;
  prefValue?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  try {
    await db.insert(smsConsentEventsTable).values({
      subjectType: event.subjectType,
      subjectId: event.subjectId,
      phone: event.phone ?? null,
      eventType: event.eventType,
      keyword: event.keyword ?? null,
      source: event.source,
      prefCategory: event.prefCategory ?? null,
      prefValue: event.prefValue ?? null,
      ipAddress: event.ipAddress ?? null,
      userAgent: event.userAgent ?? null,
    });
  } catch (err) {
    logger.error({ err }, "[SMS] Failed to append consent event");
  }
}

/**
 * SQL predicate matching customersTable.phone against an inbound phone number,
 * comparing on the trailing 10 digits so stored formats like "(555) 123-4567",
 * "+15551234567", and "555-123-4567" all match. Returns a never-match predicate
 * when the inbound number has fewer than 10 digits.
 */
function customerPhoneMatches(phone: string) {
  const last10 = phone.replace(/\D/g, "").slice(-10);
  if (last10.length < 10) return sql`1 = 0`;
  return sql`right(regexp_replace(${customersTable.phone}, '[^0-9]', '', 'g'), 10) = ${last10}`;
}

/** Find all customer records whose phone matches the inbound number. */
export async function findCustomersByPhone(
  phone: string,
): Promise<{ id: number; companyId: number }[]> {
  return db
    .select({ id: customersTable.id, companyId: customersTable.companyId })
    .from(customersTable)
    .where(customerPhoneMatches(phone));
}

/**
 * Opt a phone number out across ALL customer and company records that share it.
 * Used by the inbound STOP keyword handler to fan out without knowing which
 * specific record the sender belongs to.
 */
export async function optOutByPhone(
  phone: string,
  keyword: string,
  source: string,
): Promise<number> {
  let count = 0;

  // Fan out across customers matching this phone (trailing-10-digit comparison)
  const customers = await db
    .select({ id: customersTable.id, companyId: customersTable.companyId, smsOptOut: customersTable.smsOptOut })
    .from(customersTable)
    .where(customerPhoneMatches(phone));

  for (const c of customers) {
    if (!c.smsOptOut) {
      await db
        .update(customersTable)
        .set({ smsOptOut: true, smsOptOutAt: new Date(), smsOptOutReason: keyword, updatedAt: new Date() })
        .where(and(eq(customersTable.id, c.id), eq(customersTable.companyId, c.companyId)));
      await appendSmsConsentEvent({
        subjectType: "customer",
        subjectId: c.id,
        phone,
        eventType: "stop",
        keyword,
        source,
      });
      count++;
    }
  }

  return count;
}

/**
 * Re-subscribe a phone number across all matching records (START/UNSTOP/YES).
 */
export async function reSubscribeByPhone(
  phone: string,
  keyword: string,
  source: string,
): Promise<number> {
  let count = 0;

  const customers = await db
    .select({ id: customersTable.id, companyId: customersTable.companyId, smsOptOut: customersTable.smsOptOut })
    .from(customersTable)
    .where(customerPhoneMatches(phone));

  for (const c of customers) {
    if (c.smsOptOut) {
      await db
        .update(customersTable)
        .set({ smsOptOut: false, smsOptIn: true, smsOptInAt: new Date(), smsOptInSource: "inbound_sms", smsOptOutAt: null, smsOptOutReason: null, updatedAt: new Date() })
        .where(and(eq(customersTable.id, c.id), eq(customersTable.companyId, c.companyId)));
      await appendSmsConsentEvent({
        subjectType: "customer",
        subjectId: c.id,
        phone,
        eventType: "start",
        keyword,
        source,
      });
      count++;
    }
  }

  return count;
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  // Normalise US numbers: strip leading 1 from 11-digit numbers
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}
