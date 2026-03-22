import { useState } from 'react';
import { useAdminListCompanies, useAdminGetCompany, useAdminSuspendCompany, useAdminActivateCompany, useAdminUpdateCompanyPlan } from '@workspace/api-client-react';
import { AdminLayout } from './admin-dashboard';
import { Button } from '@/components/ui';
import { Search, Building2, ChevronRight } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { getAdminListCompaniesQueryKey } from '@workspace/api-client-react';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { useParams, useLocation } from 'wouter';

const PLAN_COLORS: Record<string, string> = {
  starter: 'bg-blue-400/10 text-blue-400',
  growth: 'bg-green-400/10 text-green-400',
  pro: 'bg-purple-400/10 text-purple-400',
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-400/10 text-green-400',
  trialing: 'bg-yellow-400/10 text-yellow-400',
  past_due: 'bg-red-400/10 text-red-400',
  canceled: 'bg-slate-600 text-slate-400',
};

export function AdminCompaniesPage() {
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const { data, isLoading } = useAdminListCompanies({ search: search || undefined, plan: planFilter || undefined, page: 1, limit: 50 } as any);
  const [, setLocation] = useLocation();

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Companies</h1>
      </div>

      <div className="flex gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input className="w-full h-11 pl-10 pr-4 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-primary" placeholder="Search companies..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {['', 'starter', 'growth', 'pro'].map(p => (
          <button key={p} onClick={() => setPlanFilter(p)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${planFilter === p ? 'bg-primary text-white' : 'bg-slate-800 border border-slate-700 text-slate-400 hover:text-white'}`}>
            {p ? p.charAt(0).toUpperCase() + p.slice(1) : 'All'}
          </button>
        ))}
      </div>

      <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
        ) : data?.companies.length === 0 ? (
          <div className="py-20 text-center text-slate-400">No companies found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left p-4 text-sm font-medium text-slate-400">Company</th>
                  <th className="text-left p-4 text-sm font-medium text-slate-400">Owner</th>
                  <th className="text-left p-4 text-sm font-medium text-slate-400">Plan</th>
                  <th className="text-left p-4 text-sm font-medium text-slate-400">Status</th>
                  <th className="text-left p-4 text-sm font-medium text-slate-400">Joined</th>
                  <th className="text-right p-4 text-sm font-medium text-slate-400">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {data?.companies.map((company: any) => (
                  <tr key={company.id} className="hover:bg-slate-800/50 transition-colors cursor-pointer" onClick={() => setLocation(`/admin/companies/${company.id}`)}>
                    <td className="p-4">
                      <div className="font-medium text-white">{company.name}</div>
                      <div className="text-xs text-slate-500">{company.email || company.slug}</div>
                    </td>
                    <td className="p-4 text-sm text-slate-300">{company.ownerName || '—'}</td>
                    <td className="p-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${PLAN_COLORS[company.subscriptionPlan] || 'bg-slate-700 text-slate-400'}`}>
                        {company.subscriptionPlan || 'None'}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[company.subscriptionStatus] || 'bg-slate-700 text-slate-400'}`}>
                        {company.subscriptionStatus || 'No sub'}
                      </span>
                    </td>
                    <td className="p-4 text-sm text-slate-400">{format(new Date(company.createdAt), 'MMM d, yyyy')}</td>
                    <td className="p-4 text-right">
                      <ChevronRight className="w-4 h-4 text-slate-400 ml-auto" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

export function AdminCompanyDetailPage() {
  const params = useParams<{ id: string }>();
  const { data, isLoading } = useAdminGetCompany({ id: Number(params.id) });
  const { toast } = useToast();
  const qc = useQueryClient();
  const suspendMut = useAdminSuspendCompany();
  const activateMut = useAdminActivateCompany();
  const planMut = useAdminUpdateCompanyPlan();
  const [, setLocation] = useLocation();

  if (isLoading) return <AdminLayout><div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div></AdminLayout>;
  if (!data?.company) return <AdminLayout><div className="text-slate-400 py-20 text-center">Company not found</div></AdminLayout>;

  const { company, users, recentActivity } = data;

  return (
    <AdminLayout>
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => setLocation('/admin/companies')} className="text-slate-400 hover:text-white text-sm">← Back</button>
        <h1 className="text-2xl font-bold text-white">{company.name}</h1>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${company.isActive ? 'bg-green-400/10 text-green-400' : 'bg-red-400/10 text-red-400'}`}>
          {company.isActive ? 'Active' : 'Suspended'}
        </span>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
            <h2 className="font-bold text-white mb-4">Company Info</h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              {[['Email', company.email], ['Phone', company.phone], ['Plan', company.subscriptionPlan], ['Status', company.subscriptionStatus], ['Customers', company.customersCount], ['Appointments', company.appointmentsCount]].map(([k, v]) => (
                <div key={k as string}>
                  <span className="text-slate-400">{k}: </span>
                  <span className="text-white capitalize">{v ?? '—'}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
            <h2 className="font-bold text-white mb-4">Users ({users?.length ?? 0})</h2>
            <div className="space-y-3">
              {users?.map((u: any) => (
                <div key={u.id} className="flex items-center justify-between py-2 border-b border-slate-800 last:border-0">
                  <div>
                    <span className="text-white text-sm">{u.firstName} {u.lastName}</span>
                    <span className="text-slate-400 text-xs ml-2">{u.email}</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${u.role === 'owner' ? 'bg-purple-400/10 text-purple-400' : 'bg-slate-700 text-slate-400'}`}>{u.role}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
            <h2 className="font-bold text-white mb-3 text-sm">Actions</h2>
            <div className="space-y-2">
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Change Plan</label>
                <select className="w-full h-9 px-3 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm" value={company.subscriptionPlan || ''} onChange={async (e) => {
                  if (!e.target.value) return;
                  await planMut.mutateAsync({ id: company.id, data: { plan: e.target.value as any } });
                  toast({ title: 'Plan updated' });
                }}>
                  <option value="">Select plan...</option>
                  <option value="starter">Starter</option>
                  <option value="growth">Growth</option>
                  <option value="pro">Pro</option>
                </select>
              </div>
              {company.isActive ? (
                <Button size="sm" variant="destructive" className="w-full" onClick={async () => {
                  await suspendMut.mutateAsync({ id: company.id });
                  toast({ title: 'Company suspended' });
                }}>Suspend Company</Button>
              ) : (
                <Button size="sm" className="w-full" onClick={async () => {
                  await activateMut.mutateAsync({ id: company.id });
                  toast({ title: 'Company activated' });
                }}>Activate Company</Button>
              )}
            </div>
          </div>

          <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
            <h2 className="font-bold text-white mb-3 text-sm">Recent Activity</h2>
            <div className="space-y-2">
              {recentActivity?.slice(0, 5).map((log: any) => (
                <div key={log.id} className="text-xs">
                  <span className="text-slate-300">{log.action}</span>
                  <span className="text-slate-500 block">{format(new Date(log.createdAt), 'MMM d, h:mm a')}</span>
                </div>
              ))}
              {(!recentActivity || recentActivity.length === 0) && <p className="text-slate-500 text-xs">No recent activity</p>}
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
