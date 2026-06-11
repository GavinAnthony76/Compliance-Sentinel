import { useGetBillingStatus, useGetBillingPlans, useGetBillingUsage, useCreateSubscription, useCreateBillingPortal, ApiError } from '@workspace/api-client-react';
import { AppLayout } from '@/components/layout';
import { Card, CardContent, Button } from '@/components/ui';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Check, CreditCard, ArrowRight, Shield, AlertCircle, AlertTriangle } from 'lucide-react';
import { getPlanViolations, type PlanViolation } from '@/lib/plan-usage';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { Link } from 'wouter';
import { useState } from 'react';

const PLAN_DESCRIPTIONS: Record<string, string> = {
  starter: 'For solo operators getting organized',
  growth: 'For growing crews',
  pro: 'For established outdoor service businesses',
};

const PLAN_LABELS: Record<string, string> = {
  starter: 'Starter',
  growth: 'Growth',
  pro: 'Pro',
};

const NEXT_PLAN: Record<string, string> = {
  starter: 'Growth',
  growth: 'Pro',
  pro: 'Pro',
};

const USAGE_METER_CONFIG: Array<{ key: 'customers' | 'users' | 'appointments' | 'estimates' | 'invoices'; limitKey: 'maxCustomers' | 'maxUsers' | 'maxAppointmentsPerMonth' | 'maxEstimatesPerMonth' | 'maxInvoicesPerMonth'; label: string; noun: string }> = [
  { key: 'customers', limitKey: 'maxCustomers', label: 'Active Customers', noun: 'customers' },
  { key: 'users', limitKey: 'maxUsers', label: 'Users', noun: 'users' },
  { key: 'appointments', limitKey: 'maxAppointmentsPerMonth', label: 'Appointments this month', noun: 'appointments' },
  { key: 'estimates', limitKey: 'maxEstimatesPerMonth', label: 'Estimates this month', noun: 'estimates' },
  { key: 'invoices', limitKey: 'maxInvoicesPerMonth', label: 'Invoices this month', noun: 'invoices' },
];

