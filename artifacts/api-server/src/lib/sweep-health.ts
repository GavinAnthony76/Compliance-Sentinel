import { db, activityLogsTable, platformAdminsTable, platformSettingsTable } from "@workspace/db";
import { desc, eq, asc, and, sql } from "drizzle-orm";
import { logActivity } from "./activity";
import { logger } from "./logger";
import { resolveBaseUrl, sendSweepHealthAlertEmail, sendSweepHealthRecoveredEmail } from "./notifications";
import { getPlatformSettings } from "./platform-settings";

// The scheduled dormancy sweep logs an "admin.admins_auto_deactivated" activity
// entry on EVERY run (even a no-op day), so a healthy scheduler produces a
// fresh entry roughly every 24h. If the sweep is enabled but no run has been
// recorded for longer than this, the scheduler is presumed dead and we alert.
export const SWEEP_STALE_ALERT_MS = 48 * 60 * 60 * 1000;

// While the scheduler stays dead we re-alert at most once per this window, so
// admins get a daily nudge rather than an email every monitor tick. The dedupe
// marker is an activity-log entry, so it survives server restarts.
export const SWEEP_ALERT_DEDUPE_MS = 24 * 60 * 60 * 1000;

// Activity-log actions involved in the health check.
const SWEEP_RUN_ACTION = "admin.admins_auto_deactivated";
export const SWEEP_ALERT_ACTION = "admin.sweep_health_alert_sent";
export const SWEEP_RECOVERED_ACTION = "admin.sweep_health_recovered";

function resolveAdminSupportEmail(): string {
  return process.env.ADMIN_SUPPORT_EMAIL || process.env.RESEND_FROM_EMAIL || "support@greensynk.com";
}

export interface SweepHealthResult {
  alerted: boolean;
  reason:
    | "alerted"
    | "sweep_disabled"
    | "run_recent"
    | "no_reference"
    | "recently_alerted"
    | "no_recipients"
    | "recovered";
  overdueMs?: number;
  /** True when this tick sent the one-time "sweep recovered" email. */
  recovered?: boolean;
}

