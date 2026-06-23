import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import type { Request, Response, NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
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
  return jwt.sign({ ...payload, type: "admin" }, ADMIN_JWT_SECRET, { expiresIn: "7d" });
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

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
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

  // Invalidate tokens issued before a password change.
  // We do this asynchronously so the hot path (no password change) adds only one
  // indexed PK lookup. On failure we fail open (don't block the request) to avoid
  // taking down the app if the DB is briefly unreachable.
  const tokenIssuedAt = payload.iat ? payload.iat * 1000 : 0;
  (req as any).user = payload;

  db.select({ passwordChangedAt: usersTable.passwordChangedAt })
    .from(usersTable)
    .where(eq(usersTable.id, payload.userId))
    .limit(1)
    .then(([row]) => {
      if (row?.passwordChangedAt && row.passwordChangedAt.getTime() > tokenIssuedAt) {
        res.status(401).json({ error: "Unauthorized", message: "Session expired. Please sign in again." });
        return;
      }
      next();
    })
    .catch(() => next());
}

export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized", message: "Admin authentication required" });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = verifyAdminToken(token);
    if (payload.type !== "admin") throw new Error("Invalid token type");
    (req as any).admin = payload;
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized", message: "Invalid or expired admin token" });
  }
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
