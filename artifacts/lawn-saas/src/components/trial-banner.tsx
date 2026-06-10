import { Link } from 'wouter';
import { AlertTriangle, Clock, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTrialStatus } from '@/hooks/use-trial-status';
import { useAuthState } from '@/hooks/use-auth-state';

export function TrialBanner() {
  const { isTrialing, trialExpired, trialDaysLeft } = useTrialStatus();
  const { user } = useAuthState();
  const plan = user?.company?.subscriptionPlan;
  const planLabel = plan ? `${plan.charAt(0).toUpperCase()}${plan.slice(1)}` : 'your';

  if (!isTrialing) return null;

  if (trialExpired) {
    return (
      <div className="bg-red-600 text-white px-4 py-3 flex items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-2 min-w-0">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="font-semibold text-sm">Your free trial has ended.</span>
          <span className="text-sm text-red-100 hidden sm:inline truncate">
            Add a payment method to keep your {planLabel} plan.
          </span>
        </div>
        <Link href="/billing">
          <button className="bg-white text-red-600 text-xs font-bold px-4 py-1.5 rounded-lg hover:bg-red-50 transition-colors shrink-0 whitespace-nowrap">
            Activate Plan →
          </button>
        </Link>
      </div>
    );
  }

  const isUrgent = trialDaysLeft <= 3;
  const isWarning = trialDaysLeft <= 7;

  return (
    <div
      className={cn(
        'px-4 py-2.5 flex items-center justify-between gap-4 border-b',
        isUrgent
          ? 'bg-red-50 border-red-200'
          : isWarning
          ? 'bg-amber-50 border-amber-200'
          : 'bg-blue-50 border-blue-200',
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        {isUrgent ? (
          <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />
        ) : isWarning ? (
          <Clock className="w-4 h-4 shrink-0 text-amber-500" />
        ) : (
          <Zap className="w-4 h-4 shrink-0 text-blue-500" />
        )}
        <span
          className={cn(
            'text-sm font-medium',
            isUrgent ? 'text-red-700' : isWarning ? 'text-amber-700' : 'text-blue-700',
          )}
        >
          {isUrgent
            ? `Trial ends in ${trialDaysLeft} day${trialDaysLeft !== 1 ? 's' : ''}! Add a payment method to keep your ${planLabel} plan.`
            : isWarning
            ? `${trialDaysLeft} days left in your ${planLabel} trial — add billing before it expires.`
            : `${trialDaysLeft} days left in your free ${planLabel} trial.`}
        </span>
      </div>
      <Link href="/billing">
        <button
          className={cn(
            'text-xs font-bold px-3 py-1.5 rounded-lg transition-colors shrink-0 whitespace-nowrap',
            isUrgent
              ? 'bg-red-600 text-white hover:bg-red-700'
              : isWarning
              ? 'bg-amber-500 text-white hover:bg-amber-600'
              : 'bg-blue-600 text-white hover:bg-blue-700',
          )}
        >
          Activate Plan
        </button>
      </Link>
    </div>
  );
}
