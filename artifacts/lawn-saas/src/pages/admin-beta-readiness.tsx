import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminLayout } from './admin-dashboard';
import { format } from 'date-fns';
import {
  Rocket, Building2, Users, Send, AlertTriangle, CheckCircle2, XCircle,
  Database, CreditCard, Mail, MessageSquare, Sparkles, Activity, Clock, Loader2,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

function adminFetch(path: string, opts: RequestInit = {}) {
  const token = localStorage.getItem('greensync_admin_token');
  return fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers ?? {}) } });
}

interface IntegrationStatus { configured: boolean; label: string }
interface BetaTenant { id: number; name: string; slug: string; subscriptionPlan: string | null; subscriptionStatus: string | null; isActive: boolean }
interface ActivityLog { id: number; action: string; entityType: string | null; createdAt: string; companyName: string | null }

interface BetaReadiness {
  counts: { totalCompanies: number; betaTenants: number; pendingFollowUps: number; failedCommunications: number };
  dataIntegrity: { companiesMissingBilling: number; companiesMissingSlug: number; usersWithoutRole: number; appointmentsWithoutCustomer: number };
  integrations: Record<string, IntegrationStatus>;
  betaTenants: BetaTenant[];
  lastAutomationRun: ActivityLog | null;
  recentActivity: ActivityLog[];
  recentErrors: ActivityLog[];
}

const INTEGRATION_ICONS: Record<string, typeof Database> = {
  stripe: CreditCard,
  sendgrid: Mail,
  twilio: MessageSquare,
  openai: Sparkles,
  database: Database,
};

function StatCard({ icon: Icon, label, value, tone = 'default' }: { icon: typeof Building2; label: string; value: number; tone?: 'default' | 'warn' }) {
  const warn = tone === 'warn' && value > 0;
  return (
    <div className={`rounded-xl border p-4 ${warn ? 'border-amber-500/40 bg-amber-500/5' : 'border-slate-800 bg-slate-900'}`}>
      <div className="flex items-center gap-2 text-slate-400 text-xs font-medium mb-1">
        <Icon className={`w-4 h-4 ${warn ? 'text-amber-400' : ''}`} />{label}
      </div>
      <p className={`text-2xl font-bold ${warn ? 'text-amber-400' : 'text-white'}`}>{value}</p>
    </div>
  );
}

