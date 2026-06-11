import { useState } from 'react';
import { Link } from 'wouter';
import { AlertTriangle, X } from 'lucide-react';
import { useTrialStatus } from '@/hooks/use-trial-status';

export function PastDueBanner() {
  const { subscriptionStatus } = useTrialStatus();
  const [dismissed, setDismissed] = useState(false);

  if (subscriptionStatus !== 'past_due') return null;
  if (dismissed) return null;

  return (
    <div className="bg-red-600 text-white px-4 py-3 flex items-center justify-between gap-4 shadow-sm">
      <div className="flex items-center gap-2 min-w-0">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span className="font-semibold text-sm">Your last payment failed.</span>
        <span className="text-sm text-red-100 hidden sm:inline truncate">
          Update your billing details to keep your account active.
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Link href="/billing">
          <button className="bg-white text-red-600 text-xs font-bold px-4 py-1.5 rounded-lg hover:bg-red-50 transition-colors whitespace-nowrap">
            Fix billing →
          </button>
        </Link>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="text-white/80 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
