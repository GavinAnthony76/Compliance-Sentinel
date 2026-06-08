import { useAdminGetDashboard } from '@workspace/api-client-react';
import { useAuthState } from '@/hooks/use-auth-state';
import { Link, useLocation } from 'wouter';
import { Building2, Users, CreditCard, TrendingUp, LogOut, Shield, Activity, DollarSign, Settings, UserCheck, AlertTriangle, BarChart2, Rocket } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

function AdminLayout({ children }: { children: React.ReactNode }) {
  const { adminUser, adminLogout } = useAuthState();
  const [location] = useLocation();

  const nav = [
    { href: '/admin/dashboard', label: 'Overview', icon: BarChart2 },
    { href: '/admin/companies', label: 'Companies', icon: Building2 },
    { href: '/admin/billing', label: 'Revenue & Billing', icon: DollarSign },
    { href: '/admin/activity', label: 'Activity Logs', icon: Activity },
    { href: '/admin/beta-readiness', label: 'Beta Readiness', icon: Rocket },
    { href: '/admin/admins', label: 'Admin Users', icon: Users },
    { href: '/admin/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-slate-950 flex">
      <div className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col flex-shrink-0">
        <div className="p-6 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary" />
            <div>
              <div className="font-bold text-white">Goshen</div>
              <div className="text-xs text-slate-400">Admin Panel</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {nav.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${location === item.href || location.startsWith(item.href + '/') ? 'bg-primary text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
            >
              <item.icon className="w-4 h-4 flex-shrink-0" />{item.label}
            </Link>
          ))}
        </nav>
        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold flex-shrink-0">
              {adminUser?.firstName?.[0]}{adminUser?.lastName?.[0]}
            </div>
            <div className="min-w-0">
              <p className="text-white text-sm font-medium truncate">{adminUser?.firstName} {adminUser?.lastName}</p>
              <p className="text-slate-500 text-xs capitalize">{adminUser?.role}</p>
            </div>
          </div>
          <button onClick={adminLogout} className="flex items-center gap-2 text-sm text-slate-400 hover:text-red-400 transition-colors w-full">
            <LogOut className="w-4 h-4" />Sign Out
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="p-8 max-w-6xl mx-auto">{children}</div>
      </div>
    </div>
  );
}

export { AdminLayout };

const ACTION_COLORS: Record<string, string> = {
  'admin.': 'bg-purple-400/10 text-purple-400',
  'customer.': 'bg-blue-400/10 text-blue-400',
  'appointment.': 'bg-green-400/10 text-green-400',
  'invoice.': 'bg-yellow-400/10 text-yellow-400',
};
function actionBadgeClass(action: string) {
  for (const [prefix, cls] of Object.entries(ACTION_COLORS)) {
    if (action.startsWith(prefix)) return cls;
  }
  return 'bg-slate-700 text-slate-300';
}

const PLAN_COLORS: Record<string, string> = {
  starter: 'bg-blue-400/10 text-blue-400',
  growth: 'bg-green-400/10 text-green-400',
  pro: 'bg-purple-400/10 text-purple-400',
};

