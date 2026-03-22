import { useAdminListActivity } from '@workspace/api-client-react';
import { AdminLayout } from './admin-dashboard';
import { format } from 'date-fns';
import { useState } from 'react';
import { Input } from '@/components/ui';
import { Search, Activity } from 'lucide-react';

export function AdminActivityPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const { data, isLoading } = useAdminListActivity({ page, limit: 50, search: search || undefined } as any);

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Activity Logs</h1>
      </div>

      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input className="w-full h-11 pl-10 pr-4 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-primary" placeholder="Search actions..." value={search} onChange={e => setSearch(e.target.value)} />
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
                    <th className="text-left p-4 text-sm font-medium text-slate-400">Company</th>
                    <th className="text-left p-4 text-sm font-medium text-slate-400">User</th>
                    <th className="text-left p-4 text-sm font-medium text-slate-400">Action</th>
                    <th className="text-left p-4 text-sm font-medium text-slate-400">Entity</th>
                    <th className="text-left p-4 text-sm font-medium text-slate-400">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {data?.logs.map((log: any) => (
                    <tr key={log.id} className="hover:bg-slate-800/50">
                      <td className="p-4 text-sm text-white">{log.companyName || '—'}</td>
                      <td className="p-4 text-sm text-slate-300">{log.userName || '—'}</td>
                      <td className="p-4">
                        <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-mono">{log.action}</span>
                      </td>
                      <td className="p-4 text-xs text-slate-400">{log.entityType && `${log.entityType} #${log.entityId}`}</td>
                      <td className="p-4 text-xs text-slate-500">{format(new Date(log.createdAt), 'MMM d, h:mm a')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data && data.total > 50 && (
            <div className="p-4 border-t border-slate-800 flex items-center justify-between">
              <span className="text-sm text-slate-400">Page {page} of {Math.ceil(data.total / 50)}</span>
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
