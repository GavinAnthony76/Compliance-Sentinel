import { useEffect, useState } from 'react';
import { useParams, Link, useLocation, useSearch } from 'wouter';
import { usePortalAuth } from '@/hooks/use-portal-auth';
import { useToast } from '@/hooks/use-toast';
import { Button, Card, CardContent } from '@/components/ui';
import { ArrowLeft, Calendar, Clock, Leaf, Plus, X } from 'lucide-react';

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

function BookAppointmentModal({
  portalFetch,
  onClose,
  onBooked,
}: {
  portalFetch: (path: string, opts?: RequestInit) => Promise<Response>;
  onClose: () => void;
  onBooked: () => void;
}) {
  const { toast } = useToast();
  const [services, setServices] = useState<any[]>([]);
  const [loadingServices, setLoadingServices] = useState(true);
  const [servicesError, setServicesError] = useState(false);
  const [selectedService, setSelectedService] = useState<number | null>(null);
  const [preferredDate, setPreferredDate] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    portalFetch('/api/portal/services')
      .then(r => {
        if (!r.ok) throw new Error('Failed to load services');
        return r.json();
      })
      .then(data => setServices(Array.isArray(data) ? data : []))
      .catch(() => setServicesError(true))
      .finally(() => setLoadingServices(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedService) {
      toast({ title: 'Please select a service', variant: 'destructive' });
      return;
    }
    if (!preferredDate) {
      toast({ title: 'Please choose a preferred date and time', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      const res = await portalFetch('/api/portal/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId: selectedService, scheduledStart: new Date(preferredDate).toISOString(), notes: notes || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to book appointment');
      toast({ title: 'Appointment requested!', description: "We'll confirm your appointment shortly." });
      onBooked();
      onClose();
    } catch (err: any) {
      toast({ title: 'Booking failed', description: err.message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-lg font-bold">Book an Appointment</h2>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-100 transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-6">
          {/* Service Selection */}
          <div>
            <label className="block text-sm font-semibold mb-3">Select a Service *</label>
            {loadingServices ? (
              <div className="flex justify-center py-6"><div className="animate-spin w-6 h-6 border-4 border-primary border-t-transparent rounded-full" /></div>
            ) : servicesError ? (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-center">
                Could not load services. Please close and try again.
              </div>
            ) : services.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No services available yet.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {services.map(svc => (
                  <button
                    key={svc.id}
                    type="button"
                    onClick={() => setSelectedService(svc.id)}
                    className={`p-3.5 rounded-xl border-2 text-left transition-all ${
                      selectedService === svc.id
                        ? 'border-primary bg-primary/5'
                        : 'border-gray-200 hover:border-primary/40 hover:bg-gray-50'
                    }`}
                  >
                    <div className="font-semibold text-sm">{svc.name}</div>
                    {svc.basePrice != null && (
                      <div className="text-primary text-sm font-medium mt-0.5">${Number(svc.basePrice).toFixed(2)}</div>
                    )}
                    {svc.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{svc.description}</p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Preferred Date & Time */}
          <div>
            <label className="block text-sm font-semibold mb-2">Preferred Date & Time *</label>
            <input
              type="datetime-local"
              value={preferredDate}
              onChange={e => setPreferredDate(e.target.value)}
              min={new Date().toISOString().slice(0, 16)}
              required
              className="w-full h-10 px-3 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
            />
            <p className="text-xs text-muted-foreground mt-1">We'll confirm the exact time with you.</p>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-semibold mb-2">Additional Notes (optional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="Anything we should know? Gate code, parking instructions, specific areas to focus on..."
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm resize-none focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
            />
          </div>

          <div className="flex gap-3 pt-1">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button type="submit" className="flex-1" isLoading={submitting} disabled={submitting || loadingServices}>
              Request Appointment
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function PortalAppointmentsPage() {
  const { slug } = useParams<{ slug: string }>();
  const search = useSearch();
  const { isLoading, isAuthenticated, session, portalFetch } = usePortalAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [appointments, setAppointments] = useState<any[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [showBooking, setShowBooking] = useState(false);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<number | null>(null);

  // Auto-open booking modal if navigated from dashboard "Book" card
  useEffect(() => {
    const params = new URLSearchParams(search);
    if (params.get('book') === '1' && isAuthenticated) {
      setShowBooking(true);
    }
  }, [search, isAuthenticated]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) setLocation(`/portal/${slug}/login`);
  }, [isLoading, isAuthenticated, slug, setLocation]);

  useEffect(() => {
    if (!isAuthenticated) return;
    portalFetch('/api/portal/appointments').then(r => r.json()).then(data => {
      setAppointments(Array.isArray(data) ? data : []);
    }).finally(() => setDataLoading(false));
  }, [isAuthenticated]);

  const reloadAppointments = () => {
    portalFetch('/api/portal/appointments').then(r => r.json()).then(data => {
      setAppointments(Array.isArray(data) ? data : []);
    });
  };

  const handleBooked = () => {
    reloadAppointments();
  };

  const handleCancel = async (id: number) => {
    setCancellingId(id);
    try {
      const res = await portalFetch(`/api/portal/appointments/${id}/cancel`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Could not cancel appointment');
      setAppointments(prev => prev.map(a => a.id === id ? { ...a, status: 'cancelled' } : a));
      toast({ title: 'Appointment cancelled' });
    } catch (err: any) {
      toast({ title: 'Cancellation failed', description: err.message, variant: 'destructive' });
    } finally {
      setCancellingId(null);
      setConfirmCancelId(null);
    }
  };

  const upcoming = appointments.filter(a => a.status !== 'completed' && a.status !== 'cancelled');
  const past = appointments.filter(a => a.status === 'completed' || a.status === 'cancelled');

  if (isLoading || !isAuthenticated) {
    return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  }

  function AppointmentCard({ apt }: { apt: any }) {
    const canCancel = apt.status === 'pending' || apt.status === 'confirmed';
    const isConfirming = confirmCancelId === apt.id;
    const isCancelling = cancellingId === apt.id;

    return (
      <Card className="border-border/50">
        <CardContent className="py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1.5 flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-primary shrink-0" />
                <p className="font-semibold truncate">{apt.serviceName || 'Service Appointment'}</p>
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
            <div className="flex flex-col items-end gap-2 shrink-0">
              <StatusBadge status={apt.status} />
              {canCancel && !isConfirming && (
                <button
                  onClick={() => setConfirmCancelId(apt.id)}
                  className="text-xs text-red-500 hover:text-red-700 hover:underline transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>

          {/* Inline cancel confirmation */}
          {isConfirming && (
            <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">Cancel this appointment?</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmCancelId(null)}
                  disabled={isCancelling}
                >
                  Keep it
                </Button>
                <Button
                  size="sm"
                  className="bg-red-500 hover:bg-red-600 text-white border-0"
                  onClick={() => handleCancel(apt.id)}
                  isLoading={isCancelling}
                  disabled={isCancelling}
                >
                  Yes, cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {showBooking && (
        <BookAppointmentModal
          portalFetch={portalFetch}
          onClose={() => setShowBooking(false)}
          onBooked={handleBooked}
        />
      )}

      <header className="bg-white border-b border-border sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link href={`/portal/${slug}`}>
            <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
          </Link>
          <div className="flex items-center gap-2 text-primary font-bold text-xl flex-1 min-w-0">
            <Leaf className="w-6 h-6 fill-primary shrink-0" />
            <span className="truncate">{session?.company.name}</span>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">Appointments</h1>
          <Button onClick={() => setShowBooking(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Book Appointment
          </Button>
        </div>

        {dataLoading ? (
          <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
        ) : (
          <>
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Upcoming</h2>
              {upcoming.length === 0 ? (
                <Card className="border-border/50">
                  <CardContent className="py-10 text-center">
                    <p className="text-muted-foreground mb-4">No upcoming appointments.</p>
                    <Button variant="outline" onClick={() => setShowBooking(true)}>
                      <Plus className="w-4 h-4 mr-2" />
                      Book your first appointment
                    </Button>
                  </CardContent>
                </Card>
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