async function latestLog(action: string) {
  const [row] = await db
    .select()
    .from(activityLogsTable)
    .where(eq(activityLogsTable.action, action))
    .orderBy(desc(activityLogsTable.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * Detect a dead lockout-sweep scheduler and email platform admins about it.
 *
 * Piggybacks on the background monitor interval in app.ts. Logic:
 * - The automated sweep must be enabled in platform settings (a deliberately
 *   disabled sweep is not a fault — no alert).
 * - Reference time = last recorded scheduled run. If no run was EVER recorded,
 *   fall back to the oldest activity-log entry (a proxy for how long the
 *   system has been alive) so a fresh install doesn't alert instantly; if the
 *   activity log is completely empty we cannot judge staleness and skip.
 * - Alert when the reference is older than SWEEP_STALE_ALERT_MS.
 * - Dedupe: an "admin.sweep_health_alert_sent" activity entry marks the last
 *   alert; we do not re-alert within SWEEP_ALERT_DEDUPE_MS. Once the sweep
 *   runs again, the staleness condition clears and the cycle resets.
 * - Emails go to every active platform admin with an email address, via
 *   sendEmail (which short-circuits under NODE_ENV === "test").
 */
export async function checkSweepHealth(now: Date = new Date()): Promise<SweepHealthResult> {
  const settings = await getPlatformSettings();
  if (!settings.staleAdminSweepEnabled) {
    return { alerted: false, reason: "sweep_disabled" };
  }

  const lastRun = await latestLog(SWEEP_RUN_ACTION);

  // Recovery: an outage alert went out, and the sweep has since recorded a
  // newer run — close the loop with a one-time "all clear" email. Dedupe is an
  // atomic per-incident claim on the platform_settings singleton (conditional
  // UPDATE keyed by the alert timestamp), so overlapping monitor ticks or
  // multiple server instances cannot double-send, and a failed claim write
  // aborts the send instead of emailing un-deduped.
  if (lastRun) {
    const lastAlertMarker = await latestLog(SWEEP_ALERT_ACTION);
    if (lastAlertMarker && new Date(lastRun.createdAt).getTime() > new Date(lastAlertMarker.createdAt).getTime()) {
      const recovered = await sendRecoveryNotice(
        new Date(lastRun.createdAt),
        new Date(lastAlertMarker.createdAt),
      );
      if (recovered) {
        return { alerted: false, reason: "recovered", recovered: true };
      }
    }
  }

  let referenceAt: Date | null = lastRun ? new Date(lastRun.createdAt) : null;
  if (!referenceAt) {
    // Never ran: measure against system age (oldest activity-log entry).
    const [oldest] = await db
      .select()
      .from(activityLogsTable)
      .orderBy(asc(activityLogsTable.createdAt))
      .limit(1);
    referenceAt = oldest ? new Date(oldest.createdAt) : null;
  }
  if (!referenceAt) {
    // No activity history at all (brand-new install) — nothing to judge yet.
    return { alerted: false, reason: "no_reference" };
  }

  const overdueMs = now.getTime() - referenceAt.getTime();
  if (overdueMs < SWEEP_STALE_ALERT_MS) {
    return { alerted: false, reason: "run_recent" };
  }

  // Dedupe against the last alert marker so a dead scheduler produces at most
  // one email per SWEEP_ALERT_DEDUPE_MS, not one per monitor tick.
  const lastAlert = await latestLog(SWEEP_ALERT_ACTION);
  if (lastAlert && now.getTime() - new Date(lastAlert.createdAt).getTime() < SWEEP_ALERT_DEDUPE_MS) {
    return { alerted: false, reason: "recently_alerted", overdueMs };
  }

  const admins = await db
    .select({
      id: platformAdminsTable.id,
      email: platformAdminsTable.email,
      firstName: platformAdminsTable.firstName,
    })
    .from(platformAdminsTable)
    .where(eq(platformAdminsTable.isActive, true));
  const recipients = admins.filter(a => a.email);
  if (recipients.length === 0) {
    return { alerted: false, reason: "no_recipients", overdueMs };
  }

  // Record the dedupe marker BEFORE sending so overlapping ticks (or a crash
  // mid-send) can't double-email; worst case a failed send delays the next
  // nudge by one dedupe window, which is acceptable for a daily reminder.
  await logActivity({
    action: SWEEP_ALERT_ACTION,
    entityType: "admin",
    metadata: {
      lastRunAt: lastRun ? new Date(lastRun.createdAt).toISOString() : null,
      overdueHours: Math.round(overdueMs / (60 * 60 * 1000)),
      recipients: recipients.length,
    },
  });

  const adminUsersUrl = `${resolveBaseUrl()}/admin/admins`;
  const supportEmail = resolveAdminSupportEmail();
  const hoursOverdue = overdueMs / (60 * 60 * 1000);
  const results = await Promise.allSettled(
    recipients.map(a =>
      sendSweepHealthAlertEmail({
        to: a.email,
        firstName: a.firstName,
        lastRunAt: lastRun ? new Date(lastRun.createdAt) : null,
        hoursOverdue,
        adminUsersUrl,
        supportEmail,
      }),
    ),
  );
  const failed = results.filter(r => r.status === "rejected").length;
  logger.warn(
    { overdueHours: Math.round(hoursOverdue), recipients: recipients.length, failed },
    "Lockout sweep overdue — alerted platform admins",
  );

  return { alerted: true, reason: "alerted", overdueMs };
}

// Send the one-time "sweep recovered" email to all active platform admins.
// Returns true when THIS call won the per-incident claim and sent the notice;
// false when there was nobody to notify or another tick/instance already
// claimed this incident.
async function sendRecoveryNotice(recoveredRunAt: Date, alertSentAt: Date): Promise<boolean> {
  const admins = await db
    .select({
      id: platformAdminsTable.id,
      email: platformAdminsTable.email,
      firstName: platformAdminsTable.firstName,
    })
    .from(platformAdminsTable)
    .where(eq(platformAdminsTable.isActive, true));
  const recipients = admins.filter(a => a.email);
  if (recipients.length === 0) return false;

  // Atomically claim this incident BEFORE sending. The conditional UPDATE on
  // the settings singleton only succeeds when the recorded claim differs from
  // the alert being closed out, so exactly one concurrent caller wins. If the
  // write fails, the error propagates and no email goes out — never send
  // un-deduped. (Ensure the singleton row exists first.)
  await getPlatformSettings();
  const claimed = await db
    .update(platformSettingsTable)
    .set({ sweepRecoveryNotifiedAlertAt: alertSentAt, updatedAt: new Date() })
    .where(
      and(
        eq(platformSettingsTable.id, 1),
        sql`${platformSettingsTable.sweepRecoveryNotifiedAlertAt} IS DISTINCT FROM ${alertSentAt}`,
      ),
    )
    .returning({ id: platformSettingsTable.id });
  if (claimed.length === 0) return false; // another tick/instance already sent it

  const adminUsersUrl = `${resolveBaseUrl()}/admin/admins`;
  const supportEmail = resolveAdminSupportEmail();
  const results = await Promise.allSettled(
    recipients.map(a =>
      sendSweepHealthRecoveredEmail({
        to: a.email,
        firstName: a.firstName,
        recoveredRunAt,
        alertSentAt,
        adminUsersUrl,
        supportEmail,
      }),
    ),
  );
  const delivered = results.filter(r => r.status === "fulfilled" && r.value.delivered).length;
  const failed = recipients.length - delivered;

  if (delivered === 0) {
    // Nobody actually received the all-clear (sendEmail reports failures as
    // { delivered: false } rather than throwing, and thrown sends land here
    // too). The claim must not be terminal in that case: release it (only if
    // it is still ours) so the next monitor tick retries the send.
    await db
      .update(platformSettingsTable)
      .set({ sweepRecoveryNotifiedAlertAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(platformSettingsTable.id, 1),
          eq(platformSettingsTable.sweepRecoveryNotifiedAlertAt, alertSentAt),
        ),
      );
    logger.error(
      { recoveredRunAt: recoveredRunAt.toISOString(), recipients: recipients.length },
      "Lockout sweep recovery notice failed to deliver to any admin — claim released for retry",
    );
    return false;
  }

  // Delivery confirmed for at least one admin: record the dashboard-visible
  // activity entry (best-effort; NOT the dedupe mechanism — that's the claim).
  await logActivity({
    action: SWEEP_RECOVERED_ACTION,
    entityType: "admin",
    metadata: {
      recoveredRunAt: recoveredRunAt.toISOString(),
      alertSentAt: alertSentAt.toISOString(),
      recipients: recipients.length,
      delivered,
      failed,
    },
  });
  const log = failed > 0 ? logger.warn.bind(logger) : logger.info.bind(logger);
  log(
    { recoveredRunAt: recoveredRunAt.toISOString(), recipients: recipients.length, delivered, failed },
    "Lockout sweep recovered after outage — notified platform admins",
  );
  return true;
}
