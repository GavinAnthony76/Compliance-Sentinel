import { db, platformSettingsTable, DEFAULT_STALE_ADMIN_DAYS, type PlatformSettings } from "@workspace/db";
import { eq } from "drizzle-orm";

// The platform settings live in a single row. We pin it to id = 1 and lazily
// create it the first time it is read so callers never have to special-case a
// missing row.
const SETTINGS_ROW_ID = 1;

export { DEFAULT_STALE_ADMIN_DAYS };

// Bounds for the inactivity threshold. Keeping a sane floor/ceiling stops an
// admin from accidentally setting 0 (which would lock everyone out instantly)
// or an absurdly large value.
export const MIN_STALE_ADMIN_DAYS = 1;
export const MAX_STALE_ADMIN_DAYS = 3650;

/**
 * Fetch the singleton platform settings row, creating it with defaults the
 * first time it is requested.
 */
export async function getPlatformSettings(): Promise<PlatformSettings> {
  const existing = await db
    .select()
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.id, SETTINGS_ROW_ID))
    .limit(1);
  if (existing.length > 0) return existing[0];

  // Create the default row. onConflictDoNothing guards against a race where two
  // requests try to seed it simultaneously.
  await db
    .insert(platformSettingsTable)
    .values({ id: SETTINGS_ROW_ID } as any)
    .onConflictDoNothing();
  const [created] = await db
    .select()
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.id, SETTINGS_ROW_ID))
    .limit(1);
  return created;
}

/**
 * Update the platform settings, persisting only the provided fields. Returns
 * the full updated row.
 */
export async function updatePlatformSettings(patch: {
  staleAdminDays?: number;
  staleAdminSweepEnabled?: boolean;
}): Promise<PlatformSettings> {
  // Ensure the row exists before updating it.
  await getPlatformSettings();

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.staleAdminDays != null) {
    const clamped = Math.min(MAX_STALE_ADMIN_DAYS, Math.max(MIN_STALE_ADMIN_DAYS, Math.round(patch.staleAdminDays)));
    set.staleAdminDays = clamped;
  }
  if (patch.staleAdminSweepEnabled != null) {
    set.staleAdminSweepEnabled = patch.staleAdminSweepEnabled;
  }

  const [updated] = await db
    .update(platformSettingsTable)
    .set(set)
    .where(eq(platformSettingsTable.id, SETTINGS_ROW_ID))
    .returning();
  return updated;
}
