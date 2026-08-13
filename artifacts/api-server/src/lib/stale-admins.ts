import { db, pool, platformAdminsTable, activityLogsTable, DEFAULT_STALE_ADMIN_DAYS } from "@workspace/db";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { logActivity } from "./activity";
import { sendAdminDeactivationEmail } from "./notifications";
import { getPlatformSettings } from "./platform-settings";

// Fallback dormancy threshold (days) used when no platform settings row exists
// yet. The live threshold is configurable via platform settings.
export const STALE_ADMIN_DAYS = DEFAULT_STALE_ADMIN_DAYS;

// Persisted cadence for the scheduled sweep. The app checks more frequently than
// this so restarts and scale-to-zero cannot reset an in-memory 24h timer.
export const STALE_ADMIN_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Contact address surfaced to a deactivated admin so they know who to reach to
// restore access. Falls back to a sensible default when no override is set.
function resolveAdminSupportEmail(): string {
  return process.env.ADMIN_SUPPORT_EMAIL || process.env.RESEND_FROM_EMAIL || "support@greensynk.com";
}

export interface DeactivateStaleResult {
  deactivatedCount: number;
  deactivatedIds: number[];
  // True when a scheduled run was skipped because the automated sweep is
  // disabled in platform settings.
  skipped?: boolean;
  // The inactivity threshold (days) the run actually applied.
  thresholdDays: number;
}

/**
 * Deactivate every platform admin that has gone dormant (no sign-in for
 * STALE_ADMIN_DAYS, or never signed in) and email each one the branded
 * inactivity notice.
 *
 * Shared by the manual endpoint (POST /admin/admins/deactivate-stale) and the
 * recurring background scheduler so both apply identical dormancy rules.
 *
 * - `excludeAdminId` is the acting admin to skip (manual runs only) so an admin
 *   can never lock themselves out by clicking the button. The scheduled run has
 *   no actor, so nothing is excluded — that is intentional for the security
 *   control (a dormant superadmin should be locked out too).
 * - `trigger` selects the activity-log action. Manual runs preserve the
 *   existing "admin.admins_bulk_deactivated" event and only log when at least
 *   one admin was deactivated. Scheduled runs always record an
 *   "admin.admins_auto_deactivated" entry so admins can confirm the automated
 *   sweep ran, even on a no-op day.
 */
export async function deactivateStaleAdmins(opts: {
  excludeAdminId?: number;
  actorAdminId?: number;
  trigger: "manual" | "scheduled";
}): Promise<DeactivateStaleResult> {
  const settings = await getPlatformSettings();
  const thresholdDays = settings.staleAdminDays;

  // The automated daily sweep can be turned off entirely from platform
  // settings. A manual run (admin clicked the button) always proceeds.
  if (opts.trigger === "scheduled" && !settings.staleAdminSweepEnabled) {
    return { deactivatedCount: 0, deactivatedIds: [], skipped: true, thresholdDays };
  }

  const cutoff = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000);

  const conditions = [
    eq(platformAdminsTable.isActive, true),
    or(
      sql`${platformAdminsTable.lastLoginAt} is null`,
      sql`${platformAdminsTable.lastLoginAt} < ${cutoff}`,
    ),
  ];
  if (opts.excludeAdminId != null) {
    conditions.push(sql`${platformAdminsTable.id} <> ${opts.excludeAdminId}`);
  }

  const stale = await db.update(platformAdminsTable)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(...conditions))
    .returning({ id: platformAdminsTable.id, email: platformAdminsTable.email, firstName: platformAdminsTable.firstName });
  const deactivatedIds = stale.map(s => s.id);

  if (opts.trigger === "scheduled" || deactivatedIds.length > 0) {
    await logActivity({
      adminId: opts.actorAdminId,
      action: opts.trigger === "scheduled" ? "admin.admins_auto_deactivated" : "admin.admins_bulk_deactivated",
      entityType: "admin",
      metadata: { count: deactivatedIds.length, ids: deactivatedIds, thresholdDays, trigger: opts.trigger },
    });
  }

  if (deactivatedIds.length > 0) {
    // Let each newly deactivated admin know their access was disabled for
    // inactivity. Best-effort and isolated so one failure can't sink the rest.
    const supportEmail = resolveAdminSupportEmail();
    await Promise.allSettled(
      stale
        .filter(a => a.email)
        .map(a => sendAdminDeactivationEmail({
          to: a.email,
          firstName: a.firstName,
          reason: "inactivity",
          supportEmail,
        })),
    );
  }

  return { deactivatedCount: deactivatedIds.length, deactivatedIds, thresholdDays };
}

