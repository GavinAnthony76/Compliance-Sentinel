import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout';
import { PlanGate } from '@/components/plan-gate';
import { Card } from '@/components/ui';
import { BarChart3, TrendingUp, Users, CalendarCheck, DollarSign, Clock, FileText, Wrench, UserCheck, Trophy, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';

function useReporting() {
  return useQuery({
    queryKey: ['/api/reporting'],
    queryFn: async () => {
      const res = await fetch('/api/reporting', { headers: { Authorization: `Bearer ${localStorage.getItem('greensync_token')}` } });
      if (!res.ok) throw new Error('Failed to fetch reporting data');
      return res.json();
    },
  });
}

function StatCard({ label, value, icon: Icon, color, sub }: { label: string; value: string | number; icon: any; color: string; sub?: string }) {
  return (
    <Card className="p-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
        </div>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </Card>
  );
}

function MonthlyChart({ data, label, valueKey, formatVal }: {
  data: any[];
  label: string;
  valueKey: string;
  formatVal?: (v: any) => string;
}) {
  if (!data || data.length === 0) {
    return <p className="text-muted-foreground text-sm text-center py-8">No data available</p>;
  }
  const max = Math.max(...data.map(d => Number(d[valueKey]) || 0), 1);
  return (
    <div className="space-y-3">
      {data.map((row, i) => {
        const val = Number(row[valueKey]) || 0;
        const pct = (val / max) * 100;
        return (
          <div key={i} className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground w-14 shrink-0">{row.month}</span>
            <div className="flex-1 bg-accent rounded-full h-2 overflow-hidden">
              <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-sm font-medium w-16 text-right">{formatVal ? formatVal(val) : val}</span>
          </div>
        );
      })}
    </div>
  );
}

function BreakdownChart({ data, labelKey, valueKey, formatVal }: {
  data: any[];
  labelKey: string;
  valueKey: string;
  formatVal?: (v: number) => string;
}) {
  if (!data || data.length === 0) {
    return <p className="text-muted-foreground text-sm text-center py-8">No data yet</p>;
  }
  const max = Math.max(...data.map(d => Number(d[valueKey]) || 0), 1);
  return (
    <div className="space-y-3">
      {data.map((row, i) => {
        const val = Number(row[valueKey]) || 0;
        const pct = (val / max) * 100;
        return (
          <div key={i} className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground w-28 shrink-0 truncate" title={row[labelKey]}>{row[labelKey]}</span>
            <div className="flex-1 bg-accent rounded-full h-2 overflow-hidden">
              <div className="bg-violet-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-sm font-medium w-20 text-right">{formatVal ? formatVal(val) : val}</span>
          </div>
        );
      })}
    </div>
  );
}

const AGING_BUCKETS: { key: string; label: string; color: string }[] = [
  { key: 'current', label: '0–30 days', color: 'bg-green-100 text-green-700' },
  { key: '31_60',   label: '31–60 days', color: 'bg-yellow-100 text-yellow-700' },
  { key: '61_90',   label: '61–90 days', color: 'bg-orange-100 text-orange-700' },
  { key: '90_plus', label: '90+ days',   color: 'bg-red-100 text-red-700' },
];

export function ReportingPage() {
  const { data, isLoading } = useReporting();

  return (
    <AppLayout>
      <PlanGate feature="growth_analytics">
        <div className="mb-8">
          <h1 className="text-3xl font-display font-bold">Reporting</h1>
          <p className="text-muted-foreground mt-1">Business performance metrics and trends</p>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <StatCard
                label="Total Revenue"
                value={`$${Number(data?.summary?.totalRevenue ?? 0).toFixed(2)}`}
                icon={DollarSign}
                color="bg-green-100 text-green-600"
                sub={`$${Number(data?.summary?.revenueThisMonth ?? 0).toFixed(2)} this month`}
              />
              <StatCard
                label="Total Appointments"
                value={data?.summary?.totalAppointments ?? 0}
                icon={CalendarCheck}
                color="bg-blue-100 text-blue-600"
                sub={`${data?.summary?.completionRate ?? 0}% completion rate`}
              />
              <StatCard
                label="Total Customers"
                value={data?.summary?.totalCustomers ?? 0}
                icon={Users}
                color="bg-purple-100 text-purple-600"
                sub={`${data?.summary?.activeRecurringPlans ?? 0} recurring plans`}
              />
              <StatCard
                label="Pending Invoices"
                value={`$${Number(data?.summary?.pendingInvoiceAmount ?? 0).toFixed(2)}`}
                icon={FileText}
                color="bg-orange-100 text-orange-600"
                sub={`${data?.summary?.pendingInvoiceCount ?? 0} unpaid invoices`}
              />
            </div>

            <div className="grid lg:grid-cols-2 gap-6 mb-6">
              <Card className="p-6">
                <div className="flex items-center gap-2 mb-6">
                  <BarChart3 className="w-5 h-5 text-primary" />
                  <h2 className="font-bold text-lg">Monthly Appointments</h2>
                </div>
                <MonthlyChart
                  data={data?.monthlyAppointments ?? []}
                  label="Appointments"
                  valueKey="total"
                />
              </Card>

              <Card className="p-6">
                <div className="flex items-center gap-2 mb-6">
                  <TrendingUp className="w-5 h-5 text-primary" />
                  <h2 className="font-bold text-lg">Monthly Revenue</h2>
                </div>
                <MonthlyChart
                  data={data?.monthlyRevenue ?? []}
                  label="Revenue"
                  valueKey="revenue"
                  formatVal={v => `$${Number(v).toFixed(0)}`}
                />
              </Card>
            </div>

            <Card className="p-6">
              <div className="flex items-center gap-2 mb-6">
                <Clock className="w-5 h-5 text-primary" />
                <h2 className="font-bold text-lg">Recent Paid Invoices</h2>
              </div>
              {data?.recentPaidInvoices?.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-8">No paid invoices yet</p>
              ) : (
                <div className="space-y-0 divide-y divide-border">
                  {data?.recentPaidInvoices?.map((inv: any) => (
                    <div key={inv.id} className="flex items-center justify-between py-3">
                      <div>
                        <p className="font-medium text-sm">{inv.invoiceNumber}</p>
                        <p className="text-xs text-muted-foreground">{inv.paidAt ? format(new Date(inv.paidAt), 'MMM d, yyyy') : '—'}</p>
                      </div>
                      <span className="font-semibold text-green-600">${Number(inv.total).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Pro Analytics Section */}
            <div className="pt-4">
              <div className="flex items-center gap-3 mb-6">
                <h2 className="text-2xl font-display font-bold">Advanced Analytics</h2>
                <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-violet-600 text-white">Pro</span>
              </div>
              <PlanGate feature="advanced_analytics">
                <div className="grid lg:grid-cols-2 gap-6">
                  {/* Service Breakdown */}
                  <Card className="p-6">
                    <div className="flex items-center gap-2 mb-6">
                      <Wrench className="w-5 h-5 text-violet-500" />
                      <h3 className="font-bold text-lg">Service Breakdown</h3>
                    </div>
                    <div className="flex gap-6 text-xs text-muted-foreground mb-4">
                      <span>Jobs completed per service type</span>
                    </div>
                    <BreakdownChart
                      data={data?.advanced?.serviceBreakdown ?? []}
                      labelKey="serviceName"
                      valueKey="jobCount"
                      formatVal={v => `${v} jobs`}
                    />
                    {(data?.advanced?.serviceBreakdown?.length ?? 0) === 0 && (
                      <p className="text-muted-foreground text-xs mt-2">No data yet — analytics will populate as you complete jobs and generate invoices.</p>
                    )}
                    {(data?.advanced?.serviceBreakdown?.length ?? 0) > 0 && (
                      <div className="mt-4 pt-4 border-t border-border space-y-1">
                        {data.advanced.serviceBreakdown.map((r: any, i: number) => (
                          <div key={i} className="flex justify-between text-xs text-muted-foreground">
                            <span className="truncate mr-2">{r.serviceName}</span>
                            <span className="font-medium text-foreground shrink-0">${Number(r.revenue).toFixed(0)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>

                  {/* Staff Performance */}
                  <Card className="p-6">
                    <div className="flex items-center gap-2 mb-6">
                      <UserCheck className="w-5 h-5 text-violet-500" />
                      <h3 className="font-bold text-lg">Staff Performance</h3>
                    </div>
                    <div className="flex gap-6 text-xs text-muted-foreground mb-4">
                      <span>Completed jobs per team member</span>
                    </div>
                    <BreakdownChart
                      data={data?.advanced?.staffPerformance ?? []}
                      labelKey="staffName"
                      valueKey="jobCount"
                      formatVal={v => `${v} jobs`}
                    />
                    {(data?.advanced?.staffPerformance?.length ?? 0) > 0 && (
                      <div className="mt-4 pt-4 border-t border-border space-y-1">
                        {data.advanced.staffPerformance.map((r: any, i: number) => (
                          <div key={i} className="flex justify-between text-xs text-muted-foreground">
                            <span className="truncate mr-2">{r.staffName}</span>
                            <span className="font-medium text-foreground shrink-0">${Number(r.revenue).toFixed(0)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {(data?.advanced?.staffPerformance?.length ?? 0) === 0 && (
                      <p className="text-muted-foreground text-xs mt-2">Assign team members to jobs to see performance data.</p>
                    )}
                  </Card>

                  {/* Customer LTV */}
                  <Card className="p-6">
                    <div className="flex items-center gap-2 mb-6">
                      <Trophy className="w-5 h-5 text-violet-500" />
                      <h3 className="font-bold text-lg">Top Customers by Revenue</h3>
                    </div>
                    {(data?.advanced?.topCustomers?.length ?? 0) === 0 ? (
                      <p className="text-muted-foreground text-sm text-center py-8">No paid invoices yet</p>
                    ) : (
                      <div className="space-y-3">
                        {data.advanced.topCustomers.map((c: any, i: number) => (
                          <div key={i} className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-7 h-7 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center text-xs font-bold shrink-0">
                                {i + 1}
                              </div>
                              <div>
                                <p className="text-sm font-medium">{c.customerName}</p>
                                <p className="text-xs text-muted-foreground">{c.invoiceCount} invoice{c.invoiceCount !== 1 ? 's' : ''}</p>
                              </div>
                            </div>
                            <span className="font-semibold text-green-600">${Number(c.totalRevenue).toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>

                  {/* Invoice Aging */}
                  <Card className="p-6">
                    <div className="flex items-center gap-2 mb-6">
                      <AlertTriangle className="w-5 h-5 text-violet-500" />
                      <h3 className="font-bold text-lg">Invoice Aging</h3>
                    </div>
                    <p className="text-xs text-muted-foreground mb-4">Open invoices (sent / overdue) by age</p>
                    {(data?.advanced?.invoiceAging?.length ?? 0) === 0 ? (
                      <p className="text-muted-foreground text-sm text-center py-8">No open invoices</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-3">
                        {AGING_BUCKETS.map(bucket => {
                          const row = data.advanced.invoiceAging.find((r: any) => r.bucket === bucket.key);
                          const count = row?.count ?? 0;
                          const total = row?.total ?? 0;
                          return (
                            <div key={bucket.key} className={`rounded-xl p-3 ${bucket.color}`}>
                              <p className="text-xs font-medium mb-1">{bucket.label}</p>
                              <p className="text-xl font-bold">{count}</p>
                              <p className="text-xs mt-0.5">${Number(total).toFixed(0)}</p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </Card>
                </div>
              </PlanGate>
            </div>
          </>
        )}
      </PlanGate>
    </AppLayout>
  );
}
