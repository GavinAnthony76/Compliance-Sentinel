import { useEffect, useState } from 'react';
import { useParams, Link, useLocation } from 'wouter';
import { usePortalAuth } from '@/hooks/use-portal-auth';
import { Button, Card, CardContent } from '@/components/ui';
import { ArrowLeft, Calendar, Clock, MapPin, Leaf } from 'lucide-react';

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    pending:   { label: 'Pending',   className: 'bg-yellow-100 text-yellow-800' },
    confirmed: { label: 'Confirmed', className: 'bg-blue-100 text-blue-800' },
    completed: { label: 'Completed', className: 'bg-green-100 text-green-800' },
    cancelled: { label: 'Cancelled', className: 'bg-red-100 text-red-800' },
  };
  const s = map[status] ?? { label: status, className: 'bg-gray-100 text-gray-700' };
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${s.className}`}>{s.label}</span>;
}

export function PortalAppointmentsPage() {
  const { slug } = useParams<{ slug: string }>();
  const { isLoading, isAuthenticated, session, portalFetch } = usePortalAuth();
  const [, setLocation] = useLocation();
  const [appointments, setAppointments] = useState<any[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) setLocation(`/portal/${slug}/login`);
  }, [isLoading, isAuthenticated, slug, setLocation]);

  useEffect(() => {
    if (!isAuthenticated) return;
    portalFetch('/api/portal/appointments').then(r => r.json()).then(data => {
      setAppointments(Array.isArray(data) ? data : []);
    }).finally(() => setDataLoading(false));
  }, [isAuthenticated]);

  const upcoming = appointments.filter(a => a.status !== 'completed' && a.status !== 'cancelled');
  const past = appointments.filter(a => a.status === 'completed' || a.status === 'cancelled');

  if (isLoading || !isAuthenticated) {
    return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  }

  function AppointmentCard({ apt }: { apt: any }) {
    return (
      <Card className="border-border/50">
        <CardContent className="py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1.5 flex-1">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-primary shrink-0" />
                <p className="font-semibold">{apt.serviceName || 'Service Appointment'}</p>
              </div>
              {apt.scheduledStart && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  <span>{new Date(apt.scheduledStart).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</span>
                  <span>at {new Date(apt.scheduledStart).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              )}
              {apt.notes && (
                <p className="text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded">{apt.notes}</p>
              )}
            </div>
            <StatusBadge status={apt.status} />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-border sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link href={`/portal/${slug}`}>
            <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
          </Link>
          <div className="flex items-center gap-2 text-primary font-bold text-xl">
            <Leaf className="w-6 h-6 fill-primary" />
            {session?.company.name}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        <h1 className="text-2xl font-bold">Appointments</h1>

        {dataLoading ? (
          <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
        ) : (
          <>
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Upcoming</h2>
              {upcoming.length === 0 ? (
                <Card className="border-border/50"><CardContent className="py-8 text-center text-muted-foreground">No upcoming appointments.</CardContent></Card>
              ) : (
                <div className="space-y-3">{upcoming.map(apt => <AppointmentCard key={apt.id} apt={apt} />)}</div>
              )}
            </section>
            {past.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Past</h2>
                <div className="space-y-3">{past.map(apt => <AppointmentCard key={apt.id} apt={apt} />)}</div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
