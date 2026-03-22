import { Router } from "express";
import { db, activityLogsTable, usersTable } from "@workspace/db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router = Router();
router.use(requireAuth);

router.get("/", async (req: any, res) => {
  const { companyId } = req.user;
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 50;
  const offset = (page - 1) * limit;

  const [logs, total] = await Promise.all([
    db.select().from(activityLogsTable).where(eq(activityLogsTable.companyId, companyId)).orderBy(desc(activityLogsTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(activityLogsTable).where(eq(activityLogsTable.companyId, companyId)),
  ]);

  const userIds = [...new Set(logs.map(l => l.userId).filter(Boolean))] as number[];
  const users = userIds.length > 0 ? await db.select().from(usersTable).where(inArray(usersTable.id, userIds)) : [];
  const userMap = Object.fromEntries(users.map(u => [u.id, `${u.firstName} ${u.lastName}`]));

  return res.json({ logs: logs.map(l => ({ ...l, userName: l.userId ? userMap[l.userId] ?? null : null })), total: Number(total[0].count), page, limit });
});

export default router;
