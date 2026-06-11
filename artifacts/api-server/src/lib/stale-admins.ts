import { db, platformAdminsTable } from "@workspace/db";
import { and, eq, or, sql } from "drizzle-orm";
import { logActivity } from "./activity";
import { sendAdminDeactivationEmail } from "./notifications";

// A platform admin is considered dormant once they have gone this many days
// without signing in (or have never signed in at all).
export const STALE_ADMIN_DAYS = 90;

// Contact address surfaced to a deactivated admin so they know who to reach to
// restore access. Falls back to a sensible default when no override is set.
function resolveAdminSupportEmail(): string {
  return process.env.ADMIN_SUPPORT_EMAIL || process.env.RESEND_FROM_EMAIL || "support@greensynk.com";
}

export interface DeactivateStaleResult {
  deactivatedCount: number;
  deactivatedIds: number[];
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
  const cutoff = new Date(Date.now() - STALE_ADMIN_DAYS * 24 * 60 * 60 * 1000);

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
      metadata: { count: deactivatedIds.length, ids: deactivatedIds, thresholdDays: STALE_ADMIN_DAYS, trigger: opts.trigger },
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

  return { deactivatedCount: deactivatedIds.length, deactivatedIds };
}
