import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import type { Request, Response, NextFunction } from "express";
import { db, usersTable, companiesTable, platformAdminsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const JWT_SECRET_ENV = process.env.SESSION_SECRET || process.env.JWT_SECRET;
const ADMIN_JWT_SECRET_ENV = process.env.ADMIN_JWT_SECRET;

if (!JWT_SECRET_ENV) {
  throw new Error("Missing required environment variable: SESSION_SECRET or JWT_SECRET");
}
if (!ADMIN_JWT_SECRET_ENV) {
  throw new Error("Missing required environment variable: ADMIN_JWT_SECRET");
}

const JWT_SECRET: string = JWT_SECRET_ENV;
const ADMIN_JWT_SECRET: string = ADMIN_JWT_SECRET_ENV;

export interface UserJWTPayload {
  userId: number;
  companyId: number;
  role: string;
  type: "user";
  iat?: number;
}

export interface AdminJWTPayload {
  adminId: number;
  role: string;
  type: "admin";
}

export function signUserToken(payload: Omit<UserJWTPayload, "type">): string {
  return jwt.sign({ ...payload, type: "user" }, JWT_SECRET, { expiresIn: "7d" });
}

export function signAdminToken(payload: Omit<AdminJWTPayload, "type">): string {
  return jwt.sign({ ...payload, type: "admin" }, ADMIN_JWT_SECRET, { expiresIn: "4h" });
}

export function verifyUserToken(token: string): UserJWTPayload {
  return jwt.verify(token, JWT_SECRET) as unknown as UserJWTPayload;
}

export function verifyAdminToken(token: string): AdminJWTPayload {
  return jwt.verify(token, ADMIN_JWT_SECRET) as unknown as AdminJWTPayload;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized", message: "Authentication required" });
    return;
  }

  const token = authHeader.slice(7);
  let payload: UserJWTPayload;
  try {
    payload = verifyUserToken(token);
    if (payload.type !== "user") throw new Error("Invalid token type");
  } catch {
    res.status(401).json({ error: "Unauthorized", message: "Invalid or expired token" });
    return;
  }

  // Re-check the principal on every request so revocation takes effect for
  // tokens already issued: deleted/deactivated users, company membership and
  // role changes, password resets, and administrative company suspension.
  let row: {
    isActive: boolean;
    role: string;
    companyId: number;
    passwordChangedAt: Date | null;
    companyRowId: number | null;
    companyActive: boolean | null;
  } | undefined;
  try {
    [row] = await db
      .select({
        isActive: usersTable.isActive,
        role: usersTable.role,
        companyId: usersTable.companyId,
        passwordChangedAt: usersTable.passwordChangedAt,
        companyRowId: companiesTable.id,
        companyActive: companiesTable.isActive,
      })
      .from(usersTable)
      .leftJoin(companiesTable, eq(companiesTable.id, usersTable.companyId))
      .where(eq(usersTable.id, payload.userId))
      .limit(1);
  } catch {
    // Retryable, never unrestricted: a 503 doesn't log the client out.
    res.status(503).json({ error: "ServiceUnavailable", message: "Could not verify your session. Please try again." });
    return;
  }

  if (!row || !row.isActive || row.companyId !== payload.companyId) {
    res.status(401).json({ error: "Unauthorized", message: "This account is no longer active. Please log in again." });
    return;
  }

  // Invalidate tokens issued before the user's last password change so that
  // a stolen token is blocked as soon as the owner resets their password.
  if (row.passwordChangedAt) {
    const changedAtSec = Math.floor(row.passwordChangedAt.getTime() / 1000);
    const iat = (payload as any).iat as number | undefined;
    if (iat !== undefined && iat < changedAtSec) {
      res.status(401).json({ error: "Unauthorized", message: "Session expired. Please log in again." });
      return;
    }
  }

  if (row.companyRowId == null) {
    res.status(403).json({ error: "CompanyNotFound", message: "Your company account could not be found." });
    return;
  }
  // Administrative suspension blocks operational access; the session and
  // billing-recovery endpoints stay reachable so the account can be resolved.
  // (Subscription expiry is separate: requireActiveSubscription keeps reads.)
  if (row.companyActive === false && !isSuspensionExempt(req)) {
    res.status(403).json({ error: "CompanySuspended", message: "This company account is suspended. Please contact support." });
    return;
  }

  // Current role/company from the database, never stale token claims.
  (req as any).user = { ...payload, role: row.role, companyId: row.companyId };
  next();
}

// Narrow allowlist that stays reachable while a company is suspended:
// session endpoints (/auth/me, logout, password changes) and billing recovery.
const SUSPENSION_EXEMPT_PREFIXES = ["/api/auth/", "/api/billing"];

function isSuspensionExempt(req: Request): boolean {
  const path = (req.originalUrl || req.url || "").split("?")[0];
  return SUSPENSION_EXEMPT_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`));
}

export async function requireAdminAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized", message: "Admin authentication required" });
    return;
  }

  const token = authHeader.slice(7);
  let payload: AdminJWTPayload;
  try {
    payload = verifyAdminToken(token);
    if (payload.type !== "admin") throw new Error("Invalid token type");
  } catch {
    res.status(401).json({ error: "Unauthorized", message: "Invalid or expired admin token" });
    return;
  }

  // Re-check the admin on every request: a deleted or deactivated platform
  // admin's existing token stops working immediately, and the current role
  // is used instead of the token's.
  let admin: { isActive: boolean; role: string } | undefined;
  try {
    [admin] = await db
      .select({ isActive: platformAdminsTable.isActive, role: platformAdminsTable.role })
      .from(platformAdminsTable)
      .where(eq(platformAdminsTable.id, payload.adminId))
      .limit(1);
  } catch {
    res.status(503).json({ error: "ServiceUnavailable", message: "Could not verify your session. Please try again." });
    return;
  }
  if (!admin || !admin.isActive) {
    res.status(401).json({ error: "Unauthorized", message: "This admin account is no longer active." });
    return;
  }

  (req as any).admin = { ...payload, role: admin.role };
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as any).user as UserJWTPayload;
    if (!user || !roles.includes(user.role)) {
      res.status(403).json({ error: "Forbidden", message: "Insufficient permissions" });
      return;
    }
    next();
  };
}
