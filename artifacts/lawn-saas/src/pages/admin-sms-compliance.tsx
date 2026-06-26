import { useEffect, useState } from 'react';
import { AdminLayout } from './admin-dashboard';
import { MessageSquare, Users, Building2, TrendingDown, TrendingUp, ShieldCheck, Activity } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { format } from 'date-fns';

interface SmsComplianceData {
  customers: { totalOptIn: number; totalOptOut: number; total: number };
  companies: { totalOptIn: number; totalOptOut: number; total: number };
  keywordCounts: { keyword: string; count: number }[];
  eventTypeCounts: { eventType: string; count: number }[];
  recentEvents: {
    id: number;
    subjectType: string;
    subjectId: number;
    phone: string | null;
    eventType: string;
    keyword: string | null;
    source: string;
    prefCategory: string | null;
    prefValue: string | null;
    ipAddress: string | null;
    createdAt: string;
  }[];
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  opt_in: 'Opt-In',
  opt_out: 'Opt-Out',
  stop: 'STOP',
  start: 'START',
  help: 'HELP',
  pref_update: 'Pref Update',
};

const EVENT_TYPE_COLORS: Record<string, string> = {
  opt_in: 'bg-green-500/10 text-green-400',
  opt_out: 'bg-red-500/10 text-red-400',
  stop: 'bg-red-500/10 text-red-400',
  start: 'bg-green-500/10 text-green-400',
  help: 'bg-blue-500/10 text-blue-400',
  pref_update: 'bg-slate-600 text-slate-300',
};

export function AdminSmsCompliancePage() {
  const [data, setData] = useState<SmsComplianceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('greensync_admin_token');
    fetch('/api/admin/sms-compliance', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(setData)
      .catch(() => setError('Failed to load SMS compliance data'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <MessageSquare className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-white">SMS Compliance</h1>
            <p className="text-slate-400 text-sm">A2P 10DLC opt-in/opt-out audit dashboard</p>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-800/50 bg-red-900/20 p-4 text-red-400 text-sm">{error}</div>
        )}

        {data && (
          <>
            {/* Stat cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                icon={Users}
                label="Customer Opt-Ins"
                value={Number(data.customers.totalOptIn)}
                sub={`of ${Number(data.customers.total)} customers`}
                trend="up"
              />
              <StatCard
                icon={TrendingDown}
                label="Customer Opt-Outs"
                value={Number(data.customers.totalOptOut)}
                sub={`of ${Number(data.customers.total)} customers`}
                trend="down"
              />
              <StatCard
                icon={Building2}
                label="Company Opt-Ins"
                value={Number(data.companies.totalOptIn)}
                sub={`of ${Number(data.companies.total)} companies`}
                trend="up"
              />
              <StatCard
                icon={ShieldCheck}
                label="Opt-In Rate"
                value={
                  data.customers.total > 0
                    ? `${Math.round((Number(data.customers.totalOptIn) / Number(data.customers.total)) * 100)}%`
                    : '—'
                }
                sub="customers consented"
              />
            </div>

            {/* Keyword + Event type counts side by side */}
            <div className="grid lg:grid-cols-2 gap-4">
              <Card className="bg-slate-900 border-slate-800">
                <CardHeader className="pb-2 pt-5 px-5">
                  <CardTitle className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Inbound Keywords</CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-5">
                  {data.keywordCounts.length === 0 ? (
                    <p className="text-slate-500 text-sm">No keyword events yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {data.keywordCounts.map(k => (
                        <div key={k.keyword} className="flex items-center justify-between">
                          <span className="font-mono text-sm text-white">{k.keyword}</span>
                          <span className="text-sm text-slate-400">{Number(k.count).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="bg-slate-900 border-slate-800">
                <CardHeader className="pb-2 pt-5 px-5">
                  <CardTitle className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Events by Type</CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-5">
                  {data.eventTypeCounts.length === 0 ? (
                    <p className="text-slate-500 text-sm">No consent events yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {data.eventTypeCounts.map(e => (
                        <div key={e.eventType} className="flex items-center justify-between">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${EVENT_TYPE_COLORS[e.eventType] ?? 'bg-slate-700 text-slate-300'}`}>
                            {EVENT_TYPE_LABELS[e.eventType] ?? e.eventType}
                          </span>
                          <span className="text-sm text-slate-400">{Number(e.count).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Audit log */}
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader className="pb-2 pt-5 px-5 flex flex-row items-center gap-2">
                <Activity className="w-4 h-4 text-slate-400" />
                <CardTitle className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Recent Consent Events (last 50)</CardTitle>
              </CardHeader>
              <CardContent className="px-0 pb-2">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-slate-500 text-xs uppercase tracking-wider border-b border-slate-800">
                        <th className="text-left px-5 py-2.5 font-medium">Time</th>
                        <th className="text-left px-3 py-2.5 font-medium">Type</th>
                        <th className="text-left px-3 py-2.5 font-medium">Subject</th>
                        <th className="text-left px-3 py-2.5 font-medium">Event</th>
                        <th className="text-left px-3 py-2.5 font-medium">Source</th>
                        <th className="text-left px-3 py-2.5 font-medium">Phone</th>
                        <th className="text-left px-3 py-2.5 font-medium">Keyword</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {data.recentEvents.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-5 py-6 text-slate-500 text-center">No consent events recorded yet.</td>
                        </tr>
                      ) : (
                        data.recentEvents.map(evt => (
                          <tr key={evt.id} className="hover:bg-slate-800/30 transition-colors">
                            <td className="px-5 py-2.5 text-slate-400 whitespace-nowrap text-xs">
                              {format(new Date(evt.createdAt), 'MMM d, HH:mm')}
                            </td>
                            <td className="px-3 py-2.5">
                              <span className="text-xs text-slate-400 capitalize">{evt.subjectType}</span>
                            </td>
                            <td className="px-3 py-2.5 text-slate-300 text-xs">#{evt.subjectId}</td>
                            <td className="px-3 py-2.5">
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${EVENT_TYPE_COLORS[evt.eventType] ?? 'bg-slate-700 text-slate-300'}`}>
                                {EVENT_TYPE_LABELS[evt.eventType] ?? evt.eventType}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-slate-400 text-xs">{evt.source}</td>
                            <td className="px-3 py-2.5 text-slate-400 text-xs font-mono">{evt.phone ?? '—'}</td>
                            <td className="px-3 py-2.5 text-slate-400 text-xs font-mono">{evt.keyword ?? '—'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AdminLayout>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  trend,
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  sub: string;
  trend?: 'up' | 'down';
}) {
  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center">
            <Icon className="w-4 h-4 text-primary" />
          </div>
          {trend === 'up' && <TrendingUp className="w-4 h-4 text-green-400" />}
          {trend === 'down' && <TrendingDown className="w-4 h-4 text-red-400" />}
        </div>
        <div className="text-2xl font-bold text-white mb-0.5">{typeof value === 'number' ? value.toLocaleString() : value}</div>
        <p className="text-xs text-slate-500">{label}</p>
        <p className="text-xs text-slate-600 mt-0.5">{sub}</p>
      </CardContent>
    </Card>
  );
}
