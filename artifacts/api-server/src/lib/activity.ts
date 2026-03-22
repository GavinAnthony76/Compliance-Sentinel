import { db } from "@workspace/db";
import { activityLogsTable } from "@workspace/db";

export async function logActivity(opts: {
  companyId?: number;
  userId?: number;
  adminId?: number;
  action: string;
  entityType?: string;
  entityId?: number;
  metadata?: Record<string, any>;
}): Promise<void> {
  try {
    await db.insert(activityLogsTable).values({
      companyId: opts.companyId,
      userId: opts.userId,
      adminId: opts.adminId,
      action: opts.action,
      entityType: opts.entityType,
      entityId: opts.entityId,
      metadataJson: opts.metadata ?? null,
    });
  } catch {
    // Activity logging should never break the main flow
  }
}
