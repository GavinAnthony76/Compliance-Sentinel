import { useState, useEffect } from 'react';
import { AdminLayout } from './admin-dashboard';
import { DollarSign, TrendingUp, Users, AlertTriangle, CheckCircle, XCircle, Clock, Building2 } from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

function adminFetch(path: string, opts: RequestInit = {}) {
  const token = localStorage.getItem('greensync_admin_token');
  return fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers ?? {}) } });
}

const PLAN_COLORS: Record<string, { bar: string; badge: string }> = {
  starter: { bar: 'bg-blue-400', badge: 'bg-blue-400/10 text-blue-400' },
  growth: { bar: 'bg-green-400', badge: 'bg-green-400/10 text-green-400' },
  pro: { bar: 'bg-purple-400', badge: 'bg-purple-400/10 text-purple-400' },
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-400/10 text-green-400',
  trialing: 'bg-yellow-400/10 text-yellow-400',
  past_due: 'bg-red-400/10 text-red-400',
  canceled: 'bg-slate-700 text-slate-400',
};

function MiniBarChart({ data }: { data: { month: string; count: number }[] }) {
  if (!data || data.length === 0) return <p className="text-slate-500 text-xs text-center py-4">No data yet</p>;
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <div className="flex items-end gap-2 h-20 mt-2">
      {data.map(d => (
        <div key={d.month} className="flex-1 flex flex-col items-center gap-1">
          <div className="w-full bg-primary/20 rounded-sm relative" style={{ height: `${Math.max((d.count / max) * 64, 4)}px` }}>
            <div className="absolute inset-0 bg-primary/60 rounded-sm" />
          </div>
          <span className="text-slate-500 text-xs">{d.month.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

export function AdminBillingPage() {
  const { toast } = useToast();
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [updatingPlan, setUpdatingPlan] = useState<number | null>(null);

  const loadData = () => {
    setIsLoading(true);
    adminFetch('/api/admin/revenue').then(r => r.json()).then(d => { setData(d); setIsLoading(false); });
  };

  useEffect(() => { loadData(); }, []);

  const handleChangePlan = async (companyId: number, plan: string) => {
    setUpdatingPlan(companyId);
    try {
      const res = await adminFetch(`/api/admin/companies/${companyId}/plan`, { method: 'PUT', body: JSON.stringify({ plan }) });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message); }
      toast({ title: 'Plan updated' });
      const fresh = await adminFetch('/api/admin/revenue').then(r => r.json());
      setData(fresh);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setUpdatingPlan(null);
    }
  };

  const totalMrrCents = data?.mrr ?? 0;
  const planBreakdown: Record<string, { count: number; mrr: number; label: string }> = data?.planBreakdown ?? {};
  const statusBreakdown: Record<string, number> = data?.statusBreakdown ?? {};
  const totalActive = Object.values(statusBreakdown).reduce((a, b) => a + b, 0);

  return (
    <AdminLayout>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Revenue & Billing</h1>
        <p className="text-slate-400 mt-1">Platform-wide subscription and revenue metrics</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
      ) : (
        <div className="space-y-6">
          {/* Top metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Monthly Recurring Revenue', value: `$${(totalMrrCents / 100).toLocaleString()}`, icon: DollarSign, color: 'text-green-400', bg: 'bg-green-400/10' },
              { label: 'Total Revenue Collected', value: `$${Number(data?.totalRevenue ?? 0).toLocaleString()}`, icon: TrendingUp, color: 'text-purple-400', bg: 'bg-purple-400/10' },
              { label: 'Total Customers', value: data?.totalCustomers ?? 0, icon: Users, color: 'text-blue-400', bg: 'bg-blue-400/10' },
              { label: 'Invoices Paid', value: data?.paidInvoicesCount ?? 0, icon: CheckCircle, color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
            ].map((stat, i) => (
              <div key={i} className="bg-slate-900 rounded-xl p-5 border border-slate-800">
                <div className={`w-10 h-10 rounded-lg ${stat.bg} flex items-center justify-center mb-3`}>
                  <stat.icon className={`w-5 h-5 ${stat.color}`} />
                </div>
                <p className="text-slate-400 text-sm">{stat.label}</p>
                <p className="text-white text-2xl font-bold mt-1">{stat.value}</p>
              </div>
            ))}
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            {/* Plan breakdown */}
            <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
              <h2 className="font-bold text-white mb-5">Revenue by Plan</h2>
              <div className="space-y-4">
                {(['pro', 'growth', 'starter'] as const).map(plan => {
                  const d = planBreakdown[plan];
                  if (!d) return null;
                  const pct = totalMrrCents > 0 ? Math.round((d.mrr / totalMrrCents) * 100) : 0;
                  return (
                    <div key={plan}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${PLAN_COLORS[plan]?.badge}`}>{plan}</span>
                          <span className="text-slate-400 text-sm">{d.count} companies</span>
                        </div>
                        <span className="text-white font-medium">${(d.mrr / 100).toLocaleString()}/mo</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-800">
                        <div className={`h-2 rounded-full transition-all ${PLAN_COLORS[plan]?.bar}`} style={{ width: `${pct}%` }} />
                      </div>
                      <div className="text-right text-xs text-slate-500 mt-0.5">{pct}% of MRR</div>
                    </div>
                  );
                })}
                {Object.keys(planBreakdown).length === 0 && <p className="text-slate-500 text-sm text-center py-4">No active subscriptions</p>}
              </div>
            </div>

            {/* Status distribution */}
            <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
              <h2 className="font-bold text-white mb-5">Subscription Status</h2>
              <div className="space-y-3">
                {([
                  { key: 'active', label: 'Active', icon: CheckCircle, color: 'text-green-400' },
                  { key: 'trialing', label: 'Trialing', icon: Clock, color: 'text-yellow-400' },
                  { key: 'past_due', label: 'Past Due', icon: AlertTriangle, color: 'text-red-400' },
                  { key: 'canceled', label: 'Canceled', icon: XCircle, color: 'text-slate-400' },
                ] as const).map(({ key, label, icon: Icon, color }) => {
                  const count = statusBreakdown[key] ?? 0;
                  const pct = totalActive > 0 ? Math.round((count / totalActive) * 100) : 0;
                  return (
                    <div key={key} className="flex items-center gap-3">
                      <Icon className={`w-4 h-4 ${color} flex-shrink-0`} />
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-sm font-medium ${STATUS_COLORS[key]?.split(' ')[1] ?? 'text-white'}`}>{label}</span>
                          <span className="text-white font-bold">{count}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-slate-800">
                          <div className={`h-1.5 rounded-full transition-all ${key === 'active' ? 'bg-green-400' : key === 'trialing' ? 'bg-yellow-400' : key === 'past_due' ? 'bg-red-400' : 'bg-slate-600'}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                      <span className="text-slate-500 text-xs w-8 text-right">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Monthly signups chart */}
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
            <h2 className="font-bold text-white mb-2">New Companies — Last 6 Months</h2>
            <MiniBarChart data={data?.monthlySignups ?? []} />
          </div>

          {/* Past-due companies */}
          {data?.pastDueCompanies?.length > 0 && (
            <div className="bg-slate-900 rounded-xl border border-red-900/40 p-6">
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle className="w-5 h-5 text-red-400" />
                <h2 className="font-bold text-white">Past-Due Accounts ({data.pastDueCompanies.length})</h2>
              </div>
              <div className="space-y-1">
                {data.pastDueCompanies.map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between py-3 px-3 rounded-lg hover:bg-slate-800/60 transition-colors">
                    <div className="flex items-center gap-3">
                      <Building2 className="w-4 h-4 text-slate-400" />
                      <div>
                        <p className="text-white text-sm font-medium">{c.name}</p>
                        <p className="text-slate-500 text-xs">{c.email} · Joined {format(new Date(c.createdAt), 'MMM d, yyyy')}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${PLAN_COLORS[c.subscriptionPlan]?.badge ?? 'bg-slate-700 text-slate-400'}`}>{c.subscriptionPlan}</span>
                      <select
                        disabled={updatingPlan === c.id}
                        className="h-8 px-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs disabled:opacity-50 cursor-pointer"
                        defaultValue=""
                        onChange={e => { if (e.target.value) handleChangePlan(c.id, e.target.value); }}
                      >
                        <option value="">Change plan...</option>
                        <option value="starter">Starter ($49)</option>
                        <option value="growth">Growth ($99)</option>
                        <option value="pro">Pro ($199)</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </AdminLayout>
  );
}
