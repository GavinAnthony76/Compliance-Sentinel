import React from 'react';
import { Link } from 'wouter';
import { Lock, Sparkles, ArrowRight, Zap } from 'lucide-react';
import { useAuthState } from '@/hooks/use-auth-state';
import { Button } from './ui';

export type FeatureKey =
  | 'recurring_plans'
  | 'routes'
  | 'estimates'
  | 'multi_staff'
  | 'review_requests'
  | 'automations'
  | 'advanced_analytics'
  | 'reporting'
  | 'csv_export'
  | 'lead_pipeline';

const REQUIRED_PLAN: Record<FeatureKey, 'growth' | 'pro'> = {
  recurring_plans: 'growth',
  routes: 'growth',
  estimates: 'growth',
  multi_staff: 'growth',
  review_requests: 'growth',
  reporting: 'growth',
  automations: 'growth',
  advanced_analytics: 'pro',
  csv_export: 'pro',
  lead_pipeline: 'pro',
};

const PLAN_FEATURES: Record<string, Set<string>> = {
  starter: new Set(['customers','services','appointments','invoices','calendar','dashboard','settings','booking_page','email_reminders']),
  growth: new Set(['customers','services','appointments','invoices','calendar','dashboard','settings','booking_page','email_reminders','multi_staff','recurring_plans','sms_reminders','estimates','routes','customer_notes_tags','review_requests','reporting','branded_booking','automations','autopay','customer_portal']),
  pro: new Set(['customers','services','appointments','invoices','calendar','dashboard','settings','booking_page','email_reminders','multi_staff','recurring_plans','sms_reminders','estimates','routes','customer_notes_tags','review_requests','reporting','branded_booking','automations','autopay','customer_portal','advanced_analytics','csv_export','lead_pipeline','ai_hooks','custom_intake_fields']),
};

const PLAN_LABELS: Record<string, string> = {
  starter: 'Starter',
  growth: 'Growth',
  pro: 'Pro',
};

const PLAN_PRICES: Record<string, string> = {
  growth: '$99/mo',
  pro: '$199/mo',
};

const PLAN_COLORS: Record<string, { bg: string; border: string; icon: string; badge: string; badgeText: string }> = {
  growth: {
    bg: 'from-emerald-50 to-green-100',
    border: 'border-emerald-200',
    icon: 'text-emerald-600 bg-emerald-100',
    badge: 'bg-emerald-600',
    badgeText: 'text-white',
  },
  pro: {
    bg: 'from-violet-50 to-purple-100',
    border: 'border-violet-200',
    icon: 'text-violet-600 bg-violet-100',
    badge: 'bg-violet-600',
    badgeText: 'text-white',
  },
};

