import { Router } from "express";
import { db, usersTable, companiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { signUserToken, hashPassword, verifyPassword, requireAuth } from "../lib/auth";
import { logActivity } from "../lib/activity";
import { sendEmail, sendWelcomeEmail, resolveBaseUrl } from "../lib/notifications";
import { z } from "zod";
import crypto from "crypto";

const router = Router();

const registerSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  companyName: z.string().min(1),
  phone: z.string().optional(),
  // The plan the user picked during onboarding. This only determines which
  // plan their free trial is attached to — it does NOT grant a paid
  // subscription. Converting to a paid plan still requires a confirmed
  // Stripe checkout/webhook (see routes/billing.ts).
  selectedPlan: z.enum(["starter", "growth", "pro"]).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "ValidationError", message: parsed.error.message });
  }

  const { firstName, lastName, email, password, companyName, phone, selectedPlan } = parsed.data;

  const existing = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existing.length > 0) {
    return res.status(409).json({ error: "ConflictError", message: "Email already in use" });
  }

  const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + Date.now().toString(36);
  const passwordHash = await hashPassword(password);

  const [company] = await db.insert(companiesTable).values({
    name: companyName,
    slug,
    // Trial is attached to the plan the user selected during onboarding so
    // they can evaluate that tier's features. This is a time-boxed trial,
    // not a paid subscription — converting to paid still requires Stripe.
    subscriptionPlan: selectedPlan ?? "growth",
    subscriptionStatus: "trialing",
    trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    isActive: true,
  }).returning();

  const [user] = await db.insert(usersTable).values({
    companyId: company.id,
    firstName,
    lastName,
    email,
    passwordHash,
    role: "owner",
    phone: phone ?? null,
    isActive: true,
  }).returning();

  await logActivity({
    companyId: company.id,
    userId: user.id,
    action: "company.registered",
    entityType: "company",
    entityId: company.id,
    metadata: { selectedPlan: company.subscriptionPlan },
  });

  const token = signUserToken({ userId: user.id, companyId: company.id, role: user.role });

  // Send a welcome email (non-fatal — must never block signup)
  void sendWelcomeEmail({
    to: user.email,
    firstName: user.firstName,
    companyName: company.name,
    loginUrl: `${resolveBaseUrl()}/login`,
  }).catch(() => { /* logged inside sendEmail */ });

  return res.status(201).json({
    user: {
      id: user.id,
      companyId: user.companyId,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      phone: user.phone,
      isActive: user.isActive,
      company: {
        id: company.id,
        name: company.name,
        slug: company.slug,
        subscriptionPlan: company.subscriptionPlan,
        subscriptionStatus: company.subscriptionStatus,
        trialEndsAt: company.trialEndsAt,
        createdAt: company.createdAt,
      },
    },
    token,
  });
});

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "ValidationError", message: parsed.error.message });
  }

  const { email, password } = parsed.data;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (!user || !user.isActive) {
    return res.status(401).json({ error: "AuthError", message: "Invalid email or password" });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "AuthError", message: "Invalid email or password" });
  }

  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, user.companyId)).limit(1);

  await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));

  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "user.login",
    entityType: "user",
    entityId: user.id,
  });

  const token = signUserToken({ userId: user.id, companyId: user.companyId, role: user.role });

  return res.json({
    user: {
      id: user.id,
      companyId: user.companyId,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      phone: user.phone,
      isActive: user.isActive,
      company: {
        id: company.id,
        name: company.name,
        slug: company.slug,
        logoUrl: company.logoUrl,
        primaryColor: company.primaryColor,
        subscriptionPlan: company.subscriptionPlan,
        subscriptionStatus: company.subscriptionStatus,
        trialEndsAt: company.trialEndsAt,
        reviewUrl: company.reviewUrl,
        createdAt: company.createdAt,
      },
    },
    token,
  });
});

router.post("/logout", (_req, res) => {
  return res.json({ success: true, message: "Logged out" });
});

router.get("/me", requireAuth, async (req: any, res) => {
  const { userId, companyId } = req.user;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);

  return res.json({
    id: user.id,
    companyId: user.companyId,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    phone: user.phone,
    isActive: user.isActive,
    company: company ? {
      id: company.id,
      name: company.name,
      slug: company.slug,
      logoUrl: company.logoUrl,
      primaryColor: company.primaryColor,
      phone: company.phone,
      email: company.email,
      address: company.address,
      city: company.city,
      state: company.state,
      zip: company.zip,
      website: company.website,
      timezone: company.timezone,
      subscriptionPlan: company.subscriptionPlan,
      subscriptionStatus: company.subscriptionStatus,
      trialEndsAt: company.trialEndsAt,
      reviewUrl: company.reviewUrl,
      createdAt: company.createdAt,
    } : null,
  });
});

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;

