import { Router } from "express";
import { db, platformAdminsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { signAdminToken, hashPassword, verifyPassword, requireAdminAuth } from "../lib/auth";
import { logActivity } from "../lib/activity";
import { sendEmail } from "../lib/notifications";
import { z } from "zod";
import crypto from "crypto";

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
    admin: { id: admin.id, email: admin.email, firstName: admin.firstName, lastName: admin.lastName, role: admin.role, isActive: admin.isActive, mustChangePassword: admin.mustChangePassword, createdAt: admin.createdAt },
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
  return res.json({ id: admin.id, email: admin.email, firstName: admin.firstName, lastName: admin.lastName, role: admin.role, isActive: admin.isActive, mustChangePassword: admin.mustChangePassword, createdAt: admin.createdAt });
});

router.post("/change-password", requireAdminAuth, async (req: any, res) => {
  const parsed = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "ValidationError", message: parsed.error.message });

  const { adminId } = req.admin;
  const { currentPassword, newPassword } = parsed.data;

  const [admin] = await db.select().from(platformAdminsTable).where(eq(platformAdminsTable.id, adminId)).limit(1);
  if (!admin || !admin.isActive) return res.status(401).json({ error: "Unauthorized" });

  const valid = await verifyPassword(currentPassword, admin.passwordHash);
  if (!valid) return res.status(400).json({ error: "InvalidPassword", message: "Current password is incorrect." });

  if (await verifyPassword(newPassword, admin.passwordHash)) {
    return res.status(400).json({ error: "SamePassword", message: "New password must be different from your current password." });
  }

  const passwordHash = await hashPassword(newPassword);
  await db.update(platformAdminsTable)
    .set({ passwordHash, mustChangePassword: false, passwordResetToken: null, passwordResetExpiresAt: null, updatedAt: new Date() })
    .where(eq(platformAdminsTable.id, adminId));

  await logActivity({ adminId, action: "admin.password_changed", entityType: "admin", entityId: adminId });

  return res.json({ success: true, message: "Password updated successfully." });
});

router.post("/forgot-password", async (req, res) => {
  const parsed = z.object({ email: z.string().email() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "ValidationError", message: parsed.error.message });

  const [admin] = await db.select().from(platformAdminsTable).where(eq(platformAdminsTable.email, parsed.data.email)).limit(1);

  if (admin && admin.isActive) {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await db.update(platformAdminsTable).set({ passwordResetToken: token, passwordResetExpiresAt: expiresAt, updatedAt: new Date() }).where(eq(platformAdminsTable.id, admin.id));

    const baseUrl = process.env.APP_BASE_URL || `https://${process.env.REPLIT_DOMAINS?.split(",")[0]}` || "http://localhost:3000";
    const resetUrl = `${baseUrl}/admin/reset-password?token=${token}`;
    await sendEmail({
      to: admin.email,
      subject: "Reset your GreenSynk admin password",
      body: `Hi ${admin.firstName},\n\nClick the link below to reset your admin password. This link expires in 1 hour.\n\n${resetUrl}\n\nIf you didn't request this, please contact the platform team immediately.`,
    });
  }

  return res.json({ success: true, message: "If that email is registered, a reset link has been sent." });
});

router.post("/reset-password", async (req, res) => {
  const parsed = z.object({ token: z.string().min(1), password: z.string().min(8) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "ValidationError", message: parsed.error.message });

  const { token, password } = parsed.data;
  const [admin] = await db.select().from(platformAdminsTable).where(eq(platformAdminsTable.passwordResetToken, token)).limit(1);
  if (!admin) return res.status(400).json({ error: "InvalidToken", message: "Invalid or expired reset link" });
  if (!admin.passwordResetExpiresAt || admin.passwordResetExpiresAt < new Date()) {
    return res.status(400).json({ error: "ExpiredToken", message: "This reset link has expired. Please request a new one." });
  }

  const passwordHash = await hashPassword(password);
  await db.update(platformAdminsTable).set({ passwordHash, passwordResetToken: null, passwordResetExpiresAt: null, updatedAt: new Date() }).where(eq(platformAdminsTable.id, admin.id));

  return res.json({ success: true, message: "Password updated successfully." });
});

export default router;