function UsageMeters({ usage }: { usage: any }) {
  if (!usage) return null;
  const planLabel = PLAN_LABELS[usage.plan] || usage.plan;
  const nextPlanLabel = NEXT_PLAN[usage.plan] || 'Pro';

  return (
    <Card className="border-border/50 mb-8">
      <CardContent className="p-6">
        <h3 className="text-lg font-bold mb-1">Plan Usage</h3>
        <p className="text-sm text-muted-foreground mb-5">How your account is tracking against your {planLabel} plan limits.</p>
        <div className="space-y-5">
          {USAGE_METER_CONFIG.map(({ key, limitKey, label, noun }) => {
            const current = usage.usage?.[key] ?? 0;
            const limit = usage.limits?.[limitKey];
            const unlimited = limit === null || limit === undefined;
            const pct = unlimited ? 0 : Math.min(100, Math.round((current / Math.max(limit, 1)) * 100));
            const atLimit = !unlimited && current >= limit;
            const nearLimit = !unlimited && !atLimit && pct >= 80;
            const barColor = atLimit ? 'bg-red-500' : nearLimit ? 'bg-amber-500' : 'bg-primary';

            return (
              <div key={key}>
                <div className="flex items-center justify-between text-sm mb-1.5">
                  <span className="font-medium text-foreground">{label}</span>
                  <span className="text-muted-foreground">
                    {unlimited ? `${current} / Unlimited` : `${current} / ${limit}`}
                  </span>
                </div>
                {!unlimited && (
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                )}
                {atLimit && (
                  <p className="text-sm text-red-600 font-medium mt-1.5 flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    You have reached your {planLabel} {noun} limit. Upgrade to {nextPlanLabel} to add more {noun}.
                  </p>
                )}
                {nearLimit && (
                  <p className="text-sm text-amber-600 font-medium mt-1.5 flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    You are using {current} of {limit} {noun} on {planLabel}. Upgrade to {nextPlanLabel} before you hit your limit.
                  </p>
                )}
              </div>
            );
          })}
        </div>
        {usage.plan !== 'pro' && (
          <div className="mt-6 pt-5 border-t border-border flex items-center justify-between gap-4 flex-wrap">
            <p className="text-sm text-muted-foreground">Need more room to grow? Upgrade for higher limits and more features.</p>
            <Link href="#plans">
              <Button variant="outline" size="sm" className="gap-2">
                View plans <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function BillingPage() {
  const { data: status, isLoading: statusLoading } = useGetBillingStatus();
  const { data: usage } = useGetBillingUsage();
  const { data: plansData, isLoading: plansLoading } = useGetBillingPlans();
  const subscribeMut = useCreateSubscription();
  const portalMut = useCreateBillingPortal();
  const { toast } = useToast();

  const [downgradeWarning, setDowngradeWarning] = useState<{
    planId: string;
    violations: Array<{ limitType: string; noun: string; currentUsage: number; limit: number }>;
  } | null>(null);

  const startCheckout = async (planId: string, confirmDowngrade = false) => {
    const res = await subscribeMut.mutateAsync({ data: { planId: planId as any, confirmDowngrade } });
    window.location.href = res.url;
  };

  const handleSubscribe = async (planId: string) => {
    try {
      await startCheckout(planId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && (err.data as any)?.error === 'DowngradeExceedsUsage') {
        const data = err.data as any;
        setDowngradeWarning({ planId, violations: data.violations ?? [] });
        return;
      }
      toast({ title: 'Error starting checkout', variant: 'destructive' });
    }
  };

  const handleConfirmDowngrade = async () => {
    if (!downgradeWarning) return;
    const planId = downgradeWarning.planId;
    setDowngradeWarning(null);
    try {
      await startCheckout(planId, true);
    } catch {
      toast({ title: 'Error starting checkout', variant: 'destructive' });
    }
  };

  const handlePortal = async () => {
    try {
      const res = await portalMut.mutateAsync();
      window.location.href = res.url;
    } catch {
      toast({ title: 'Error opening billing portal', description: 'No active subscription found', variant: 'destructive' });
    }
  };

  const planStatusColor: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    trialing: 'bg-blue-100 text-blue-700',
    past_due: 'bg-red-100 text-red-700',
    canceled: 'bg-gray-100 text-gray-600',
  };

  return (
    <AppLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-display font-bold">Billing & Subscription</h1>
        <p className="text-muted-foreground mt-1">Manage your plan and payment details</p>
      </div>

      {statusLoading ? (
        <div className="flex justify-center py-10"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
      ) : status && (status.plan || status.status) ? (
        <Card className="border-border/50 mb-8">
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-2">Current Plan</p>
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-bold capitalize">{status.plan || 'No Plan'}</h2>
                  {status.status && (
                    <span className={`px-3 py-1 rounded-full text-sm font-medium capitalize ${planStatusColor[status.status] || 'bg-gray-100 text-gray-600'}`}>
                      {status.status.replace('_', ' ')}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-1 mt-2">
                  {status.trialEndsAt && (
                    <p className="text-sm text-muted-foreground flex items-center gap-1">
                      <AlertCircle className="w-4 h-4 text-amber-500" />
                      Trial ends {format(new Date(status.trialEndsAt), 'MMMM d, yyyy')}
                    </p>
                  )}
                  {status.currentPeriodEnd && status.status !== 'trialing' && (
                    <p className="text-sm text-muted-foreground">
                      Next billing: {format(new Date(status.currentPeriodEnd), 'MMMM d, yyyy')}
                    </p>
                  )}
                  {status.cancelAtPeriodEnd && (
                    <p className="text-sm text-orange-600 font-medium">⚠ Subscription will cancel at period end</p>
                  )}
                </div>
              </div>
              <div className="flex gap-3">
                {status.hasBillingAccount ? (
                  <Button variant="outline" onClick={handlePortal} isLoading={portalMut.isPending}>
                    <CreditCard className="w-4 h-4 mr-2" />Manage Billing
                  </Button>
                ) : (
                  <Button onClick={() => handleSubscribe(status.plan as string)} isLoading={subscribeMut.isPending}>
                    <CreditCard className="w-4 h-4 mr-2" />Add payment method
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-amber-200 bg-amber-50 mb-8">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-6 h-6 text-amber-600 shrink-0" />
              <div>
                <h3 className="font-semibold text-amber-900">No active subscription</h3>
                <p className="text-sm text-amber-700 mt-1">Choose a plan below to unlock all features. Start with a 14-day free trial.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <UsageMeters usage={usage} />

      {plansLoading ? (
        <div className="flex justify-center py-10"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
      ) : (
        <>
          <h2 id="plans" className="text-2xl font-display font-bold mb-4 scroll-mt-24">Available Plans</h2>
          <div className="grid sm:grid-cols-3 gap-6">
            {plansData?.plans.map((plan: any) => {
              const isCurrent = status?.plan === plan.id;
              const isPopular = plan.id === 'growth';
              const planViolations = isCurrent ? [] : getPlanViolations(usage, plan.limits);
              return (
                <div key={plan.id} className={`relative rounded-2xl border-2 p-6 flex flex-col ${isCurrent ? 'border-primary bg-primary/5' : isPopular ? 'border-primary/50' : 'border-border bg-card'}`}>
                  {isPopular && !isCurrent && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-primary text-primary-foreground text-xs font-bold rounded-full">Most Popular</div>
                  )}
                  {isCurrent && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-green-600 text-white text-xs font-bold rounded-full">Current Plan</div>
                  )}
                  <div className="mb-4">
                    <h3 className="font-bold text-lg capitalize">{plan.name}</h3>
                    <div className="text-3xl font-bold text-primary mt-1">${plan.price}<span className="text-base font-normal text-muted-foreground">/mo</span></div>
                    <p className="text-sm text-muted-foreground mt-1">{PLAN_DESCRIPTIONS[plan.id] || ''}</p>
                  </div>
                  <ul className="space-y-2.5 flex-1 mb-6">
                    {plan.features?.map((feature: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  {planViolations.length > 0 && (
                    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <p className="text-sm font-medium text-amber-800 flex items-center gap-1.5 mb-1.5">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        Your usage exceeds this plan
                      </p>
                      <ul className="space-y-1">
                        {planViolations.map((v) => (
                          <li key={v.limitType} className="text-xs text-amber-700 flex items-start gap-1.5">
                            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            <span>Your {v.currentUsage} {v.noun} exceed this plan's {v.limit} limit</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {isCurrent ? (
                    status?.hasBillingAccount ? (
                      <Button variant="outline" onClick={handlePortal} className="w-full">
                        Manage <ArrowRight className="w-4 h-4 ml-2" />
                      </Button>
                    ) : (
                      <Button onClick={() => handleSubscribe(plan.id)} isLoading={subscribeMut.isPending} className="w-full">
                        Add payment method <ArrowRight className="w-4 h-4 ml-2" />
                      </Button>
                    )
                  ) : (
                    <Button
                      onClick={() => handleSubscribe(plan.id)}
                      isLoading={subscribeMut.isPending}
                      className="w-full"
                      variant={isPopular ? 'default' : 'outline'}
                    >
                      {status?.plan ? 'Switch to this plan' : 'Start free trial'}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-center text-sm text-muted-foreground mt-6 flex items-center justify-center gap-2">
            <Shield className="w-4 h-4" />
            Secure payments via Stripe. Cancel anytime.
          </p>
        </>
      )}

      <AlertDialog open={!!downgradeWarning} onOpenChange={(open) => { if (!open) setDowngradeWarning(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
              This plan is smaller than your current usage
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p className="mb-3">
                  Switching to the <span className="font-semibold capitalize">{downgradeWarning && (PLAN_LABELS[downgradeWarning.planId] || downgradeWarning.planId)}</span> plan
                  would put your account over its limits for:
                </p>
                <ul className="space-y-1.5 mb-3">
                  {downgradeWarning?.violations.map((v) => (
                    <li key={v.limitType} className="flex items-start gap-2 text-sm text-foreground">
                      <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                      <span>
                        <span className="font-medium capitalize">{v.noun}</span>: you have {v.currentUsage}, but this plan allows {v.limit}.
                      </span>
                    </li>
                  ))}
                </ul>
                <p>You can still switch, but you may not be able to add new records until you're back under the limits.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current plan</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDowngrade}>Switch anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
