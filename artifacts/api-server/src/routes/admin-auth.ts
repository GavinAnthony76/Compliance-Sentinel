import { Router } from "express";
import { db, platformAdminsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { signAdminToken, hashPassword, verifyPassword, requireAdminAuth } from "../lib/auth";
import { logActivity } from "../lib/activity";
import { z } from "zod";

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "ValidationError", message: parsed.error.message });
  }

  const { email, password } = parsed.data;
  const [admin] = await db.select().from(platformAdminsTable).where(eq(platformAdminsTable.email, email)).limit(1);
  if (!admin || !admin.isActive) {
    return res.status(401).json({ error: "AuthError", message: "Invalid credentials" });
  }

  const valid = await verifyPassword(password, admin.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "AuthError", message: "Invalid credentials" });
  }

  await logActivity({ adminId: admin.id, action: "admin.login", entityType: "admin", entityId: admin.id });

  const token = signAdminToken({ adminId: admin.id, role: admin.role });
  return res.json({
    admin: { id: admin.id, email: admin.email, firstName: admin.firstName, lastName: admin.lastName, role: admin.role, isActive: admin.isActive, createdAt: admin.createdAt },
    token,
  });
});

router.post("/logout", (_req, res) => {
  return res.json({ success: true });
});

router.get("/me", requireAdminAuth, async (req: any, res) => {
  const { adminId } = req.admin;
  const [admin] = await db.select().from(platformAdminsTable).where(eq(platformAdminsTable.id, adminId)).limit(1);
  if (!admin) return res.status(401).json({ error: "Unauthorized" });
  return res.json({ id: admin.id, email: admin.email, firstName: admin.firstName, lastName: admin.lastName, role: admin.role, isActive: admin.isActive, createdAt: admin.createdAt });
});

export default router;
