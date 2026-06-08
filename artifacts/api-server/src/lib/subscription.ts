import { db, companiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";
import type { UserJWTPayload } from "./auth";

export async function requireActiveSubscription(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (req.method === "GET") { next(); return; }

  const user = (req as any).user as UserJWTPayload | undefined;
  if (!user) { next(); return; }

  try {
    const [company] = await db
      .select({
        subscriptionStatus: companiesTable.subscriptionStatus,
        trialEndsAt: companiesTable.trialEndsAt,
      })
      .from(companiesTable)
      .where(eq(companiesTable.id, user.companyId))
      .limit(1);

    if (!company) { next(); return; }

    const isTrialing = company.subscriptionStatus === "trialing";
    const trialExpired =
      isTrialing && company.trialEndsAt
        ? new Date(company.trialEndsAt) < new Date()
        : false;
    const isCanceled = company.subscriptionStatus === "canceled";

    if (trialExpired || isCanceled) {
      res.status(402).json({
        error: "SubscriptionRequired",
        message: trialExpired
          ? "Your free trial has ended. Please upgrade to continue."
          : "Your subscription has been canceled. Please reactivate to continue.",
      });
      return;
    }
  } catch {
    // DB check failed — don't block the request
  }

  next();
}
