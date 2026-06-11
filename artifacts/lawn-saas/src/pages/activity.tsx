import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout';
import { Card } from '@/components/ui';
import { Activity as ActivityIcon, Filter } from 'lucide-react';
import { format } from 'date-fns';

const PAGE_SIZE = 50;

interface ActivityLog {
  id: number;
  action: string;
  entityType: string | null;
  entityId: number | null;
  userId: number | null;
  userName: string | null;
  metadataJson: { actor?: string } | null;
  createdAt: string;
}

interface ActivityResponse {
  logs: ActivityLog[];
  total: number;
  page: number;
  limit: number;
}

const CATEGORIES: { value: string; label: string }[] = [
  { value: '', label: 'All activity' },
  { value: 'billing', label: 'Billing & plan' },
  { value: 'invoice', label: 'Invoices' },
  { value: 'appointment', label: 'Appointments' },
  { value: 'customer', label: 'Customers' },
  { value: 'estimate', label: 'Estimates' },
  { value: 'automation', label: 'Automations' },
  { value: 'company', label: 'Company' },
];

const CATEGORY_COLORS: Record<string, string> = {
  billing: 'bg-violet-100 text-violet-700',
  invoice: 'bg-amber-100 text-amber-700',
  appointment: 'bg-emerald-100 text-emerald-700',
  customer: 'bg-blue-100 text-blue-700',
  estimate: 'bg-orange-100 text-orange-700',
  automation: 'bg-pink-100 text-pink-700',
  company: 'bg-slate-200 text-slate-700',
};

function categoryClass(action: string): string {
  const prefix = action.split('.')[0];
  return CATEGORY_COLORS[prefix] ?? 'bg-slate-100 text-slate-600';
}

function formatAction(action: string): string {
  return action.replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function actorLabel(log: ActivityLog): string {
  if (log.userName) return log.userName;
  if (log.metadataJson?.actor) return log.metadataJson.actor;
  return 'Stripe / automated';
}

function useActivity(page: number, category: string) {
  return useQuery<ActivityResponse>({
    queryKey: ['/api/activity', page, category],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (category) params.set('category', category);
      const res = await fetch(`/api/activity?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch activity');
      return res.json();
    },
  });
}

export function ActivityPage() {
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState('');
  const { data, isLoading } = useActivity(page, category);

  const handleCategory = (val: string) => { setCategory(val); setPage(1); };
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <AppLayout>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Activity History</h1>
          <p className="text-sm text-muted-foreground mt-1">A complete, searchable record of everything that's happened in your account.</p>
        </div>
        {data && <span className="text-sm text-muted-foreground shrink-0">{data.total} {data.total === 1 ? 'event' : 'events'}</span>}
      </div>

      <div className="mb-6">
        <div className="relative inline-block">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <select
            className="h-11 pl-10 pr-9 rounded-xl bg-card border border-border text-sm text-foreground focus:outline-none focus:border-primary appearance-none cursor-pointer"
            value={category}
            onChange={e => handleCategory(e.target.value)}
          >
            {CATEGORIES.map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
      ) : (
        <Card className="overflow-hidden">
          {!data || data.logs.length === 0 ? (
            <div className="py-20 text-center">
              <ActivityIcon className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
              <p className="text-muted-foreground">No activity {category ? 'in this category ' : ''}yet</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {data.logs.map(log => (
                <div key={log.id} className="flex items-start gap-3 px-4 sm:px-6 py-4 hover:bg-accent/40 transition-colors">
                  <span className={`shrink-0 mt-0.5 px-2 py-0.5 rounded-md text-[11px] font-semibold capitalize ${categoryClass(log.action)}`}>
                    {log.action.split('.')[0].replace(/_/g, ' ')}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{formatAction(log.action)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {actorLabel(log)}
                      {log.entityType ? ` · ${log.entityType}${log.entityId ? ` #${log.entityId}` : ''}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground whitespace-nowrap mt-0.5">
                    {format(new Date(log.createdAt), 'MMM d, yyyy · h:mm a')}
                  </span>
                </div>
              ))}
            </div>
          )}

          {data && data.total > PAGE_SIZE && (
            <div className="px-4 sm:px-6 py-4 border-t border-border flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1.5 rounded-lg bg-accent text-foreground text-sm font-medium hover:bg-accent/70 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  ← Prev
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1.5 rounded-lg bg-accent text-foreground text-sm font-medium hover:bg-accent/70 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </Card>
      )}
    </AppLayout>
  );
}