export function AdminBetaReadinessPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery<BetaReadiness>({
    queryKey: ['/api/admin/beta-readiness'],
    queryFn: async () => {
      const res = await adminFetch('/api/admin/beta-readiness');
      if (!res.ok) throw new Error('Failed to load beta readiness');
      return res.json();
    },
  });

  const toggleBeta = async (companyId: number, betaEnabled: boolean) => {
    try {
      const res = await adminFetch(`/api/admin/companies/${companyId}/beta`, {
        method: 'PUT',
        body: JSON.stringify({ betaEnabled }),
      });
      if (!res.ok) throw new Error('Failed to update');
      qc.invalidateQueries({ queryKey: ['/api/admin/beta-readiness'] });
      toast({ title: betaEnabled ? 'Marked as beta tenant' : 'Removed from beta' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  return (
    <AdminLayout>
      <div className="mb-8 flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-primary/15 flex items-center justify-center">
          <Rocket className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Beta Readiness</h1>
          <p className="text-sm text-slate-400">Platform health, integration status, and data integrity checks.</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : error || !data ? (
        <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-6 text-red-400">Failed to load beta readiness data.</div>
      ) : (
        <div className="space-y-8">
          {/* Top stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={Building2} label="Total Companies" value={data.counts.totalCompanies} />
            <StatCard icon={Rocket} label="Active Beta Tenants" value={data.counts.betaTenants} />
            <StatCard icon={Send} label="Pending Follow-Ups" value={data.counts.pendingFollowUps} />
            <StatCard icon={AlertTriangle} label="Failed Communications" value={data.counts.failedCommunications} tone="warn" />
          </div>

          {/* Integrations */}
          <section>
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-3">System & Integration Status</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {Object.entries(data.integrations).map(([key, val]) => {
                const Icon = INTEGRATION_ICONS[key] ?? Database;
                return (
                  <div key={key} className="rounded-xl border border-slate-800 bg-slate-900 p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Icon className="w-5 h-5 text-slate-400" />
                      <span className="text-sm font-medium text-white">{val.label}</span>
                    </div>
                    {val.configured ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400"><CheckCircle2 className="w-4 h-4" />Connected</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500"><XCircle className="w-4 h-4" />Not configured</span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Data integrity */}
          <section>
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-3">Data Integrity</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard icon={CreditCard} label="Companies Missing Billing" value={data.dataIntegrity.companiesMissingBilling} tone="warn" />
              <StatCard icon={Building2} label="Companies Missing Slug" value={data.dataIntegrity.companiesMissingSlug} tone="warn" />
              <StatCard icon={Users} label="Users Without Role" value={data.dataIntegrity.usersWithoutRole} tone="warn" />
              <StatCard icon={AlertTriangle} label="Appts Without Customer" value={data.dataIntegrity.appointmentsWithoutCustomer} tone="warn" />
            </div>
          </section>

          {/* Last automation run */}
          <section>
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-3">Automation Scheduler</h2>
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 flex items-center gap-3">
              <Clock className="w-5 h-5 text-slate-400" />
              {data.lastAutomationRun ? (
                <div className="text-sm">
                  <span className="text-white font-medium">{data.lastAutomationRun.action}</span>
                  <span className="text-slate-400"> — {format(new Date(data.lastAutomationRun.createdAt), 'MMM d, yyyy · h:mm a')}</span>
                  {data.lastAutomationRun.companyName && <span className="text-slate-500"> ({data.lastAutomationRun.companyName})</span>}
                </div>
              ) : (
                <span className="text-sm text-slate-500">No automation runs logged yet.</span>
              )}
            </div>
          </section>

          {/* Beta tenants management */}
          <section>
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-3">Beta Tenants</h2>
            <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
              {data.betaTenants.length === 0 ? (
                <p className="p-6 text-sm text-slate-500">No companies marked as beta tenants yet. Enable beta in a company's detail page.</p>
              ) : (
                <div className="divide-y divide-slate-800">
                  {data.betaTenants.map(c => (
                    <div key={c.id} className="p-4 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-white">{c.name}</p>
                        <p className="text-xs text-slate-500">
                          /{c.slug} · {c.subscriptionPlan ?? 'no plan'} · {c.subscriptionStatus ?? 'no status'}
                          {!c.isActive && <span className="text-amber-400"> · suspended</span>}
                        </p>
                      </div>
                      <button
                        onClick={() => toggleBeta(c.id, false)}
                        className="text-xs font-medium text-slate-400 hover:text-red-400 transition-colors"
                      >
                        Remove from beta
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Recent errors */}
          {data.recentErrors.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />Recent Errors
              </h2>
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 divide-y divide-amber-500/10">
                {data.recentErrors.map(l => (
                  <div key={l.id} className="p-3 flex items-center justify-between text-sm">
                    <span className="text-amber-300 font-medium">{l.action}</span>
                    <span className="text-slate-500 text-xs">{format(new Date(l.createdAt), 'MMM d · h:mm a')}{l.companyName ? ` · ${l.companyName}` : ''}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Recent activity */}
          <section>
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-3 flex items-center gap-2">
              <Activity className="w-4 h-4" />Recent Activity
            </h2>
            <div className="rounded-xl border border-slate-800 bg-slate-900 divide-y divide-slate-800">
              {data.recentActivity.length === 0 ? (
                <p className="p-6 text-sm text-slate-500">No recent activity.</p>
              ) : (
                data.recentActivity.map(l => (
                  <div key={l.id} className="p-3 flex items-center justify-between text-sm">
                    <span className="text-slate-300 font-medium">{l.action}</span>
                    <span className="text-slate-500 text-xs">{format(new Date(l.createdAt), 'MMM d · h:mm a')}{l.companyName ? ` · ${l.companyName}` : ''}</span>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      )}
    </AdminLayout>
  );
}