export function AdminDashboardPage() {
  const { data, isLoading } = useAdminGetDashboard();

  const totalMrr = (data as any)?.mrr ?? 0;
  const planBreakdown: Record<string, number> = (data as any)?.planBreakdown ?? {};
  const maxPlan = Math.max(...Object.values(planBreakdown), 1);

  return (
    <AdminLayout>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Platform Overview</h1>
        <p className="text-slate-400 mt-1">Real-time metrics across all companies</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
      ) : (
        <div className="space-y-6">
          {/* Primary KPI row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Monthly Recurring Revenue', value: `$${(totalMrr / 100).toLocaleString()}`, icon: DollarSign, color: 'text-green-400', bg: 'bg-green-400/10' },
              { label: 'Active Subscriptions', value: (data as any)?.activeSubscriptions ?? 0, icon: CreditCard, color: 'text-blue-400', bg: 'bg-blue-400/10' },
              { label: 'Total Companies', value: (data as any)?.totalCompanies ?? 0, icon: Building2, color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
              { label: 'Platform Users', value: (data as any)?.totalUsers ?? 0, icon: Users, color: 'text-purple-400', bg: 'bg-purple-400/10' },
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

          {/* Secondary metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {[
              { label: 'Total Customers', value: (data as any)?.totalCustomers ?? 0, color: 'text-blue-300' },
              { label: 'Appointments', value: (data as any)?.totalAppointments ?? 0, color: 'text-green-300' },
              { label: 'Invoices', value: (data as any)?.totalInvoices ?? 0, color: 'text-yellow-300' },
              { label: 'Trialing', value: (data as any)?.trialingAccounts ?? 0, color: 'text-orange-300' },
              { label: 'Past Due', value: (data as any)?.pastDueAccounts ?? 0, color: 'text-red-400' },
            ].map((s, i) => (
              <div key={i} className="bg-slate-900 rounded-xl p-4 border border-slate-800 text-center">
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-slate-400 text-xs mt-1">{s.label}</p>
              </div>
            ))}
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* Plan distribution */}
            <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
              <h2 className="font-bold text-white mb-4">Plan Distribution</h2>
              <div className="space-y-3">
                {(['pro', 'growth', 'starter'] as const).map(plan => {
                  const count = planBreakdown[plan] ?? 0;
                  const pct = (data as any)?.totalCompanies > 0 ? Math.round((count / (data as any).totalCompanies) * 100) : 0;
                  return (
                    <div key={plan}>
                      <div className="flex items-center justify-between mb-1">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${PLAN_COLORS[plan]}`}>{plan}</span>
                        <span className="text-white text-sm font-semibold">{count} <span className="text-slate-500 font-normal">companies</span></span>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-800">
                        <div className={`h-1.5 rounded-full transition-all ${plan === 'starter' ? 'bg-blue-400' : plan === 'growth' ? 'bg-green-400' : 'bg-purple-400'}`}
                          style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 pt-4 border-t border-slate-800 text-center">
                <Link href="/admin/billing" className="text-sm text-primary hover:underline">View full revenue report →</Link>
              </div>
            </div>

            {/* Recent signups */}
            <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-white">Recent Signups</h2>
                <Link href="/admin/companies" className="text-sm text-primary hover:underline">View all</Link>
              </div>
              <div className="space-y-2">
                {(data as any)?.recentSignups?.map((c: any) => (
                  <Link key={c.id} href={`/admin/companies/${c.id}`} className="flex items-center justify-between py-2 border-b border-slate-800 last:border-0 hover:bg-slate-800/40 -mx-2 px-2 rounded transition-colors">
                    <div>
                      <p className="font-medium text-white text-sm">{c.name}</p>
                      <p className="text-xs text-slate-500">{format(new Date(c.createdAt), 'MMM d, yyyy')}</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${PLAN_COLORS[c.subscriptionPlan] ?? 'bg-slate-700 text-slate-400'}`}>
                      {c.subscriptionPlan || 'Trial'}
                    </span>
                  </Link>
                ))}
                {(!(data as any)?.recentSignups || (data as any).recentSignups.length === 0) && (
                  <p className="text-slate-400 text-sm py-4 text-center">No recent signups</p>
                )}
              </div>
            </div>

            {/* Recent activity */}
            <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-white">Recent Activity</h2>
                <Link href="/admin/activity" className="text-sm text-primary hover:underline">View all</Link>
              </div>
              <div className="space-y-2">
                {(data as any)?.recentActivity?.map((log: any) => (
                  <div key={log.id} className="py-2 border-b border-slate-800 last:border-0">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-mono ${actionBadgeClass(log.action)}`}>{log.action}</span>
                    {log.companyName && <span className="text-slate-400 text-xs ml-1">· {log.companyName}</span>}
                    <p className="text-slate-500 text-xs mt-0.5">
                      {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                ))}
                {(!(data as any)?.recentActivity || (data as any).recentActivity.length === 0) && (
                  <p className="text-slate-400 text-sm py-4 text-center">No activity yet</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
