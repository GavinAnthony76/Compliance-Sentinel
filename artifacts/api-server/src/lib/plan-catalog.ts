import { db, plansTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { logger } from "./logger";

export interface PlanLimitSet {
  maxUsers: number | null;
  maxCustomers: number | null;
  maxAppointmentsPerMonth: number | null;
  maxEstimatesPerMonth: number | null;
  maxInvoicesPerMonth: number | null;
}

export interface CatalogPlan {
  id: string;
  name: string;
  price: number;
  interval: string;
  tagline: string;
  features: string[];
  isPopular: boolean;
  sortOrder: number;
  limits: PlanLimitSet;
}

/**
 * Built-in defaults. Used to seed the `plans` table on first boot and as a
 * fallback if the database is unreachable, so plan display and limit
 * enforcement always have correct values.
 */
const DEFAULT_PLANS: CatalogPlan[] = [
  {
    id: "starter",
    name: "Starter",
    price: 49,
    interval: "month",
    tagline: "For solo operators getting organized",
    features: [
      "1 user",
      "50 active customers",
      "100 appointments/month",
      "10 estimates/month",
      "25 invoices/month",
      "Customer CRM",
      "Scheduling calendar",
      "Invoicing & payments",
      "Public booking page",
      "Email reminders",
      "Customer portal",
    ],
    isPopular: false,
    sortOrder: 0,
    limits: {
      maxUsers: 1,
      maxCustomers: 50,
      maxAppointmentsPerMonth: 100,
      maxEstimatesPerMonth: 10,
      maxInvoicesPerMonth: 25,
    },
  },
  {
    id: "growth",
    name: "Growth",
    price: 99,
    interval: "month",
    tagline: "For growing crews",
    features: [
      "Up to 5 users",
      "250 active customers",
      "500 appointments/month",
      "100 estimates/month",
      "250 invoices/month",
      "Route optimization",
      "Recurring plans",
      "SMS notifications",
      "Review requests",
      "GPS tracking",
      "Before/after photos",
      "Follow-up campaigns",
    ],
    isPopular: true,
    sortOrder: 1,
    limits: {
      maxUsers: 5,
      maxCustomers: 250,
      maxAppointmentsPerMonth: 500,
      maxEstimatesPerMonth: 100,
      maxInvoicesPerMonth: 250,
    },
  },
  {
    id: "pro",
    name: "Pro",
    price: 199,
    interval: "month",
    tagline: "For established lawn care businesses",
    features: [
      "Unlimited users",
      "Unlimited customers",
      "Unlimited appointments",
      "Unlimited estimates",
      "Unlimited invoices",
      "AI Estimate Builder",
      "Lead Pipeline",
      "Advanced Analytics",
      "Data Export",
      "API Access",
      "Advanced Automations",
      "Autopay",
      "Priority Support",
    ],
    isPopular: false,
    sortOrder: 2,
    limits: {
      maxUsers: null,
      maxCustomers: null,
      maxAppointmentsPerMonth: null,
      maxEstimatesPerMonth: null,
      maxInvoicesPerMonth: null,
    },
  },
];

const TTL_MS = 60_000;

let cache: CatalogPlan[] = DEFAULT_PLANS;
let lastLoaded = 0;
let refreshing: Promise<void> | null = null;

function rowToCatalogPlan(row: typeof plansTable.$inferSelect): CatalogPlan {
  return {
    id: row.id,
    name: row.name,
    price: row.price,
    interval: row.interval,
    tagline: row.tagline,
    features: Array.isArray(row.features) ? row.features : [],
    isPopular: row.isPopular,
    sortOrder: row.sortOrder,
    limits: {
      maxUsers: row.maxUsers,
      maxCustomers: row.maxCustomers,
      maxAppointmentsPerMonth: row.maxAppointmentsPerMonth,
      maxEstimatesPerMonth: row.maxEstimatesPerMonth,
      maxInvoicesPerMonth: row.maxInvoicesPerMonth,
    },
  };
}

/** Inserts the default plans only when the table is empty; never clobbers edits. */
async function ensureSeeded(): Promise<void> {
  const existing = await db.select({ id: plansTable.id }).from(plansTable).limit(1);
  if (existing.length > 0) return;
  await db.insert(plansTable).values(
    DEFAULT_PLANS.map((p) => ({
      id: p.id,
      name: p.name,
      price: p.price,
      interval: p.interval,
      tagline: p.tagline,
      features: p.features,
      maxUsers: p.limits.maxUsers,
      maxCustomers: p.limits.maxCustomers,
      maxAppointmentsPerMonth: p.limits.maxAppointmentsPerMonth,
      maxEstimatesPerMonth: p.limits.maxEstimatesPerMonth,
      maxInvoicesPerMonth: p.limits.maxInvoicesPerMonth,
      isPopular: p.isPopular,
      sortOrder: p.sortOrder,
    })),
  );
  logger.info("Seeded default subscription plans");
}

async function refreshCatalog(): Promise<void> {
  const rows = await db
    .select()
    .from(plansTable)
    .where(eq(plansTable.active, true))
    .orderBy(asc(plansTable.sortOrder));
  if (rows.length > 0) {
    cache = rows.map(rowToCatalogPlan);
    lastLoaded = Date.now();
  }
}

/** Seed + initial load. Falls back to defaults (already in cache) on failure. */
export async function initPlanCatalog(): Promise<void> {
  try {
    await ensureSeeded();
    await refreshCatalog();
  } catch (err) {
    logger.error({ err }, "Failed to initialize plan catalog; using defaults");
  }
}

function maybeRefresh(): void {
  if (refreshing) return;
  if (Date.now() - lastLoaded < TTL_MS) return;
  refreshing = refreshCatalog()
    .catch((err) => logger.error({ err }, "Plan catalog refresh failed"))
    .finally(() => {
      refreshing = null;
    });
}

/** Active plans ordered for display. */
export function getCatalog(): CatalogPlan[] {
  maybeRefresh();
  return cache;
}

export function getCatalogPlan(id: string): CatalogPlan | undefined {
  maybeRefresh();
  return cache.find((p) => p.id === id);
}

/** Numeric limits for a plan id, or undefined if not in the catalog. */
export function getCatalogLimits(id: string): PlanLimitSet | undefined {
  maybeRefresh();
  return cache.find((p) => p.id === id)?.limits;
}
