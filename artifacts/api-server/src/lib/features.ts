import { db, companiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type Plan = "starter" | "growth" | "pro";

const PLAN_FEATURES: Record<Plan, Set<string>> = {
  starter: new Set([
    "customers",
    "services",
    "appointments",
    "invoices",
    "calendar",
    "dashboard",
    "settings",
    "booking_page",
    "email_reminders",
  ]),
  growth: new Set([
    "customers",
    "services",
    "appointments",
    "invoices",
    "calendar",
    "dashboard",
    "settings",
    "booking_page",
    "email_reminders",
    "multi_staff",
    "recurring_plans",
    "sms_reminders",
    "estimates",
    "routes",
    "customer_notes_tags",
    "review_requests",
    "reporting",
    "branded_booking",
  ]),
  pro: new Set([
    "customers",
    "services",
    "appointments",
    "invoices",
    "calendar",
    "dashboard",
    "settings",
    "booking_page",
    "email_reminders",
    "multi_staff",
    "recurring_plans",
    "sms_reminders",
    "estimates",
    "routes",
    "customer_notes_tags",
    "review_requests",
    "reporting",
    "branded_booking",
    "automations",
    "advanced_analytics",
    "csv_export",
    "lead_pipeline",
    "ai_hooks",
    "custom_intake_fields",
    "customer_portal",
  ]),
};

export function hasFeature(plan: string | null | undefined, feature: string): boolean {
  if (!plan) return false;
  const features = PLAN_FEATURES[plan as Plan];
  if (!features) return false;
  return features.has(feature);
}

export function requireFeature(feature: string) {
  return async (req: any, res: any, next: any) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const [company] = await db
        .select({ subscriptionPlan: companiesTable.subscriptionPlan })
        .from(companiesTable)
        .where(eq(companiesTable.id, user.companyId))
        .limit(1);

      const plan = company?.subscriptionPlan;

      if (!hasFeature(plan, feature)) {
        return res.status(403).json({
          error: "PlanUpgradeRequired",
          message: `This feature requires a higher subscription plan. Current plan: ${plan || "none"}`,
          feature,
          currentPlan: plan || "none",
          requiredPlan: ["multi_staff","recurring_plans","sms_reminders","estimates","routes","customer_notes_tags","review_requests","reporting","branded_booking"].includes(feature) ? "growth" : "pro",
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
