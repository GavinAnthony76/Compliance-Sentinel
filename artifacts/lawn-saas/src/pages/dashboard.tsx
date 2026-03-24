import { useState } from 'react';
import { useGetDashboard, useCreateAppointment, useListCustomers, useListServices, useListTeam, getListAppointmentsQueryKey } from '@workspace/api-client-react';
import { AppLayout } from '@/components/layout';
import { Card, CardContent, Button, Input } from '@/components/ui';
import { formatCurrency, formatTime } from '@/lib/utils';
import { Users, Calendar as CalendarIcon, DollarSign, AlertCircle, Plus, ArrowRight } from 'lucide-react';
import { AppointmentStatusBadge } from '@/components/status-badge';
import { Link } from 'wouter';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

function NewJobModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({
    customerId: '', serviceId: '', assignedUserId: '', scheduledStart: '', scheduledEnd: '',
    status: 'pending', notes: '', price: '',
  });
  const { toast } = useToast();
  const qc = useQueryClient();
  const createMut = useCreateAppointment();
  const { data: customers } = useListCustomers({ page: 1, limit: 100 } as any);
  const { data: services } = useListServices();
  const { data: team } = useListTeam();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createMut.mutateAsync({
        data: {
          customerId: Number(form.customerId),
          serviceId: form.serviceId ? Number(form.serviceId) : undefined,
          assignedUserId: form.assignedUserId ? Number(form.assignedUserId) : undefined,
          scheduledStart: new Date(form.scheduledStart).toISOString(),
          scheduledEnd: form.scheduledEnd ? new Date(form.scheduledEnd).toISOString() : undefined,
          status: form.status as any,
          notes: form.notes || undefined,
          price: form.price ? Number(form.price) : undefined,
        },
      });
      toast({ title: 'Appointment scheduled' });
      qc.invalidateQueries({ queryKey: getListAppointmentsQueryKey() });
      qc.invalidateQueries({ queryKey: ['/api/dashboard'] });
      onClose();
    } catch {
      toast({ title: 'Error scheduling appointment', variant: 'destructive' });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-lg p-6">
        <h2 className="text-xl font-bold mb-6">Schedule New Job</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Customer *</label>
            <select className="w-full h-11 px-3 rounded-xl border border-input bg-background text-sm" value={form.customerId} onChange={e => setForm(f => ({ ...f, customerId: e.target.value }))} required>
              <option value="">Select customer...</option>
              {customers?.customers.map(c => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Service</label>
              <select className="w-full h-11 px-3 rounded-xl border border-input bg-background text-sm" value={form.serviceId} onChange={e => setForm(f => ({ ...f, serviceId: e.target.value }))}>
                <option value="">No service</option>
                {services?.services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Assigned To</label>
              <select className="w-full h-11 px-3 rounded-xl border border-input bg-background text-sm" value={form.assignedUserId} onChange={e => setForm(f => ({ ...f, assignedUserId: e.target.value }))}>
                <option value="">Unassigned</option>
                {team?.members.filter(m => m.isActive).map(m => <option key={m.id} value={m.id}>{m.firstName} {m.lastName}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Start *</label>
              <Input type="datetime-local" value={form.scheduledStart} onChange={e => setForm(f => ({ ...f, scheduledStart: e.target.value }))} required />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">End</label>
              <Input type="datetime-local" value={form.scheduledEnd} onChange={e => setForm(f => ({ ...f, scheduledEnd: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Status</label>
              <select className="w-full h-11 px-3 rounded-xl border border-input bg-background text-sm" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                <option value="pending">Pending</option>
                <option value="confirmed">Confirmed</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Price ($)</label>
              <Input type="number" step="0.01" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} placeholder="0.00" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Notes</label>
            <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Special instructions..." />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button type="submit" className="flex-1" isLoading={createMut.isPending}>Schedule Job</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { data, isLoading, error } = useGetDashboard();
  const [showNewJob, setShowNewJob] = useState(false);

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
      {showNewJob && <NewJobModal onClose={() => setShowNewJob(false)} />}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Welcome back. Here's what's happening today.</p>
        </div>
        <div className="flex gap-3">
          <Link href="/invoices">
            <Button variant="outline" className="bg-white"><Plus className="w-4 h-4 mr-2" />New Invoice</Button>
          </Link>
          <Button onClick={() => setShowNewJob(true)}><Plus className="w-4 h-4 mr-2" />New Job</Button>
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
                <p className="mb-4">No jobs scheduled for today.</p>
                <Button onClick={() => setShowNewJob(true)}><Plus className="w-4 h-4 mr-2" />Schedule a Job</Button>
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
                        <p className="text-sm text-muted-foreground">{apt.serviceName || 'No service'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 sm:ml-auto pl-24 sm:pl-0">
                      <AppointmentStatusBadge status={apt.status} />
                      <Link href="/appointments">
                        <Button variant="outline" size="sm">View All</Button>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Quick Links */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Appointments', href: '/appointments', icon: CalendarIcon },
              { label: 'Customers', href: '/customers', icon: Users },
              { label: 'Invoices', href: '/invoices', icon: DollarSign },
              { label: 'Services', href: '/services', icon: AlertCircle },
            ].map(item => (
              <Link key={item.href} href={item.href}>
                <div className="flex flex-col items-center justify-center p-4 rounded-xl border border-border bg-card hover:bg-accent/50 hover:border-primary/30 transition-all cursor-pointer gap-2">
                  <item.icon className="w-5 h-5 text-primary" />
                  <span className="text-xs font-medium text-muted-foreground">{item.label}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Right Sidebar - Recent Customers */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold font-display">Recent Customers</h2>
            <Link href="/customers" className="text-sm font-medium text-primary hover:underline">View all</Link>
          </div>
          <Card className="border-border/50">
            <div className="divide-y divide-border">
              {data.recentCustomers.map(customer => (
                <Link key={customer.id} href={`/customers/${customer.id}`}>
                  <div className="p-4 flex items-center justify-between hover:bg-accent/50 transition-colors cursor-pointer">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                        {customer.firstName?.[0] || customer.lastName?.[0] || '?'}
                      </div>
                      <div>
                        <h4 className="font-medium text-sm">{customer.firstName} {customer.lastName}</h4>
                        <p className="text-xs text-muted-foreground">{customer.city || 'No city'}</p>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </Link>
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
