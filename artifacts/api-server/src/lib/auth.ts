import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import type { Request, Response, NextFunction } from "express";

const JWT_SECRET = process.env.SESSION_SECRET || process.env.JWT_SECRET || "greensync-dev-secret-change-in-production";
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || JWT_SECRET + "-admin";

export interface UserJWTPayload {
  userId: number;
  companyId: number;
  role: string;
  type: "user";
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
  return jwt.verify(token, JWT_SECRET) as UserJWTPayload;
}

export function verifyAdminToken(token: string): AdminJWTPayload {
  return jwt.verify(token, ADMIN_JWT_SECRET) as AdminJWTPayload;
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
  try {
    const payload = verifyUserToken(token);
    if (payload.type !== "user") throw new Error("Invalid token type");
    (req as any).user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized", message: "Invalid or expired token" });
  }
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
