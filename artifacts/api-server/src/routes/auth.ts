import { Router } from "express";
import { db, usersTable, companiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { signUserToken, hashPassword, verifyPassword, requireAuth } from "../lib/auth";
import { logActivity } from "../lib/activity";
import { sendEmail, sendWelcomeEmail, sendEmailVerificationEmail, resolveBaseUrl } from "../lib/notifications";
import { logger } from "../lib/logger";
import { z } from "zod";
import crypto from "crypto";

const router = Router();

const registerSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().transform((s) => s.trim().toLowerCase()),
  password: z.string().min(8),
  companyName: z.string().min(1),
  phone: z.string().optional(),
  // The plan the user picked during onboarding. This only determines which
  // plan their free trial is attached to — it does NOT grant a paid
  // subscription. Converting to a paid plan still requires a confirmed
  // Stripe checkout/webhook (see routes/billing.ts).
  selectedPlan: z.enum(["starter", "growth", "pro"]).optional(),
});

// Login accepts EITHER an email or a phone number as the identifier. Phone login
// only works when the phone is present on exactly one active account (uniqueness
// is enforced at register/team-create going forward; ambiguous matches are
// rejected as invalid credentials below).
const loginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
});

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Normalize a phone number for uniqueness/lookup: strip everything that isn't a
// digit so "(555) 123-4567" and "5551234567" collide.
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

function looksLikeEmail(identifier: string): boolean {
  return identifier.includes("@");
}

// Issue a fresh email-verification token and email it. Returns nothing; callers
// treat delivery as fire-and-forget (never block signup/resend on email).
async function issueEmailVerification(user: { id: number; email: string; firstName: string }): Promise<void> {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS);
  await db.update(usersTable)
    .set({ emailVerificationToken: tokenHash, emailVerificationExpiresAt: expiresAt, updatedAt: new Date() })
    .where(eq(usersTable.id, user.id));
  const verifyUrl = `${resolveBaseUrl()}/verify-email?token=${rawToken}`;
  void sendEmailVerificationEmail({ to: user.email, firstName: user.firstName, verifyUrl })
    .catch((err) => logger.error({ err, to: user.email }, "Failed to send verification email"));
}

// Simple in-memory rate limit for resend-confirmation: at most 3 sends per email
// per hour. In-process only (acceptable for a single API instance); it caps
// abuse without a DB table.
const resendAttempts = new Map<string, number[]>();
function canResend(email: string): boolean {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const hits = (resendAttempts.get(email) ?? []).filter(t => now - t < windowMs);
  if (hits.length >= 3) {
    resendAttempts.set(email, hits);
    return false;
  }
  hits.push(now);
  resendAttempts.set(email, hits);
  return true;
}