router.post("/forgot-password", async (req, res) => {
  const parsed = z.object({ email: z.string().email() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "ValidationError", message: parsed.error.message });

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, parsed.data.email)).limit(1);

  // Always return success to avoid email enumeration
  if (user && user.isActive) {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await db.update(usersTable).set({ passwordResetToken: token, passwordResetExpiresAt: expiresAt, updatedAt: new Date() }).where(eq(usersTable.id, user.id));

    const resetUrl = `${resolveBaseUrl()}/reset-password?token=${token}`;
    await sendEmail({
      to: user.email,
      subject: "Reset your GreenSynk password",
      body: [
        `Hi ${user.firstName},`,
        "",
        "We received a request to reset the password for your GreenSynk account.",
        "",
        "Click the link below to set a new password. This link is valid for 1 hour:",
        "",
        resetUrl,
        "",
        "Your new password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character.",
        "",
        "If you did not request a password reset, you can safely ignore this email. Your password will not change.",
        "",
        "— The GreenSynk Team",
      ].join("\n"),
    });
  }

  return res.json({ success: true, message: "If that email is registered, a reset link has been sent." });
});

router.post("/reset-password", async (req, res) => {
  const parsed = z.object({ token: z.string().min(1), password: z.string().min(8) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "ValidationError", message: parsed.error.message });

  const { token, password } = parsed.data;

  if (!PASSWORD_REGEX.test(password)) {
    return res.status(400).json({
      error: "WeakPassword",
      message: "Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character.",
    });
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.passwordResetToken, token)).limit(1);
  if (!user) return res.status(400).json({ error: "InvalidToken", message: "Invalid or expired reset link" });
  if (!user.passwordResetExpiresAt || user.passwordResetExpiresAt < new Date()) {
    return res.status(400).json({ error: "ExpiredToken", message: "This reset link has expired. Please request a new one." });
  }

  const passwordHash = await hashPassword(password);
  await db.update(usersTable)
    .set({ passwordHash, passwordResetToken: null, passwordResetExpiresAt: null, updatedAt: new Date() })
    .where(eq(usersTable.id, user.id));

  await logActivity({ companyId: user.companyId, userId: user.id, action: "user.password_reset", entityType: "user", entityId: user.id });

  // Send security confirmation email
  await sendEmail({
    to: user.email,
    subject: "Your GreenSynk password was changed",
    body: [
      `Hi ${user.firstName},`,
      "",
      "This is a confirmation that the password for your GreenSynk account (${user.email}) was successfully changed.",
      "",
      `Password changed at: ${new Date().toUTCString()}`,
      "",
      "If you made this change, no further action is needed.",
      "",
      "If you did NOT request this change, your account may be compromised. Please contact us immediately or reset your password again:",
      "",
      `${resolveBaseUrl()}/forgot-password`,
      "",
      "— The GreenSynk Team",
    ].join("\n").replace("${user.email}", user.email),
  });

  return res.json({ success: true, message: "Password updated successfully." });
});

router.post("/forgot-username", async (req, res) => {
  const parsed = z.object({ email: z.string().email() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "ValidationError", message: parsed.error.message });

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, parsed.data.email)).limit(1);

  // Always return success to avoid account enumeration
  if (user && user.isActive) {
    const loginUrl = `${resolveBaseUrl()}/login`;
    await sendEmail({
      to: user.email,
      subject: "Your GreenSynk login (username) details",
      body: [
        `Hi ${user.firstName},`,
        "",
        "We received a request to look up the login details for your GreenSynk account.",
        "",
        "Your username (login email) is:",
        "",
        `  ${user.email}`,
        "",
        `Account name: ${user.firstName} ${user.lastName}`,
        `Account role: ${user.role.charAt(0).toUpperCase() + user.role.slice(1)}`,
        "",
        "You can sign in here:",
        "",
        loginUrl,
        "",
        "If you've also forgotten your password, you can reset it at:",
        "",
        `${resolveBaseUrl()}/forgot-password`,
        "",
        "If you did not request this email, you can safely ignore it.",
        "",
        "— The GreenSynk Team",
      ].join("\n"),
    });
  }

  return res.json({ success: true, message: "If that email is registered, your account details have been sent." });
});

export default router;
