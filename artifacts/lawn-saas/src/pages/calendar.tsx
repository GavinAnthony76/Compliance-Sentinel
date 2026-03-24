import { useState } from 'react';
import { useListAppointments, useCreateAppointment, useListCustomers, useListServices, useListTeam, getListAppointmentsQueryKey } from '@workspace/api-client-react';
import { AppLayout } from '@/components/layout';
import { Button, Input } from '@/components/ui';
import { AppointmentStatusBadge } from '@/components/status-badge';
import { ChevronLeft, ChevronRight, Plus, X, Clock, User, Wrench, DollarSign, FileText } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek, isSameDay, isToday, addMonths, subMonths, addWeeks, subWeeks, addDays } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

const HOURS = Array.from({ length: 15 }, (_, i) => i + 6); // 6 AM – 8 PM

const STATUS_DOT: Record<string, string> = {
  pending: 'bg-yellow-400',
  confirmed: 'bg-blue-400',
  in_progress: 'bg-purple-400',
  completed: 'bg-green-400',
  cancelled: 'bg-gray-400',
  no_show: 'bg-red-400',
};

const STATUS_CHIP: Record<string, string> = {
  pending: 'bg-yellow-50 border-yellow-200 text-yellow-800',
  confirmed: 'bg-blue-50 border-blue-200 text-blue-800',
  in_progress: 'bg-purple-50 border-purple-200 text-purple-800',
  completed: 'bg-green-50 border-green-200 text-green-800',
  cancelled: 'bg-gray-50 border-gray-200 text-gray-500',
  no_show: 'bg-red-50 border-red-200 text-red-800',
};

function AppointmentDetailModal({ appt, onClose }: { appt: any; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-start justify-between mb-5">
          <h2 className="text-xl font-bold">Appointment Details</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-accent transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <User className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Customer</p>
              <p className="font-medium text-sm">{appt.customerName || '—'}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Wrench className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Service</p>
              <p className="font-medium text-sm">{appt.serviceName || '—'}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Clock className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Time</p>
              <p className="font-medium text-sm">
                {format(new Date(appt.scheduledStart), 'EEE, MMM d · h:mm a')}
                {appt.scheduledEnd && ` – ${format(new Date(appt.scheduledEnd), 'h:mm a')}`}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-4 h-4 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground mb-1">Status</p>
              <AppointmentStatusBadge status={appt.status} />
            </div>
          </div>
          {appt.price != null && (
            <div className="flex items-start gap-3">
              <DollarSign className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Price</p>
                <p className="font-medium text-sm">${Number(appt.price).toFixed(2)}</p>
              </div>
            </div>
          )}
          {appt.notes && (
            <div className="flex items-start gap-3">
              <FileText className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Notes</p>
                <p className="text-sm text-muted-foreground">{appt.notes}</p>
              </div>
            </div>
          )}
        </div>
        <div className="mt-6 pt-4 border-t border-border">
          <Button variant="outline" onClick={onClose} className="w-full">Close</Button>
        </div>
      </div>
    </div>
  );
}

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

