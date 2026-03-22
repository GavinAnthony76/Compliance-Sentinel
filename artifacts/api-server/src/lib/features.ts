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
  return (req: any, res: any, next: any) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const company = req.company;
    const plan = company?.subscriptionPlan || user.plan;
    if (!hasFeature(plan, feature)) {
      return res.status(403).json({
        error: "PlanUpgradeRequired",
        message: `This feature requires a higher subscription plan. Current plan: ${plan || "none"}`,
        feature,
      });
    }
    next();
  };
}
