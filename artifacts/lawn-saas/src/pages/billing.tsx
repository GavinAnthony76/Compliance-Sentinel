import { useGetBillingStatus, useGetBillingPlans, useCreateSubscription, useCreateBillingPortal } from '@workspace/api-client-react';
import { AppLayout } from '@/components/layout';
import { Card, CardContent, Button } from '@/components/ui';
import { Check, CreditCard, ArrowRight, Shield, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

const PLAN_DESCRIPTIONS: Record<string, string> = {
  starter: 'Perfect for solo operators',
  growth: 'For growing teams',
  pro: 'For established businesses',
};

export function BillingPage() {
  const { data: status, isLoading: statusLoading } = useGetBillingStatus();
  const { data: plansData, isLoading: plansLoading } = useGetBillingPlans();
  const subscribeMut = useCreateSubscription();
  const portalMut = useCreateBillingPortal();
  const { toast } = useToast();

  const handleSubscribe = async (planId: string) => {
    try {
      const res = await subscribeMut.mutateAsync({ data: { planId: planId as any } });
      window.location.href = res.url;
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
                <Button variant="outline" onClick={handlePortal} isLoading={portalMut.isPending}>
                  <CreditCard className="w-4 h-4 mr-2" />Manage Billing
                </Button>
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

      {plansLoading ? (
        <div className="flex justify-center py-10"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
      ) : (
        <>
          <h2 className="text-2xl font-display font-bold mb-4">Available Plans</h2>
          <div className="grid sm:grid-cols-3 gap-6">
            {plansData?.plans.map((plan: any) => {
              const isCurrent = status?.plan === plan.id;
              const isPopular = plan.id === 'growth';
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
                  {isCurrent ? (
                    <Button variant="outline" onClick={handlePortal} className="w-full">
                      Manage <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
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
    </AppLayout>
  );
}
