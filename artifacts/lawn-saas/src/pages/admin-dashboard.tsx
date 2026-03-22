import { useAdminGetDashboard } from '@workspace/api-client-react';
import { useAuthState } from '@/hooks/use-auth-state';
import { Card, CardContent, Button } from '@/components/ui';
import { Link, useLocation } from 'wouter';
import { Building2, Users, CreditCard, TrendingUp, LogOut, Shield, Activity } from 'lucide-react';
import { format } from 'date-fns';

function AdminLayout({ children }: { children: React.ReactNode }) {
  const { adminUser, adminLogout } = useAuthState();
  const [location] = useLocation();

  const nav = [
    { href: '/admin/dashboard', label: 'Dashboard', icon: TrendingUp },
    { href: '/admin/companies', label: 'Companies', icon: Building2 },
    { href: '/admin/activity', label: 'Activity Logs', icon: Activity },
    { href: '/admin/admins', label: 'Admin Users', icon: Users },
  ];

  return (
    <div className="min-h-screen bg-slate-950 flex">
      <div className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col">
        <div className="p-6 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary" />
            <div>
              <div className="font-bold text-white">GreenSync</div>
              <div className="text-xs text-slate-400">Admin Panel</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {nav.map(item => (
            <Link key={item.href} href={item.href} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${location === item.href || location.startsWith(item.href + '/') ? 'bg-primary text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>
              <item.icon className="w-4 h-4" />{item.label}
            </Link>
          ))}
        </nav>
        <div className="p-4 border-t border-slate-800">
          <div className="text-xs text-slate-500 mb-3">{adminUser?.firstName} {adminUser?.lastName}</div>
          <button onClick={adminLogout} className="flex items-center gap-2 text-sm text-slate-400 hover:text-red-400 transition-colors">
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

export function AdminDashboardPage() {
  const { data, isLoading } = useAdminGetDashboard();

  return (
    <AdminLayout>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Platform Overview</h1>
        <p className="text-slate-400 mt-1">Real-time metrics across all companies</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {[
              { label: 'Total Companies', value: data?.totalCompanies, icon: Building2, color: 'text-blue-400', bg: 'bg-blue-400/10' },
              { label: 'Active Subscriptions', value: data?.activeSubscriptions, icon: CreditCard, color: 'text-green-400', bg: 'bg-green-400/10' },
              { label: 'Total Users', value: data?.totalUsers, icon: Users, color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
              { label: 'MRR', value: `$${((data?.mrr ?? 0) / 100).toFixed(0)}`, icon: TrendingUp, color: 'text-purple-400', bg: 'bg-purple-400/10' },
            ].map((stat, i) => (
              <div key={i} className="bg-slate-900 rounded-xl p-5 border border-slate-800">
                <div className={`w-10 h-10 rounded-lg ${stat.bg} flex items-center justify-center mb-3`}>
                  <stat.icon className={`w-5 h-5 ${stat.color}`} />
                </div>
                <p className="text-slate-400 text-sm">{stat.label}</p>
                <p className="text-white text-2xl font-bold mt-1">{stat.value ?? '—'}</p>
              </div>
            ))}
          </div>

          {data?.planBreakdown && (
            <div className="grid grid-cols-3 gap-4 mb-6">
              {(['starter', 'growth', 'pro'] as const).map(plan => (
                <div key={plan} className="bg-slate-900 rounded-xl p-4 border border-slate-800 flex items-center gap-3">
                  <div className={`px-2 py-1 rounded-lg text-xs font-bold capitalize ${plan === 'starter' ? 'bg-blue-400/10 text-blue-400' : plan === 'growth' ? 'bg-green-400/10 text-green-400' : 'bg-purple-400/10 text-purple-400'}`}>{plan}</div>
                  <div>
                    <p className="text-white font-bold text-lg">{data.planBreakdown[plan] ?? 0}</p>
                    <p className="text-slate-400 text-xs">active companies</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-white">Recent Signups</h2>
              <Link href="/admin/companies" className="text-sm text-primary hover:underline">View all</Link>
            </div>
            <div className="space-y-3">
              {data?.recentSignups?.map((c: any) => (
                <div key={c.id} className="flex items-center justify-between py-3 border-b border-slate-800 last:border-0">
                  <div>
                    <p className="font-medium text-white">{c.name}</p>
                    <p className="text-xs text-slate-400">{c.email} · {format(new Date(c.createdAt), 'MMM d, yyyy')}</p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${c.subscriptionPlan ? 'bg-green-400/10 text-green-400' : 'bg-slate-700 text-slate-400'}`}>
                    {c.subscriptionPlan || 'Trial'}
                  </span>
                </div>
              ))}
              {(!data?.recentSignups || data.recentSignups.length === 0) && (
                <p className="text-slate-400 text-sm py-4 text-center">No recent signups</p>
              )}
            </div>
          </div>
        </>
      )}
    </AdminLayout>
  );
}
