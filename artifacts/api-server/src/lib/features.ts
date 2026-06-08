import {
  db,
  companiesTable,
  customersTable,
  usersTable,
  appointmentsTable,
  estimatesTable,
  invoicesTable,
} from "@workspace/db";
import { eq, and, gte, lt, sql } from "drizzle-orm";

export type Plan = "starter" | "growth" | "pro";

const PLAN_ORDER: Plan[] = ["starter", "growth", "pro"];

// ---------------------------------------------------------------------------
// Plan -> feature map (mirrors the official Goshen pricing structure)
// ---------------------------------------------------------------------------

const STARTER_FEATURES = [
  "customer_crm",
  "properties",
  "services",
  "scheduling",
  "basic_job_tracking",
  "invoicing",
  "payment_collection",
  "public_booking",
  "email_reminders",
  "dashboard",
  "settings",
] as const;

const GROWTH_ONLY_FEATURES = [
  "team_management",
  "route_optimization",
  "recurring_plans",
  "customer_portal",
  "sms_notifications",
  "review_requests",
  "before_after_photos",
  "gps_tracking",
  "growth_analytics",
  "customer_notes_tags",
  "communication_timeline",
  "follow_up_campaigns",
  "branded_booking_page",
] as const;

const PRO_ONLY_FEATURES = [
  "ai_estimate_builder",
  "ai_lead_qualification",
  "ai_upsell_suggestions",
  "ai_follow_up_suggestions",
  "advanced_analytics",
  "revenue_forecasting",
  "custom_dashboards",
  "data_export",
  "api_access",
  "custom_intake_forms",
  "advanced_automations",
  "lead_pipeline",
  "lead_pipeline_ai_scoring",
  "white_label_booking",
  "autopay",
  "priority_support",
] as const;

export type FeatureKey =
  | (typeof STARTER_FEATURES)[number]
  | (typeof GROWTH_ONLY_FEATURES)[number]
  | (typeof PRO_ONLY_FEATURES)[number];

const PLAN_FEATURES: Record<Plan, Set<FeatureKey>> = {
  starter: new Set([...STARTER_FEATURES]),
  growth: new Set([...STARTER_FEATURES, ...GROWTH_ONLY_FEATURES]),
  pro: new Set([...STARTER_FEATURES, ...GROWTH_ONLY_FEATURES, ...PRO_ONLY_FEATURES]),
};

// ---------------------------------------------------------------------------
// Plan -> usage limits (null = unlimited)
// ---------------------------------------------------------------------------

export interface PlanLimits {
  maxUsers: number | null;
  maxCustomers: number | null;
  maxAppointmentsPerMonth: number | null;
  maxEstimatesPerMonth: number | null;
  maxInvoicesPerMonth: number | null;
}

const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  starter: {
    maxUsers: 1,
    maxCustomers: 50,
    maxAppointmentsPerMonth: 100,
    maxEstimatesPerMonth: 10,
    maxInvoicesPerMonth: 25,
  },
  growth: {
    maxUsers: 5,
    maxCustomers: 250,
    maxAppointmentsPerMonth: 500,
    maxEstimatesPerMonth: 100,
    maxInvoicesPerMonth: 250,
  },
  pro: {
    maxUsers: null,
    maxCustomers: null,
    maxAppointmentsPerMonth: null,
    maxEstimatesPerMonth: null,
    maxInvoicesPerMonth: null,
  },
};

export function getPlanLimits(plan: string | null | undefined): PlanLimits {
  return PLAN_LIMITS[normalizePlan(plan)];
}

/** Companies without a confirmed plan (e.g. mid-signup) get the most restrictive limits. */
function normalizePlan(plan: string | null | undefined): Plan {
  return plan === "growth" || plan === "pro" ? plan : "starter";
}

function nextPlan(plan: Plan): Plan {
  const idx = PLAN_ORDER.indexOf(plan);
  return PLAN_ORDER[Math.min(idx + 1, PLAN_ORDER.length - 1)];
}

// ---------------------------------------------------------------------------
// Feature gating
// ---------------------------------------------------------------------------

export function hasFeature(plan: string | null | undefined, feature: FeatureKey | string): boolean {
  if (!plan) return false;
  const features = PLAN_FEATURES[plan as Plan];
  if (!features) return false;
  return features.has(feature as FeatureKey);
}

/** Returns the cheapest plan that includes the given feature. */
export function getRequiredPlanForFeature(feature: FeatureKey | string): Plan {
  for (const plan of PLAN_ORDER) {
    if (PLAN_FEATURES[plan].has(feature as FeatureKey)) return plan;
  }
  return "pro";
}

async function getCompanyPlan(companyId: number): Promise<Plan | null> {
  const [company] = await db
    .select({ subscriptionPlan: companiesTable.subscriptionPlan })
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId))
    .limit(1);
  return (company?.subscriptionPlan as Plan | null) ?? null;
}

