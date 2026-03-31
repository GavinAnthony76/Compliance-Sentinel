import { useAdminListActivity } from '@workspace/api-client-react';
import { AdminLayout } from './admin-dashboard';
import { format } from 'date-fns';
import { useState } from 'react';
import { Search, Activity, Filter } from 'lucide-react';

const ACTION_COLORS: Record<string, string> = {
  'admin.': 'bg-purple-400/10 text-purple-400',
  'customer.': 'bg-blue-400/10 text-blue-400',
  'appointment.': 'bg-green-400/10 text-green-400',
  'invoice.': 'bg-yellow-400/10 text-yellow-400',
  'estimate.': 'bg-orange-400/10 text-orange-400',
  'user.': 'bg-pink-400/10 text-pink-400',
};
function actionClass(action: string) {
  for (const [prefix, cls] of Object.entries(ACTION_COLORS)) {
    if (action.startsWith(prefix)) return cls;
  }
  return 'bg-slate-700/60 text-slate-300';
}

const ENTITY_TYPES = ['', 'company', 'user', 'customer', 'appointment', 'invoice', 'estimate'];

export function AdminActivityPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [entityType, setEntityType] = useState('');
  const { data, isLoading } = useAdminListActivity({ page, limit: 50, search: search || undefined, entityType: entityType || undefined } as any);

  const handleSearch = (val: string) => { setSearch(val); setPage(1); };
  const handleEntityType = (val: string) => { setEntityType(val); setPage(1); };

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Activity Logs</h1>
          <p className="text-slate-400 text-sm mt-1">All platform-wide events and admin actions</p>
        </div>
        {data && <span className="text-slate-400 text-sm">{data.total} total events</span>}
      </div>

      <div className="flex gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            className="w-full h-11 pl-10 pr-4 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-primary"
            placeholder="Search by action name..."
            value={search}
            onChange={e => handleSearch(e.target.value)}
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <select
            className="h-11 pl-10 pr-8 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:border-primary appearance-none cursor-pointer"
            value={entityType}
            onChange={e => handleEntityType(e.target.value)}
          >
            {ENTITY_TYPES.map(t => (
              <option key={t} value={t}>{t ? `Entity: ${t}` : 'All entities'}</option>
            ))}
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
      ) : (
        <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
          {data?.logs.length === 0 ? (
            <div className="py-20 text-center">
              <Activity className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">No activity logs found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="text-left p-4 text-sm font-medium text-slate-400">Action</th>
                    <th className="text-left p-4 text-sm font-medium text-slate-400">Company</th>
                    <th className="text-left p-4 text-sm font-medium text-slate-400">User</th>
                    <th className="text-left p-4 text-sm font-medium text-slate-400">Entity</th>
                    <th className="text-left p-4 text-sm font-medium text-slate-400">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {data?.logs.map((log: any) => (
                    <tr key={log.id} className="hover:bg-slate-800/50 transition-colors">
                      <td className="p-4">
                        <span className={`px-2 py-0.5 rounded-md text-xs font-mono ${actionClass(log.action)}`}>{log.action}</span>
                      </td>
                      <td className="p-4 text-sm text-slate-300">{log.companyName || '—'}</td>
                      <td className="p-4 text-sm text-slate-300">{log.userName || (log.adminId ? 'Admin' : '—')}</td>
                      <td className="p-4 text-xs text-slate-400">
                        {log.entityType && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">{log.entityType} #{log.entityId}</span>
                        )}
                      </td>
                      <td className="p-4 text-xs text-slate-500 whitespace-nowrap">{format(new Date(log.createdAt), 'MMM d, h:mm a')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data && data.total > 50 && (
            <div className="p-4 border-t border-slate-800 flex items-center justify-between">
              <span className="text-sm text-slate-400">Page {page} of {Math.ceil(data.total / 50)} · {data.total} events</span>
              <div className="flex gap-2">
                {page > 1 && <button onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-sm hover:bg-slate-700">← Prev</button>}
                {page < Math.ceil(data.total / 50) && <button onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-sm hover:bg-slate-700">Next →</button>}
              </div>
            </div>
          )}
        </div>
      )}
    </AdminLayout>
  );
}
