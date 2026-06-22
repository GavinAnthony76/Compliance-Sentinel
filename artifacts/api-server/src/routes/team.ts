import { Router } from "express";
import { db, usersTable, companiesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, requireRole, hashPassword } from "../lib/auth";
import { requireActiveSubscription } from "../lib/subscription";
import { requireFeature, requireWithinPlanLimit } from "../lib/features";
import { logActivity } from "../lib/activity";
import { sendTeamInviteEmail, resolveBaseUrl } from "../lib/notifications";

const router = Router();
router.use(requireAuth);
router.use(requireActiveSubscription);
// Team management is a manager capability — staff have no access.
router.use(requireRole("owner", "admin"));

router.get("/", async (req: any, res) => {
  const { companyId } = req.user;
  const members = await db.select({
    id: usersTable.id,
    companyId: usersTable.companyId,
    firstName: usersTable.firstName,
    lastName: usersTable.lastName,
    email: usersTable.email,
    role: usersTable.role,
    phone: usersTable.phone,
    isActive: usersTable.isActive,
    lastLoginAt: usersTable.lastLoginAt,
    createdAt: usersTable.createdAt,
  }).from(usersTable).where(eq(usersTable.companyId, companyId)).orderBy(desc(usersTable.createdAt));
  return res.json({ members });
});

router.post("/", requireRole("owner", "admin"), requireFeature("team_management"), requireWithinPlanLimit("users"), async (req: any, res) => {
  const { companyId, userId } = req.user;

  const existing = await db.select().from(usersTable).where(eq(usersTable.email, req.body.email)).limit(1);
  if (existing.length > 0) {
    return res.status(409).json({ error: "ConflictError", message: "Email already in use" });
  }

  // Phone (optional) must be unique across all users so it can serve as a login
  // identifier — match on digits only.
  if (req.body.phone && String(req.body.phone).trim()) {
    const normalized = String(req.body.phone).replace(/\D/g, "");
    if (normalized) {
      const all = await db.select({ phone: usersTable.phone }).from(usersTable);
      if (all.some(u => u.phone && u.phone.replace(/\D/g, "") === normalized)) {
        return res.status(409).json({ error: "ConflictError", message: "Phone number is already in use" });
      }
    }
  }

  const temporaryPassword = req.body.password;
  const passwordHash = await hashPassword(temporaryPassword);
  const [member] = await db.insert(usersTable).values({
    companyId,
    firstName: req.body.firstName,
    lastName: req.body.lastName,
    email: req.body.email,
    passwordHash,
    role: req.body.role ?? "staff",
    phone: req.body.phone ?? null,
    isActive: true,
  }).returning();

  await logActivity({ companyId, userId, action: "team.member_invited", entityType: "user", entityId: member.id });

  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
  sendTeamInviteEmail({
    to: member.email,
    firstName: member.firstName,
    lastName: member.lastName,
    companyName: company?.name ?? "your company",
    temporaryPassword,
    loginUrl: resolveBaseUrl(),
  }).catch((err) => {
    import("../lib/logger").then(({ logger }) => {
      logger.error({ err, to: member.email }, "Failed to send team invite email");
    });
  });

  return res.status(201).json({
    id: member.id,
    companyId: member.companyId,
    firstName: member.firstName,
    lastName: member.lastName,
    email: member.email,
    role: member.role,
    phone: member.phone,
    isActive: member.isActive,
    lastLoginAt: member.lastLoginAt,
    createdAt: member.createdAt,
  });
});

router.put("/:id", requireRole("owner", "admin"), requireFeature("team_management"), async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(usersTable).where(and(eq(usersTable.id, id), eq(usersTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });

  const updates: any = { updatedAt: new Date() };
  if (req.body.firstName) updates.firstName = req.body.firstName;
  if (req.body.lastName) updates.lastName = req.body.lastName;
  if (req.body.role && req.user.role === "owner") updates.role = req.body.role;
  if (req.body.phone !== undefined) updates.phone = req.body.phone;
  if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;

  const [updated] = await db.update(usersTable).set(updates).where(and(eq(usersTable.id, id), eq(usersTable.companyId, companyId))).returning();
  await logActivity({ companyId, userId, action: "team.member_updated", entityType: "user", entityId: id });
  return res.json({
    id: updated.id,
    companyId: updated.companyId,
    firstName: updated.firstName,
    lastName: updated.lastName,
    email: updated.email,
    role: updated.role,
    phone: updated.phone,
    isActive: updated.isActive,
    lastLoginAt: updated.lastLoginAt,
    createdAt: updated.createdAt,
  });
});

router.delete("/:id", requireRole("owner"), requireFeature("team_management"), async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  if (id === req.user.userId) return res.status(400).json({ error: "Cannot remove yourself" });
  const [existing] = await db.select().from(usersTable).where(and(eq(usersTable.id, id), eq(usersTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });
  await db.delete(usersTable).where(and(eq(usersTable.id, id), eq(usersTable.companyId, companyId)));
  await logActivity({ companyId, userId, action: "team.member_removed", entityType: "user", entityId: id });
  return res.json({ success: true });
});

export default router;
