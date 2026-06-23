import { db, companiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";
import type { UserJWTPayload } from "./auth";

// Grace period after a payment failure before writes are blocked.
const PAST_DUE_GRACE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

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
        updatedAt: companiesTable.updatedAt,
      })
      .from(companiesTable)
      .where(eq(companiesTable.id, user.companyId))
      .limit(1);

    if (!company) { next(); return; }

    const now = new Date();
    const isTrialing = company.subscriptionStatus === "trialing";
    const trialExpired = isTrialing && company.trialEndsAt
      ? new Date(company.trialEndsAt) < now
      : false;
    const isCanceled = company.subscriptionStatus === "canceled";

    // past_due: block writes once the grace period expires.
    // We approximate the payment failure date as the company's last updatedAt
    // since Stripe flips the status via webhook which triggers a DB update.
    const isPastDue = company.subscriptionStatus === "past_due";
    const pastDueGraceExpired = isPastDue && company.updatedAt
      ? new Date(company.updatedAt).getTime() + PAST_DUE_GRACE_MS < now.getTime()
      : false;

    if (trialExpired || isCanceled || pastDueGraceExpired) {
      res.status(402).json({
        error: "SubscriptionRequired",
        message: trialExpired
          ? "Your free trial has ended. Please upgrade to continue."
          : isCanceled
          ? "Your subscription has been canceled. Please reactivate to continue."
          : "Your payment is past due. Please update your billing information to continue.",
      });
      return;
    }
  } catch {
    // DB check failed — don't block the request
  }

  next();
}
