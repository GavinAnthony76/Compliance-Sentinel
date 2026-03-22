import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout';
import { PlanGate } from '@/components/plan-gate';
import { Card } from '@/components/ui';
import { BarChart3, TrendingUp, Users, CalendarCheck, DollarSign, Clock, Star, FileText } from 'lucide-react';
import { format } from 'date-fns';

function useReporting() {
  return useQuery({
    queryKey: ['/api/reporting'],
    queryFn: async () => {
      const res = await fetch('/api/reporting');
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

export function ReportingPage() {
  const { data, isLoading } = useReporting();

  return (
    <AppLayout>
      <PlanGate feature="reporting">
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
          </>
        )}
      </PlanGate>
    </AppLayout>
  );
}
