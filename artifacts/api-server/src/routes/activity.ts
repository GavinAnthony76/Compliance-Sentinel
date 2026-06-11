import { Router } from "express";
import { db, activityLogsTable, usersTable } from "@workspace/db";
import { eq, and, sql, desc, inArray, gt, ne, or, isNull, like, ilike } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router = Router();
router.use(requireAuth);

router.get("/", async (req: any, res) => {
  const { companyId } = req.user;
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 50;
  const offset = (page - 1) * limit;
  // Optional filter: only return actions in a given category (action prefix,
  // e.g. ?category=billing matches billing.plan_changed, billing.subscription_canceled, …).
  const category = typeof req.query.category === "string" ? req.query.category.trim() : "";
  // Optional free-text search across the action name, entity type, the recorded
  // actor (metadata) and the acting user's name. Combines with the category filter.
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";

  const conditions = [eq(activityLogsTable.companyId, companyId)];
  if (category) conditions.push(like(activityLogsTable.action, `${category}.%`));
  if (search) {
    const term = `%${search}%`;
    // Match the search against users (by name) within this company so we can
    // filter activity by the acting staff member as well.
    const matchingUsers = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(
        eq(usersTable.companyId, companyId),
        ilike(sql`${usersTable.firstName} || ' ' || ${usersTable.lastName}`, term),
      ));
    const matchingUserIds = matchingUsers.map(u => u.id);

    const searchConditions = [
      ilike(activityLogsTable.action, term),
      ilike(activityLogsTable.entityType, term),
      ilike(sql`${activityLogsTable.metadataJson} ->> 'actor'`, term),
    ];
    if (matchingUserIds.length > 0) {
      searchConditions.push(inArray(activityLogsTable.userId, matchingUserIds));
    }
    conditions.push(or(...searchConditions)!);
  }
  const whereClause = and(...conditions);

  const [logs, total] = await Promise.all([
    db.select().from(activityLogsTable).where(whereClause).orderBy(desc(activityLogsTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(activityLogsTable).where(whereClause),
  ]);

  const userIds = [...new Set(logs.map(l => l.userId).filter(Boolean))] as number[];
  const users = userIds.length > 0 ? await db.select().from(usersTable).where(inArray(usersTable.id, userIds)) : [];
  const userMap = Object.fromEntries(users.map(u => [u.id, `${u.firstName} ${u.lastName}`]));

  return res.json({ logs: logs.map(l => ({ ...l, userName: l.userId ? userMap[l.userId] ?? null : null })), total: Number(total[0].count), page, limit });
});

// GET /activity/unread-count — number of activity items created since the user
// last marked the activity feed as seen, excluding their own actions.
router.get("/unread-count", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const [user] = await db.select({ activitySeenAt: usersTable.activitySeenAt }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  const seenAt = user?.activitySeenAt ?? null;

  const conditions: any[] = [
    eq(activityLogsTable.companyId, companyId),
    or(isNull(activityLogsTable.userId), ne(activityLogsTable.userId, userId)),
  ];
  if (seenAt) conditions.push(gt(activityLogsTable.createdAt, seenAt));

  const [row] = await db.select({ count: sql<number>`count(*)` }).from(activityLogsTable).where(and(...conditions));
  return res.json({ unread: Number(row.count) });
});

// POST /activity/mark-seen — mark the activity feed as seen for the current user.
router.post("/mark-seen", async (req: any, res) => {
  const { userId } = req.user;
  await db.update(usersTable).set({ activitySeenAt: new Date(), updatedAt: new Date() }).where(eq(usersTable.id, userId));
  return res.json({ success: true, seenAt: new Date() });
});

export default router;