const FEATURE_DESCRIPTIONS: Record<FeatureKey, { title: string; description: string; bullets: string[] }> = {
  recurring_plans: {
    title: 'Recurring Plans',
    description: 'Auto-schedule weekly or bi-weekly jobs and generate work orders automatically — no manual rescheduling.',
    bullets: ['Weekly & bi-weekly schedules', 'Auto-generated appointments', 'Per-customer service templates'],
  },
  routes: {
    title: 'Smart Route Planning',
    description: 'Optimize your daily routes to cut drive time and fuel costs. Assign stops to crew members.',
    bullets: ['Route optimization', 'Multi-stop route management', 'Crew assignment per route'],
  },
  estimates: {
    title: 'Estimates',
    description: 'Create and send professional estimates to prospects and customers before converting to invoices.',
    bullets: ['Branded estimate PDFs', 'One-click convert to invoice', 'Acceptance tracking'],
  },
  multi_staff: {
    title: 'Team Management',
    description: 'Add crew members, assign roles, and manage your entire team from a single dashboard.',
    bullets: ['Unlimited team members', 'Role-based permissions', 'Job assignment per crew'],
  },
  reporting: {
    title: 'Advanced Reporting',
    description: 'Detailed revenue breakdowns, job completion trends, and customer metrics.',
    bullets: ['Revenue by month & service', 'Completion rate trends', 'Customer lifetime value'],
  },
  review_requests: {
    title: 'Review Requests',
    description: 'Automatically ask happy customers for reviews via email or SMS after completing jobs.',
    bullets: ['Email & SMS delivery', 'Review link tracking', 'Sent history log'],
  },
  automations: {
    title: 'Automations',
    description: 'Set trigger-based rules that run automatically — auto-create invoices, send reminders, and more.',
    bullets: ['Auto-create invoices on job completion', 'Follow-up SMS/email sequences', 'Review request triggers'],
  },
  advanced_analytics: {
    title: 'Advanced Analytics',
    description: 'Deep-dive dashboards with revenue forecasting, churn signals, and growth metrics.',
    bullets: ['Revenue forecasting', 'Churn risk indicators', 'Service profitability breakdown'],
  },
  csv_export: {
    title: 'CSV Export',
    description: 'Export any data — customers, invoices, appointments — to CSV for reporting or migration.',
    bullets: ['Export customers, invoices, jobs', 'Custom date range filters', 'Instant download'],
  },
  lead_pipeline: {
    title: 'Lead Pipeline',
    description: 'Capture, track, and convert prospects through a visual sales pipeline — never let a lead slip through the cracks.',
    bullets: ['Kanban pipeline with drag-and-drop stages', 'Auto-capture leads from your booking page', 'One-click convert to customer & estimate'],
  },
};

function hasFeature(plan: string | null | undefined, feature: string): boolean {
  if (!plan) return false;
  return PLAN_FEATURES[plan]?.has(feature) ?? false;
}

interface PlanGateProps {
  feature: FeatureKey;
  children: React.ReactNode;
}

export function PlanGate({ feature, children }: PlanGateProps) {
  const { user } = useAuthState();
  const plan = user?.company?.subscriptionPlan;

  if (hasFeature(plan, feature)) {
    return <>{children}</>;
  }

  const requiredPlan = REQUIRED_PLAN[feature];
  const info = FEATURE_DESCRIPTIONS[feature];
  const colors = PLAN_COLORS[requiredPlan];

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className={`w-full max-w-lg bg-gradient-to-br ${colors.bg} border ${colors.border} rounded-3xl p-8 shadow-lg`}>
        <div className="flex items-center gap-3 mb-6">
          <div className={`w-12 h-12 rounded-2xl ${colors.icon} flex items-center justify-center`}>
            <Lock className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-gray-900">{info.title}</h2>
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${colors.badge} ${colors.badgeText}`}>
                {PLAN_LABELS[requiredPlan]} Plan
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-0.5">
              Available on {PLAN_LABELS[requiredPlan]} ({PLAN_PRICES[requiredPlan]}) and above
            </p>
          </div>
        </div>

        <p className="text-gray-700 text-sm leading-relaxed mb-5">{info.description}</p>

        <ul className="space-y-2 mb-7">
          {info.bullets.map((b) => (
            <li key={b} className="flex items-center gap-2.5 text-sm text-gray-700">
              <div className={`w-5 h-5 rounded-full ${colors.icon} flex items-center justify-center shrink-0`}>
                <Sparkles className="w-3 h-3" />
              </div>
              {b}
            </li>
          ))}
        </ul>

        <div className="flex flex-col sm:flex-row gap-3">
          <Link href="/billing" className="flex-1">
            <Button className="w-full gap-2 font-semibold">
              Upgrade to {PLAN_LABELS[requiredPlan]}
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
          <Link href="/billing" className="flex-1">
            <Button variant="outline" className="w-full gap-2">
              <Zap className="w-4 h-4" />
              View all plans
            </Button>
          </Link>
        </div>

        {plan && (
          <p className="text-center text-xs text-gray-400 mt-4">
            You're currently on the <span className="font-semibold capitalize">{plan}</span> plan.
          </p>
        )}
      </div>
    </div>
  );
}