router.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "ValidationError", message: parsed.error.message });
  }

  const { firstName, lastName, email, password, companyName, phone, selectedPlan } = parsed.data;

  if (!PASSWORD_REGEX.test(password)) {
    return res.status(400).json({
      error: "WeakPassword",
      message: "Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character.",
    });
  }

  const existing = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existing.length > 0) {
    return res.status(409).json({ error: "ConflictError", message: "Email already in use" });
  }

  // Phone is optional, but if provided it must be unique across users so it can
  // be used as a login identifier.
  if (phone && phone.trim()) {
    const normalized = normalizePhone(phone);
    if (normalized) {
      const phoneMatches = await db.select({ id: usersTable.id, phone: usersTable.phone }).from(usersTable);
      const taken = phoneMatches.some(u => u.phone && normalizePhone(u.phone) === normalized);
      if (taken) {
        return res.status(409).json({ error: "ConflictError", message: "Phone number is already in use" });
      }
    }
  }

  const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + Date.now().toString(36);
  const passwordHash = await hashPassword(password);

  const [company] = await db.insert(companiesTable).values({
    name: companyName,
    slug,
    // Default the company's contact/notification address to the owner's email so
    // company-directed notifications (booking requests, cancellations) have a
    // recipient out of the box. The owner can change it later in settings.
    email,
    // Trial is attached to the plan the user selected during onboarding so
    // they can evaluate that tier's features. This is a time-boxed trial,
    // not a paid subscription — converting to paid still requires Stripe.
    subscriptionPlan: selectedPlan ?? "growth",
    subscriptionStatus: "trialing",
    trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    isActive: true,
  }).returning();

  // New self-serve signups start UNVERIFIED — login is hard-gated until they
  // click the emailed confirmation link.
  const [user] = await db.insert(usersTable).values({
    companyId: company.id,
    firstName,
    lastName,
    email,
    passwordHash,
    role: "owner",
    phone: phone ?? null,
    isActive: true,
    emailVerified: false,
  }).returning();

  await logActivity({
    companyId: company.id,
    userId: user.id,
    action: "company.registered",
    entityType: "company",
    entityId: company.id,
    metadata: { selectedPlan: company.subscriptionPlan },
  });

  // Send the email-confirmation link (non-fatal — must never block signup).
  await issueEmailVerification(user);

  // No token returned: the user must confirm their email before they can log in.
  return res.status(201).json({
    success: true,
    requiresVerification: true,
    email: user.email,
    message: "Account created. Please check your email to confirm your address before signing in.",
  });
});

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "ValidationError", message: parsed.error.message });
  }

  const { identifier, password } = parsed.data;
  const trimmed = identifier.trim();

  // Resolve the account by email or phone. Phone lookups must match exactly one
  // active account; ambiguous matches are treated as invalid credentials.
  let user: typeof usersTable.$inferSelect | undefined;
  if (looksLikeEmail(trimmed)) {
    [user] = await db.select().from(usersTable).where(eq(usersTable.email, trimmed.toLowerCase())).limit(1);
  } else {
    const normalized = normalizePhone(trimmed);
    if (normalized) {
      const candidates = await db.select().from(usersTable);
      const matches = candidates.filter(u => u.isActive && u.phone && normalizePhone(u.phone) === normalized);
      if (matches.length === 1) user = matches[0];
    }
  }

  if (!user || !user.isActive) {
    return res.status(401).json({ error: "AuthError", message: "Invalid credentials" });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "AuthError", message: "Invalid credentials" });
  }

  // Hard email-verification gate: unverified accounts cannot log in.
  if (!user.emailVerified) {
    return res.status(403).json({
      error: "EmailNotVerified",
      message: "Please confirm your email address before signing in. Check your inbox for the confirmation link.",
      email: user.email,
    });
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

// Confirm a company user's email via the link they received. Marks them
// verified, clears the token, and sends the welcome email (now that the address
// is confirmed). Returns success only — the user proceeds to log in.
router.post("/verify-email", async (req, res) => {
  const parsed = z.object({ token: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "ValidationError", message: parsed.error.message });

  const tokenHash = crypto.createHash("sha256").update(parsed.data.token).digest("hex");
  const [user] = await db.select().from(usersTable).where(eq(usersTable.emailVerificationToken, tokenHash)).limit(1);
  if (!user) return res.status(400).json({ error: "InvalidToken", message: "Invalid or expired confirmation link." });

  // Already-verified: token was consumed but treat a re-click as success.
  if (user.emailVerified) {
    return res.json({ success: true, message: "Your email is already confirmed. You can sign in." });
  }
  if (!user.emailVerificationExpiresAt || user.emailVerificationExpiresAt < new Date()) {
    return res.status(400).json({ error: "ExpiredToken", message: "This confirmation link has expired. Please request a new one." });
  }

  await db.update(usersTable)
    .set({ emailVerified: true, emailVerificationToken: null, emailVerificationExpiresAt: null, updatedAt: new Date() })
    .where(eq(usersTable.id, user.id));

  await logActivity({ companyId: user.companyId, userId: user.id, action: "user.email_verified", entityType: "user", entityId: user.id });

  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, user.companyId)).limit(1);
  // Now that the address is confirmed, send the welcome email (fire-and-forget).
  void sendWelcomeEmail({
    to: user.email,
    firstName: user.firstName,
    companyName: company?.name ?? "your company",
    loginUrl: `${resolveBaseUrl()}/login`,
  }).catch(() => { /* logged inside sendEmail */ });

  return res.json({ success: true, message: "Your email has been confirmed. You can now sign in." });
});

// Resend the email-confirmation link. Always returns success to avoid account
// enumeration; rate-limited to 3 sends per email per hour.
router.post("/resend-confirmation", async (req, res) => {
  const parsed = z.object({ email: z.string().email() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "ValidationError", message: parsed.error.message });

  const email = parsed.data.email.toLowerCase();
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);

  // Throttle silently: rate-limited requests still return the same generic 200
  // as nonexistent/already-verified accounts so the response can't be used to
  // distinguish real unconfirmed accounts (account enumeration).
  if (user && user.isActive && !user.emailVerified && canResend(email)) {
    await issueEmailVerification(user);
  }

  return res.json({ success: true, message: "If that account exists and is unconfirmed, a new confirmation link has been sent." });
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

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, parsed.data.email.trim().toLowerCase())).limit(1);

  // Always return success to avoid email enumeration
  if (user && user.isActive) {
    const rawToken = crypto.randomBytes(32).toString("hex");
    // Store a SHA-256 hash of the token — not the raw value — so a DB read
    // cannot be used to immediately consume the link.
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await db.update(usersTable).set({ passwordResetToken: tokenHash, passwordResetExpiresAt: expiresAt, updatedAt: new Date() }).where(eq(usersTable.id, user.id));

    const resetUrl = `${resolveBaseUrl()}/reset-password?token=${rawToken}`;
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

  // Hash the incoming raw token before DB lookup — tokens are stored as SHA-256
  // hashes so a DB compromise cannot be used to consume outstanding reset links.
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const [user] = await db.select().from(usersTable).where(eq(usersTable.passwordResetToken, tokenHash)).limit(1);
  if (!user) return res.status(400).json({ error: "InvalidToken", message: "Invalid or expired reset link" });
  if (!user.passwordResetExpiresAt || user.passwordResetExpiresAt < new Date()) {
    return res.status(400).json({ error: "ExpiredToken", message: "This reset link has expired. Please request a new one." });
  }

  const passwordHash = await hashPassword(password);
  const now = new Date();
  await db.update(usersTable)
    .set({ passwordHash, passwordResetToken: null, passwordResetExpiresAt: null, passwordChangedAt: now, updatedAt: now })
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

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, parsed.data.email.trim().toLowerCase())).limit(1);

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
