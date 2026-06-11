export type PlanViolation = { limitType: string; noun: string; currentUsage: number; limit: number };

export const LIMIT_NOUNS: Record<string, string> = {
  maxCustomers: 'customers',
  maxUsers: 'users',
  maxAppointmentsPerMonth: 'appointments',
  maxEstimatesPerMonth: 'estimates',
  maxInvoicesPerMonth: 'invoices',
};

export const USAGE_KEY_FOR_LIMIT: Record<string, 'customers' | 'users' | 'appointments' | 'estimates' | 'invoices'> = {
  maxCustomers: 'customers',
  maxUsers: 'users',
  maxAppointmentsPerMonth: 'appointments',
  maxEstimatesPerMonth: 'estimates',
  maxInvoicesPerMonth: 'invoices',
};

// Mirrors the server's getDowngradeViolations: compare the company's current
// usage against a target plan's limits and return every resource that's over.
// An empty array means the plan comfortably fits the account.
export function getPlanViolations(usage: any, planLimits: any): PlanViolation[] {
  if (!usage?.usage || !planLimits) return [];
  const violations: PlanViolation[] = [];
  for (const limitKey of Object.keys(LIMIT_NOUNS)) {
    const limit = planLimits[limitKey];
    if (limit === null || limit === undefined) continue; // unlimited on this plan
    const currentUsage = usage.usage[USAGE_KEY_FOR_LIMIT[limitKey]] ?? 0;
    if (currentUsage > limit) {
      violations.push({ limitType: limitKey, noun: LIMIT_NOUNS[limitKey], currentUsage, limit });
    }
  }
  return violations;
}