export function CalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<'month' | 'week'>('month');
  const [selectedAppt, setSelectedAppt] = useState<any>(null);
  const [showNewJob, setShowNewJob] = useState(false);

  // Month view bounds
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calStart = startOfWeek(monthStart);
  const calEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  // Week view bounds (Mon–Sun)
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const fetchStart = view === 'week' ? weekStart : calStart;
  const fetchEnd = view === 'week' ? weekEnd : calEnd;

  const { data } = useListAppointments({
    startDate: fetchStart.toISOString(),
    endDate: fetchEnd.toISOString(),
    page: 1,
    limit: 200,
  } as any);

  const appointments = data?.appointments ?? [];

  const getAppsForDay = (day: Date) =>
    appointments.filter(a => isSameDay(new Date(a.scheduledStart), day));

  const getAppsForDayHour = (day: Date, hour: number) =>
    appointments.filter(a => {
      const d = new Date(a.scheduledStart);
      return isSameDay(d, day) && d.getHours() === hour;
    });

  const navigate = (dir: 1 | -1) => {
    if (view === 'week') {
      setCurrentDate(d => dir === 1 ? addWeeks(d, 1) : subWeeks(d, 1));
    } else {
      setCurrentDate(d => dir === 1 ? addMonths(d, 1) : subMonths(d, 1));
    }
  };

  const navLabel = view === 'week'
    ? `${format(weekStart, 'MMM d')} – ${format(weekEnd, 'MMM d, yyyy')}`
    : format(currentDate, 'MMMM yyyy');

  const ApptChip = ({ appt }: { appt: any }) => (
    <div
      className={`flex items-center gap-1 px-1.5 py-1 rounded-md border cursor-pointer transition-opacity hover:opacity-70 ${STATUS_CHIP[appt.status] || 'bg-primary/10 border-primary/20 text-foreground'}`}
      onClick={(e) => { e.stopPropagation(); setSelectedAppt(appt); }}
      title={`${appt.customerName} – ${appt.serviceName || 'Service'}`}
    >
      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[appt.status] || 'bg-gray-400'}`} />
      <span className="text-xs truncate leading-tight">
        {format(new Date(appt.scheduledStart), 'h:mm')} {appt.customerName?.split(' ')[0]}
      </span>
    </div>
  );

  return (
    <AppLayout>
      {selectedAppt && <AppointmentDetailModal appt={selectedAppt} onClose={() => setSelectedAppt(null)} />}
      {showNewJob && <NewJobModal onClose={() => setShowNewJob(false)} />}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-display font-bold">Calendar</h1>
          <p className="text-muted-foreground mt-1">Your schedule at a glance</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-xl border border-border overflow-hidden">
            {(['month', 'week'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${view === v ? 'bg-primary text-white' : 'bg-card text-muted-foreground hover:text-foreground'}`}>
                {v}
              </button>
            ))}
          </div>
          <Button onClick={() => setShowNewJob(true)}><Plus className="w-4 h-4 mr-2" />New Job</Button>
        </div>
      </div>

      <div className="bg-card rounded-2xl border border-border/50 shadow-sm overflow-hidden">
        {/* Navigator */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-accent transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h2 className="text-lg font-display font-bold">{navLabel}</h2>
          <button onClick={() => navigate(1)} className="p-2 rounded-lg hover:bg-accent transition-colors">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {view === 'month' ? (
          <>
            <div className="grid grid-cols-7 border-b border-border">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                <div key={d} className="py-3 text-center text-xs font-semibold text-muted-foreground">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 auto-rows-fr">
              {days.map((day, i) => {
                const dayAppts = getAppsForDay(day);
                const isCurrentMonth = day.getMonth() === currentDate.getMonth();
                const isTodayDate = isToday(day);
                return (
                  <div key={i} className={`min-h-[100px] p-2 border-b border-r border-border/50 ${!isCurrentMonth ? 'bg-accent/20' : 'hover:bg-accent/30'} transition-colors`}>
                    <div className={`w-8 h-8 flex items-center justify-center rounded-full text-sm font-medium mb-1 ${
                      isTodayDate ? 'bg-primary text-primary-foreground' : isCurrentMonth ? 'text-foreground' : 'text-muted-foreground/40'
                    }`}>
                      {format(day, 'd')}
                    </div>
                    <div className="space-y-0.5">
                      {dayAppts.slice(0, 3).map(appt => <ApptChip key={appt.id} appt={appt} />)}
                      {dayAppts.length > 3 && (
                        <div className="text-xs text-muted-foreground px-1.5">+{dayAppts.length - 3} more</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="overflow-x-auto">
            {/* Week day headers */}
            <div className="grid border-b border-border" style={{ gridTemplateColumns: '56px repeat(7, 1fr)' }}>
              <div className="py-3" />
              {weekDays.map((day, i) => (
                <div key={i} className={`py-2 text-center text-xs font-semibold border-l border-border ${isToday(day) ? 'text-primary' : 'text-muted-foreground'}`}>
                  <div>{format(day, 'EEE')}</div>
                  <div className={`mx-auto mt-1 w-7 h-7 flex items-center justify-center rounded-full text-sm font-bold ${isToday(day) ? 'bg-primary text-white' : ''}`}>
                    {format(day, 'd')}
                  </div>
                </div>
              ))}
            </div>
            {/* Time slots */}
            <div className="overflow-y-auto max-h-[560px]">
              {HOURS.map(hour => (
                <div key={hour} className="grid border-b border-border/40" style={{ gridTemplateColumns: '56px repeat(7, 1fr)', minHeight: '60px' }}>
                  <div className="py-2 pr-2 text-right text-xs text-muted-foreground leading-none pt-2.5 shrink-0">
                    {format(new Date(new Date().setHours(hour, 0, 0, 0)), 'h a')}
                  </div>
                  {weekDays.map((day, di) => {
                    const hourAppts = getAppsForDayHour(day, hour);
                    return (
                      <div key={di} className="p-1 border-l border-border/40">
                        <div className="space-y-0.5">
                          {hourAppts.map(appt => <ApptChip key={appt.id} appt={appt} />)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mt-4 text-xs text-muted-foreground">
        {Object.entries(STATUS_DOT).map(([status, color]) => (
          <div key={status} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-full ${color}`} />
            {status.replace('_', ' ').replace(/^\w/, c => c.toUpperCase())}
          </div>
        ))}
      </div>
    </AppLayout>
  );
}
