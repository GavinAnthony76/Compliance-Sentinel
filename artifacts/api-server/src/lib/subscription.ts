import { db, companiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";
import type { UserJWTPayload } from "./auth";

const PAST_DUE_GRACE_MS = 7 * 24 * 60 * 60 * 1000; // 7-day grace period for failed payments

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
        currentPeriodEnd: companiesTable.currentPeriodEnd,
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

    // past_due gets a 7-day grace period from the end of the billing period before writes are blocked.
    const isPastDue = company.subscriptionStatus === "past_due";
    const pastDueGraceExpired =
      isPastDue && company.currentPeriodEnd
        ? new Date(company.currentPeriodEnd).getTime() + PAST_DUE_GRACE_MS < Date.now()
        : false;

    if (trialExpired || isCanceled || pastDueGraceExpired) {
      const message = trialExpired
        ? "Your free trial has ended. Please upgrade to continue."
        : isCanceled
        ? "Your subscription has been canceled. Please reactivate to continue."
        : "Your payment is overdue. Please update your billing information to continue.";
      res.status(402).json({ error: "SubscriptionRequired", message });
      return;
    }
  } catch {
    // DB check failed — don't block the request
  }

  next();
}
