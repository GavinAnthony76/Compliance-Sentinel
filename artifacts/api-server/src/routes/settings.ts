import { Router } from "express";
import { db, companiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { logActivity } from "../lib/activity";

const router = Router();
router.use(requireAuth);

router.get("/", async (req: any, res) => {
  const { companyId } = req.user;
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
  if (!company) return res.status(404).json({ error: "NotFound" });
  return res.json(company);
});

router.put("/", requireRole("owner", "admin"), async (req: any, res) => {
  const { companyId, userId } = req.user;
  const allowed = ["name", "phone", "email", "address", "city", "state", "zip", "website", "timezone", "primaryColor", "logoUrl", "reviewUrl"];
  const updates: any = { updatedAt: new Date() };
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  const [updated] = await db.update(companiesTable).set(updates).where(eq(companiesTable.id, companyId)).returning();
  await logActivity({ companyId, userId, action: "company.settings_updated", entityType: "company", entityId: companyId });
  return res.json(updated);
});

export default router;