// Advisory lock key ensuring only one instance runs the scheduled sweep at a
// time when multiple server instances boot or tick concurrently (autoscale).
const STALE_ADMIN_SWEEP_LOCK_KEY = 728394652;

// The persisted cadence marker: the newest activity-log row with this action.
const SWEEP_RUN_ACTION = "admin.admins_auto_deactivated";

async function latestSweepRunAt(): Promise<Date | null> {
  const [lastRun] = await db
    .select({ createdAt: activityLogsTable.createdAt })
    .from(activityLogsTable)
    .where(eq(activityLogsTable.action, SWEEP_RUN_ACTION))
    .orderBy(desc(activityLogsTable.createdAt))
    .limit(1);
  return lastRun?.createdAt ? new Date(lastRun.createdAt) : null;
}

/**
 * Run the scheduled sweep only when the persisted activity log says it is due.
 *
 * Concurrency-safe across instances: the due-check + sweep are guarded by a
 * Postgres advisory try-lock, and the due-check is repeated under the lock so
 * a contender that waited out another instance's run doesn't run again.
 * The cadence marker write is verified after the sweep — logActivity is
 * best-effort, so if its insert was swallowed we re-insert directly and let
 * failures propagate to the caller's error logging instead of silently
 * retrying the sweep every hour.
 */
export async function runStaleAdminSweepIfDue(now = new Date()): Promise<{
  ran: boolean;
  // True when another instance held the sweep lock and we deferred to it.
  lockBusy?: boolean;
  result?: DeactivateStaleResult;
}> {
  const isDue = async () => {
    const lastRun = await latestSweepRunAt();
    return !(lastRun && now.getTime() - lastRun.getTime() < STALE_ADMIN_SWEEP_INTERVAL_MS);
  };

  // Cheap pre-check without taking the lock.
  if (!(await isDue())) return { ran: false };

  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [STALE_ADMIN_SWEEP_LOCK_KEY],
    );
    if (!rows[0]?.locked) {
      // Another instance is running the sweep right now; defer to it.
      return { ran: false, lockBusy: true };
    }
    try {
      // Re-check under the lock: a contender may have just completed the run.
      if (!(await isDue())) return { ran: false };

      const result = await deactivateStaleAdmins({ trigger: "scheduled" });

      // deactivateStaleAdmins records the cadence marker via best-effort
      // logActivity (skipped runs return before logging). Ensure a durable
      // marker exists so the hourly check doesn't re-run the sweep forever
      // and the sweep-health watchdog sees real runs.
      const marker = await latestSweepRunAt();
      if (!result.skipped && (!marker || marker.getTime() < now.getTime())) {
        await db.insert(activityLogsTable).values({
          action: SWEEP_RUN_ACTION,
          entityType: "admin",
          metadataJson: {
            count: result.deactivatedCount,
            ids: result.deactivatedIds,
            thresholdDays: result.thresholdDays,
            trigger: "scheduled",
            markerRepair: true,
          },
        });
      }

      return { ran: true, result };
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [STALE_ADMIN_SWEEP_LOCK_KEY]).catch(() => {});
    }
  } finally {
    client.release();
  }
}