export function requireFeature(feature: FeatureKey | string) {
  return async (req: any, res: any, next: any) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const plan = await getCompanyPlan(user.companyId);

      if (!hasFeature(plan, feature)) {
        const requiredPlan = getRequiredPlanForFeature(feature);
        return res.status(403).json({
          error: "PlanUpgradeRequired",
          message: `This feature requires the ${planLabel(requiredPlan)} plan.`,
          feature,
          requiredPlan,
          currentPlan: plan ?? "none",
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

function planLabel(plan: Plan): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

// ---------------------------------------------------------------------------
// Plan limit enforcement
// ---------------------------------------------------------------------------

export type LimitType = "customers" | "users" | "appointments" | "estimates" | "invoices";

interface LimitMeta {
  limitKey: keyof PlanLimits;
  noun: string;
  monthly: boolean;
}

const LIMIT_META: Record<LimitType, LimitMeta> = {
  customers: { limitKey: "maxCustomers", noun: "active customers", monthly: false },
  users: { limitKey: "maxUsers", noun: "users", monthly: false },
  appointments: { limitKey: "maxAppointmentsPerMonth", noun: "appointments per month", monthly: true },
  estimates: { limitKey: "maxEstimatesPerMonth", noun: "estimates per month", monthly: true },
  invoices: { limitKey: "maxInvoicesPerMonth", noun: "invoices per month", monthly: true },
};

function currentMonthRange(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, end };
}

async function countUsage(companyId: number, limitType: LimitType): Promise<number> {
  switch (limitType) {
    case "customers": {
      const [row] = await db
        .select({ count: sql<number>`count(*)` })
        .from(customersTable)
        .where(eq(customersTable.companyId, companyId));
      return Number(row?.count ?? 0);
    }
    case "users": {
      const [row] = await db
        .select({ count: sql<number>`count(*)` })
        .from(usersTable)
        .where(and(eq(usersTable.companyId, companyId), eq(usersTable.isActive, true)));
      return Number(row?.count ?? 0);
    }
    case "appointments": {
      const { start, end } = currentMonthRange();
      const [row] = await db
        .select({ count: sql<number>`count(*)` })
        .from(appointmentsTable)
        .where(and(
          eq(appointmentsTable.companyId, companyId),
          gte(appointmentsTable.createdAt, start),
          lt(appointmentsTable.createdAt, end),
        ));
      return Number(row?.count ?? 0);
    }
    case "estimates": {
      const { start, end } = currentMonthRange();
      const [row] = await db
        .select({ count: sql<number>`count(*)` })
        .from(estimatesTable)
        .where(and(
          eq(estimatesTable.companyId, companyId),
          gte(estimatesTable.createdAt, start),
          lt(estimatesTable.createdAt, end),
        ));
      return Number(row?.count ?? 0);
    }
    case "invoices": {
      const { start, end } = currentMonthRange();
      const [row] = await db
        .select({ count: sql<number>`count(*)` })
        .from(invoicesTable)
        .where(and(
          eq(invoicesTable.companyId, companyId),
          gte(invoicesTable.createdAt, start),
          lt(invoicesTable.createdAt, end),
        ));
      return Number(row?.count ?? 0);
    }
    default:
      return 0;
  }
}

export interface PlanLimitCheck {
  allowed: boolean;
  plan: Plan;
  limit: number | null;
  currentUsage: number;
}

/** Checks whether a company is within the given limit. Pass `extra` to test "would adding N more stay within the limit?" */
export async function checkPlanLimit(companyId: number, limitType: LimitType, extra = 1): Promise<PlanLimitCheck> {
  const plan = normalizePlan(await getCompanyPlan(companyId));
  const limits = getPlanLimits(plan);
  const limit = limits[LIMIT_META[limitType].limitKey];

  if (limit === null) {
    return { allowed: true, plan, limit: null, currentUsage: 0 };
  }

  const currentUsage = await countUsage(companyId, limitType);
  return { allowed: currentUsage + extra <= limit, plan, limit, currentUsage };
}

function limitExceededMessage(limitType: LimitType, plan: Plan, limit: number): string {
  const { noun } = LIMIT_META[limitType];
  return `Your ${planLabel(plan)} plan supports up to ${limit} ${noun}.`;
}

/**
 * Express middleware — verifies the company is within its plan limit for the
 * given resource type before allowing a create operation to proceed.
 * companyId always comes from the authenticated user context (req.user),
 * never from the request body, so staff cannot bypass limits by spoofing it.
 */
export function requireWithinPlanLimit(limitType: LimitType) {
  return async (req: any, res: any, next: any) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const check = await checkPlanLimit(user.companyId, limitType);
      if (!check.allowed) {
        return res.status(403).json({
          error: "PlanLimitExceeded",
          message: limitExceededMessage(limitType, check.plan, check.limit as number),
          limitType,
          limit: check.limit,
          currentUsage: check.currentUsage,
          requiredPlan: nextPlan(check.plan),
          currentPlan: check.plan,
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

// ---------------------------------------------------------------------------
// Usage summary (for billing pages / admin console)
// ---------------------------------------------------------------------------

export interface PlanUsageSummary {
  plan: Plan;
  limits: PlanLimits;
  usage: {
    customers: number;
    users: number;
    appointments: number;
    estimates: number;
    invoices: number;
  };
}

export async function getPlanUsageSummary(companyId: number): Promise<PlanUsageSummary> {
  const plan = normalizePlan(await getCompanyPlan(companyId));
  const [customers, users, appointments, estimates, invoices] = await Promise.all([
    countUsage(companyId, "customers"),
    countUsage(companyId, "users"),
    countUsage(companyId, "appointments"),
    countUsage(companyId, "estimates"),
    countUsage(companyId, "invoices"),
  ]);

  return {
    plan,
    limits: getPlanLimits(plan),
    usage: { customers, users, appointments, estimates, invoices },
  };
}