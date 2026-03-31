import { useEffect, useState } from 'react';
import { useParams, Link, useLocation } from 'wouter';
import { usePortalAuth } from '@/hooks/use-portal-auth';
import { useToast } from '@/hooks/use-toast';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { Calendar, CreditCard, FileText, LogOut, Leaf, Clock, CheckCircle, AlertCircle, Plus } from 'lucide-react';
import { useSearch } from 'wouter';

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    pending:   { label: 'Pending',   className: 'bg-yellow-100 text-yellow-800' },
    confirmed: { label: 'Confirmed', className: 'bg-blue-100 text-blue-800' },
    completed: { label: 'Completed', className: 'bg-green-100 text-green-800' },
    cancelled: { label: 'Cancelled', className: 'bg-red-100 text-red-800' },
    draft:     { label: 'Draft',     className: 'bg-gray-100 text-gray-700' },
    sent:      { label: 'Sent',      className: 'bg-blue-100 text-blue-800' },
    paid:      { label: 'Paid',      className: 'bg-green-100 text-green-800' },
    overdue:   { label: 'Overdue',   className: 'bg-red-100 text-red-800' },
    accepted:  { label: 'Accepted',  className: 'bg-green-100 text-green-800' },
    rejected:  { label: 'Rejected',  className: 'bg-red-100 text-red-800' },
  };
  const s = map[status] ?? { label: status, className: 'bg-gray-100 text-gray-700' };
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${s.className}`}>{s.label}</span>;
}

export function PortalDashboardPage() {
  const { slug } = useParams<{ slug: string }>();
  const search = useSearch();
  const { session, isLoading, isAuthenticated, logout, portalFetch } = usePortalAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [appointments, setAppointments] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  // Show payment success notification
  useEffect(() => {
    const params = new URLSearchParams(search);
    if (params.get('payment') === 'success') {
      toast({ title: 'Payment successful!', description: 'Your invoice has been paid.' });
    }
  }, []);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      setLocation(`/portal/${slug}/login`);
    }
  }, [isLoading, isAuthenticated, slug, setLocation]);

  useEffect(() => {
    if (!isAuthenticated) return;
    Promise.all([
      portalFetch('/api/portal/appointments').then(r => r.json()),
      portalFetch('/api/portal/invoices').then(r => r.json()),
    ]).then(([appts, invs]) => {
      setAppointments(Array.isArray(appts) ? appts.slice(0, 5) : []);
      setInvoices(Array.isArray(invs) ? invs.slice(0, 5) : []);
    }).finally(() => setDataLoading(false));
  }, [isAuthenticated]);

  if (isLoading || !isAuthenticated) {
    return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  }

  const unpaidInvoices = invoices.filter(i => i.status !== 'paid');

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-border sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary font-bold text-xl">
            <Leaf className="w-6 h-6 fill-primary" />
            <span>{session?.company.name || 'Customer Portal'}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground hidden sm:block">
              Hi, {session?.customer.firstName}
            </span>
            <Button variant="ghost" size="sm" onClick={() => logout(slug)}>
              <LogOut className="w-4 h-4 mr-1" /> Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Welcome */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">Welcome back, {session?.customer.firstName}!</h1>
          <p className="text-muted-foreground mt-1">Manage your appointments, invoices, and service history.</p>
        </div>

        {/* Unpaid invoices alert */}
        {unpaidInvoices.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-amber-800">You have {unpaidInvoices.length} outstanding invoice{unpaidInvoices.length > 1 ? 's' : ''}</p>
              <p className="text-amber-700 text-sm mt-0.5">Total due: ${unpaidInvoices.reduce((sum, i) => sum + Number(i.total), 0).toFixed(2)}</p>
            </div>
            <Link href={`/portal/${slug}/invoices`}>
              <Button size="sm" className="shrink-0">Pay Now</Button>
            </Link>
          </div>
        )}

        {/* Quick links */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Link href={`/portal/${slug}/appointments?book=1`}>
            <Card className="hover:shadow-md transition-shadow cursor-pointer border-primary/30 bg-primary/5">
              <CardContent className="pt-5 pb-4 flex flex-col items-center gap-2 text-center">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Plus className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Book</p>
                  <p className="text-xs text-muted-foreground">New appointment</p>
                </div>
              </CardContent>
            </Card>
          </Link>
          <Link href={`/portal/${slug}/appointments`}>
            <Card className="hover:shadow-md transition-shadow cursor-pointer border-border/50">
              <CardContent className="pt-5 pb-4 flex flex-col items-center gap-2 text-center">
                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                  <Calendar className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Appointments</p>
                  <p className="text-xs text-muted-foreground">View schedule</p>
                </div>
              </CardContent>
            </Card>
          </Link>
          <Link href={`/portal/${slug}/invoices`}>
            <Card className="hover:shadow-md transition-shadow cursor-pointer border-border/50">
              <CardContent className="pt-5 pb-4 flex flex-col items-center gap-2 text-center">
                <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center">
                  <CreditCard className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Invoices</p>
                  <p className="text-xs text-muted-foreground">Pay & history</p>
                </div>
              </CardContent>
            </Card>
          </Link>
          <Link href={`/portal/${slug}/estimates`}>
            <Card className="hover:shadow-md transition-shadow cursor-pointer border-border/50">
              <CardContent className="pt-5 pb-4 flex flex-col items-center gap-2 text-center">
                <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-violet-600" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Estimates</p>
                  <p className="text-xs text-muted-foreground">Review & sign</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>

        {/* Recent Appointments */}
        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-semibold">Recent Appointments</CardTitle>
            <Link href={`/portal/${slug}/appointments`} className="text-sm text-primary hover:underline">View all</Link>
          </CardHeader>
          <CardContent>
            {dataLoading ? (
              <div className="flex justify-center py-4"><div className="animate-spin w-6 h-6 border-4 border-primary border-t-transparent rounded-full" /></div>
            ) : appointments.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No appointments found</p>
            ) : (
              <div className="space-y-3">
                {appointments.map(apt => (
                  <div key={apt.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                    <div className="flex items-center gap-3">
                      <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div>
                        <p className="text-sm font-medium">{apt.serviceName || 'Service'}</p>
                        <p className="text-xs text-muted-foreground">{apt.scheduledStart ? new Date(apt.scheduledStart).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'TBD'}</p>
                      </div>
                    </div>
                    <StatusBadge status={apt.status} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Invoices */}
        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-semibold">Recent Invoices</CardTitle>
            <Link href={`/portal/${slug}/invoices`} className="text-sm text-primary hover:underline">View all</Link>
          </CardHeader>
          <CardContent>
            {dataLoading ? (
              <div className="flex justify-center py-4"><div className="animate-spin w-6 h-6 border-4 border-primary border-t-transparent rounded-full" /></div>
            ) : invoices.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No invoices found</p>
            ) : (
              <div className="space-y-3">
                {invoices.map(inv => (
                  <div key={inv.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                    <div className="flex items-center gap-3">
                      {inv.status === 'paid'
                        ? <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
                        : <CreditCard className="w-4 h-4 text-muted-foreground shrink-0" />
                      }
                      <div>
                        <p className="text-sm font-medium">{inv.invoiceNumber}</p>
                        <p className="text-xs text-muted-foreground">${Number(inv.total).toFixed(2)}</p>
                      </div>
                    </div>
                    <StatusBadge status={inv.status} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
