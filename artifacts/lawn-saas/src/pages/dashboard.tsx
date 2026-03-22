import { useGetDashboard } from '@workspace/api-client-react';
import { AppLayout } from '@/components/layout';
import { Card, CardContent, Button } from '@/components/ui';
import { formatCurrency, formatTime } from '@/lib/utils';
import { Users, Calendar as CalendarIcon, DollarSign, AlertCircle, Plus, ArrowRight } from 'lucide-react';
import { AppointmentStatusBadge } from '@/components/status-badge';
import { Link } from 'wouter';

export function DashboardPage() {
  const { data, isLoading, error } = useGetDashboard();

  if (isLoading) return (
    <AppLayout>
      <div className="flex h-[50vh] items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    </AppLayout>
  );

  if (error || !data) return (
    <AppLayout>
      <div className="p-8 text-center text-destructive">Failed to load dashboard data.</div>
    </AppLayout>
  );

  const stats = [
    { label: "Today's Jobs", value: data.todayAppointments.length.toString(), icon: CalendarIcon, color: "text-blue-600", bg: "bg-blue-100" },
    { label: "Total Customers", value: data.totalCustomers.toString(), icon: Users, color: "text-emerald-600", bg: "bg-emerald-100" },
    { label: "Revenue (MTD)", value: formatCurrency(data.revenueThisMonth), icon: DollarSign, color: "text-purple-600", bg: "bg-purple-100" },
    { label: "Unpaid Invoices", value: data.unpaidInvoicesCount.toString(), icon: AlertCircle, color: "text-orange-600", bg: "bg-orange-100" },
  ];

  return (
    <AppLayout>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Welcome back. Here's what's happening today.</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" className="bg-white"><Plus className="w-4 h-4 mr-2"/> New Quote</Button>
          <Button><Plus className="w-4 h-4 mr-2"/> New Job</Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat, i) => (
          <Card key={i} className="border-border/50 hover:shadow-md transition-all">
            <CardContent className="p-6 flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${stat.bg}`}>
                <stat.icon className={`w-6 h-6 ${stat.color}`} />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">{stat.label}</p>
                <h3 className="text-2xl font-bold text-foreground mt-1">{stat.value}</h3>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        {/* Today's Schedule */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold font-display">Today's Schedule</h2>
            <Link href="/calendar" className="text-sm font-medium text-primary flex items-center hover:underline">
              View Calendar <ArrowRight className="w-4 h-4 ml-1" />
            </Link>
          </div>
          
          <Card className="overflow-hidden border-border/50">
            {data.todayAppointments.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground flex flex-col items-center">
                <div className="w-16 h-16 bg-accent rounded-full flex items-center justify-center mb-4">
                  <CalendarIcon className="w-8 h-8 text-primary/50" />
                </div>
                <p>No jobs scheduled for today.</p>
                <Button variant="outline" className="mt-4">Schedule a Job</Button>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {data.todayAppointments.map(apt => (
                  <div key={apt.id} className="p-4 hover:bg-accent/50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className="min-w-[80px] text-center pt-1">
                        <div className="text-sm font-bold text-foreground">{formatTime(apt.scheduledStart)}</div>
                      </div>
                      <div className="w-1 h-12 bg-primary/20 rounded-full" />
                      <div>
                        <h4 className="font-semibold text-foreground">{apt.customerName || 'Unknown Customer'}</h4>
                        <p className="text-sm text-muted-foreground">{apt.serviceName}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 sm:ml-auto pl-24 sm:pl-0">
                      <AppointmentStatusBadge status={apt.status} />
                      <Button variant="outline" size="sm">View</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Right Sidebar - Recent Customers */}
        <div className="space-y-4">
          <h2 className="text-xl font-bold font-display">Recent Customers</h2>
          <Card className="border-border/50">
            <div className="divide-y divide-border">
              {data.recentCustomers.map(customer => (
                <div key={customer.id} className="p-4 flex items-center justify-between hover:bg-accent/50 transition-colors">
                  <div>
                    <h4 className="font-medium text-sm">{customer.firstName} {customer.lastName}</h4>
                    <p className="text-xs text-muted-foreground">{customer.city || 'No city'}</p>
                  </div>
                  <Link href={`/customers/${customer.id}`}>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0"><ArrowRight className="w-4 h-4" /></Button>
                  </Link>
                </div>
              ))}
              {data.recentCustomers.length === 0 && (
                <div className="p-6 text-center text-sm text-muted-foreground">No customers yet.</div>
              )}
            </div>
            <div className="p-3 bg-accent/30 border-t border-border text-center">
              <Link href="/customers" className="text-sm font-medium text-primary hover:underline">View all customers</Link>
            </div>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
