import { useAuthState } from './use-auth-state';

export interface TrialStatus {
  isTrialing: boolean;
  isActive: boolean;
  isCanceled: boolean;
  trialExpired: boolean;
  trialDaysLeft: number;
  trialEndsAt: Date | null;
  canWrite: boolean;
  subscriptionStatus: string | null;
}

export function useTrialStatus(): TrialStatus {
  const { user } = useAuthState();
  const company = (user as any)?.company;

  const subscriptionStatus: string | null = company?.subscriptionStatus ?? null;
  const rawTrialEndsAt = company?.trialEndsAt;
  const trialEndsAt = rawTrialEndsAt ? new Date(rawTrialEndsAt) : null;
  const now = new Date();

  const isTrialing = subscriptionStatus === 'trialing';
  const isActive = subscriptionStatus === 'active';
  const isCanceled = subscriptionStatus === 'canceled';
  const trialExpired = isTrialing && trialEndsAt ? trialEndsAt < now : false;
  const trialDaysLeft =
    isTrialing && !trialExpired && trialEndsAt
      ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
      : 0;
  const canWrite = isActive || (isTrialing && !trialExpired);

  return {
    isTrialing,
    isActive,
    isCanceled,
    trialExpired,
    trialDaysLeft,
    trialEndsAt,
    canWrite,
    subscriptionStatus,
  };
}
