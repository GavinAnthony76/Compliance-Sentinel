import { useState, useEffect } from 'react';
import { useListAppointments, useCreateAppointment, useUpdateAppointment, useDeleteAppointment, useCompleteAppointment, useListCustomers, useListServices, useListTeam } from '@workspace/api-client-react';
import { AppLayout } from '@/components/layout';
import { Card, Button, Input } from '@/components/ui';
import { Plus, Calendar, Download, FileText, Images, X, ImageIcon, Loader2 } from 'lucide-react';
import { useAuthState } from '@/hooks/use-auth-state';
import { useLocation } from 'wouter';

function downloadExport(path: string, filename: string, onError: (msg: string) => void) {
  fetch(path, { headers: { Authorization: `Bearer ${localStorage.getItem('greensync_token')}` } })
    .then(r => {
      if (!r.ok) throw new Error(r.status === 403 ? 'CSV export requires the Pro plan.' : `Export failed (${r.status})`);
      return r.blob();
    })
    .then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    })
    .catch(err => onError(err.message || 'Export failed'));
}
import { AppointmentStatusBadge } from '@/components/status-badge';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { getListAppointmentsQueryKey } from '@workspace/api-client-react';
import { format } from 'date-fns';
import { Link } from 'wouter';

const TOKEN = () => localStorage.getItem('greensync_token');

function AuthedImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(src, { headers: { Authorization: `Bearer ${TOKEN()}` } });
        if (!res.ok) throw new Error();
        const blob = await res.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        revoked = url;
        setObjectUrl(url);
      } catch { if (!cancelled) setFailed(true); }
    })();
    return () => { cancelled = true; if (revoked) URL.revokeObjectURL(revoked); };
  }, [src]);
  if (failed) return <div className={`flex items-center justify-center bg-muted text-muted-foreground ${className ?? ''}`}><ImageIcon className="w-5 h-5" /></div>;
  if (!objectUrl) return <div className={`flex items-center justify-center bg-muted ${className ?? ''}`}><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>;
  return <img src={objectUrl} alt={alt} className={className} loading="lazy" />;
}

function PhotoViewerModal({ appointment, onClose }: { appointment: any; onClose: () => void }) {
  const [photos, setPhotos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/appointment-photos?appointmentId=${appointment.id}`, {
      headers: { Authorization: `Bearer ${TOKEN()}` },
    })
      .then(r => r.json())
      .then(data => setPhotos(data.photos ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [appointment.id]);

  const before = photos.filter(p => p.type === 'before');
  const after = photos.filter(p => p.type === 'after');
  const general = photos.filter(p => p.type === 'general');

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 className="text-lg font-bold">Job Photos</h2>
            <p className="text-sm text-muted-foreground mt-0.5">{appointment.customerName} · {appointment.serviceName || 'Service'}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-muted transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-6">
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-7 h-7 animate-spin text-muted-foreground" /></div>
          ) : photos.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Images className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No photos have been uploaded for this appointment yet.</p>
            </div>
          ) : (
            <>
              {before.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Before ({before.length})</h3>
                  <div className="grid grid-cols-3 gap-2">
                    {before.map(p => <AuthedImage key={p.id} src={p.fileUrl} alt={p.caption || 'Before'} className="w-full aspect-square object-cover rounded-lg" />)}
                  </div>
                </div>
              )}
              {after.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">After ({after.length})</h3>
                  <div className="grid grid-cols-3 gap-2">
                    {after.map(p => <AuthedImage key={p.id} src={p.fileUrl} alt={p.caption || 'After'} className="w-full aspect-square object-cover rounded-lg" />)}
                  </div>
                </div>
              )}
              {general.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">General ({general.length})</h3>
                  <div className="grid grid-cols-3 gap-2">
                    {general.map(p => <AuthedImage key={p.id} src={p.fileUrl} alt={p.caption || 'Photo'} className="w-full aspect-square object-cover rounded-lg" />)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function EditAppointmentModal({ appointment, onClose }: { appointment: any; onClose: () => void }) {
  const [form, setForm] = useState({
    serviceId: appointment.serviceId?.toString() ?? '',
    assignedUserId: appointment.assignedUserId?.toString() ?? '',
    scheduledStart: appointment.scheduledStart ? new Date(appointment.scheduledStart).toISOString().slice(0, 16) : '',
    scheduledEnd: appointment.scheduledEnd ? new Date(appointment.scheduledEnd).toISOString().slice(0, 16) : '',
    status: appointment.status ?? 'pending',
    notes: appointment.notes ?? '',
    price: appointment.price?.toString() ?? '',
  });
  const { toast } = useToast();
  const qc = useQueryClient();
  const updateMut = useUpdateAppointment();
  const { data: services } = useListServices();
  const { data: team } = useListTeam();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateMut.mutateAsync({
        id: appointment.id,
        data: {
          serviceId: form.serviceId ? Number(form.serviceId) : undefined,
          assignedUserId: form.assignedUserId ? Number(form.assignedUserId) : undefined,
          scheduledStart: new Date(form.scheduledStart).toISOString(),
          scheduledEnd: form.scheduledEnd ? new Date(form.scheduledEnd).toISOString() : undefined,
          status: form.status as any,
          notes: form.notes || undefined,
          price: form.price ? Number(form.price) : undefined,
        },
      });
      toast({ title: 'Appointment updated' });
      qc.invalidateQueries({ queryKey: getListAppointmentsQueryKey() });
      onClose();
    } catch {
      toast({ title: 'Error updating appointment', variant: 'destructive' });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-lg p-6">
        <h2 className="text-xl font-bold mb-6">Edit Appointment</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
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
              <label className="text-sm font-medium">Start Date/Time *</label>
              <Input type="datetime-local" value={form.scheduledStart} onChange={e => setForm(f => ({ ...f, scheduledStart: e.target.value }))} required />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">End Date/Time</label>
              <Input type="datetime-local" value={form.scheduledEnd} onChange={e => setForm(f => ({ ...f, scheduledEnd: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Status</label>
              <select className="w-full h-11 px-3 rounded-xl border border-input bg-background text-sm" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                <option value="pending">Pending</option>
                <option value="confirmed">Confirmed</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
                <option value="no_show">No Show</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Price ($)</label>
              <Input type="number" step="0.01" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} placeholder="0.00" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Notes</label>
            <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any special instructions..." />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button type="submit" className="flex-1" isLoading={updateMut.isPending}>Save Changes</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function NewAppointmentModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({
    customerId: '',
    serviceId: '',
    assignedUserId: '',
    scheduledStart: '',
    scheduledEnd: '',
    status: 'pending',
    notes: '',
    price: '',
  });
  const { toast } = useToast();
  const qc = useQueryClient();
  const createMut = useCreateAppointment();
  const { data: customers } = useListCustomers({ search: undefined, page: 1, limit: 100 });
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
      toast({ title: 'Error creating appointment', variant: 'destructive' });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-lg p-6">
        <h2 className="text-xl font-bold mb-6">Schedule Appointment</h2>
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
                <option value="">Select service...</option>
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
              <label className="text-sm font-medium">Start Date/Time *</label>
              <Input type="datetime-local" value={form.scheduledStart} onChange={e => setForm(f => ({ ...f, scheduledStart: e.target.value }))} required />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">End Date/Time</label>
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
            <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any special instructions..." />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button type="submit" className="flex-1" isLoading={createMut.isPending}>Schedule</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function AppointmentsPage() {
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [viewingPhotos, setViewingPhotos] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [creatingInvoice, setCreatingInvoice] = useState<number | null>(null);
  const { user } = useAuthState();
  const plan = user?.company?.subscriptionPlan ?? 'starter';
  const isStaff = user?.role === 'staff';
  const { data, isLoading } = useListAppointments({
    status: statusFilter || undefined,
    page: 1,
    limit: 50,
    ...(isStaff && user?.id ? { assignedUserId: user.id } : {}),
  } as any);
  const { toast } = useToast();
  const qc = useQueryClient();
  const deleteMut = useDeleteAppointment();
  const completeMut = useCompleteAppointment();
  const [, setLocation] = useLocation();

  const handleCreateInvoice = async (apptId: number) => {
    setCreatingInvoice(apptId);
    try {
      const res = await fetch(`/api/invoices/from-appointment/${apptId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('greensync_token')}` },
      });
      if (!res.ok) throw new Error('Could not load appointment data');
      const data = await res.json();
      if (data.existingInvoiceId) {
        // Navigate to invoices page — auto-opens detail modal for existing invoice
        toast({ title: 'Invoice already exists', description: 'Opening that invoice now.' });
        setLocation(`/invoices?openInvoice=${data.existingInvoiceId}`);
      } else {
        // Navigate to invoices page — auto-opens create modal prefilled from this appointment
        toast({ title: 'Opening invoice editor', description: 'Pre-filled from this appointment.' });
        setLocation(`/invoices?fromAppt=${apptId}`);
      }
    } catch {
      toast({ title: 'Could not create invoice', variant: 'destructive' });
    } finally {
      setCreatingInvoice(null);
    }
  };

  const statuses = ['', 'pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'];

  return (
    <AppLayout>
      {showNew && <NewAppointmentModal onClose={() => setShowNew(false)} />}
      {editing && <EditAppointmentModal appointment={editing} onClose={() => setEditing(null)} />}
      {viewingPhotos && <PhotoViewerModal appointment={viewingPhotos} onClose={() => setViewingPhotos(null)} />}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold">Appointments</h1>
          <p className="text-muted-foreground mt-1">Schedule and manage your jobs</p>
        </div>
        <div className="flex gap-2">
          {plan === 'pro' && (
            <Button variant="outline" onClick={() => downloadExport('/api/export/appointments', 'appointments.csv', msg => toast({ title: msg, variant: 'destructive' }))}>
              <Download className="w-4 h-4 mr-2" />Export CSV
            </Button>
          )}
          <Button onClick={() => setShowNew(true)}><Plus className="w-4 h-4 mr-2" />New Appointment</Button>
        </div>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap">
        {statuses.map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${statusFilter === s ? 'bg-primary text-primary-foreground shadow-md' : 'bg-card border border-border hover:border-primary/50 text-muted-foreground hover:text-foreground'}`}
          >
            {s ? s.replace('_', ' ').replace(/^\w/, c => c.toUpperCase()) : 'All'}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
      ) : (
        <Card className="border-border/50 overflow-hidden">
          {data?.appointments.length === 0 ? (
            <div className="p-12 text-center">
              <Calendar className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No appointments {statusFilter ? `with status "${statusFilter}"` : 'yet'}</h3>
              <Button onClick={() => setShowNew(true)} className="mt-4"><Plus className="w-4 h-4 mr-2" />Schedule First Appointment</Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-accent/30">
                    <th className="text-left p-4 text-sm font-semibold text-muted-foreground">Customer</th>
                    <th className="text-left p-4 text-sm font-semibold text-muted-foreground">Service</th>
                    <th className="text-left p-4 text-sm font-semibold text-muted-foreground">Assigned To</th>
                    <th className="text-left p-4 text-sm font-semibold text-muted-foreground">Date & Time</th>
                    <th className="text-left p-4 text-sm font-semibold text-muted-foreground">Status</th>
                    <th className="text-left p-4 text-sm font-semibold text-muted-foreground">Price</th>
                    <th className="text-right p-4 text-sm font-semibold text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data?.appointments.map(apt => (
                    <tr key={apt.id} className="hover:bg-accent/30 transition-colors">
                      <td className="p-4">
                        <div className="font-medium text-sm">{apt.customerName || 'Unknown'}</div>
                      </td>
                      <td className="p-4 text-sm text-muted-foreground">{apt.serviceName || '—'}</td>
                      <td className="p-4 text-sm text-muted-foreground">{apt.assignedUserName || <span className="text-xs text-muted-foreground/60">Unassigned</span>}</td>
                      <td className="p-4 text-sm">{format(new Date(apt.scheduledStart), 'MMM d, yyyy h:mm a')}</td>
                      <td className="p-4"><AppointmentStatusBadge status={apt.status} /></td>
                      <td className="p-4 text-sm">{apt.price ? `$${Number(apt.price).toFixed(2)}` : '—'}</td>
                      <td className="p-4">
                        <div className="flex items-center gap-2 justify-end">
                          <Button size="sm" variant="outline" onClick={() => setEditing(apt)}>
                            Edit
                          </Button>
                          {apt.status === 'completed' && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setViewingPhotos(apt)}
                                className="text-violet-600 border-violet-200 hover:bg-violet-50"
                              >
                                <Images className="w-3.5 h-3.5 mr-1" />Photos
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                isLoading={creatingInvoice === apt.id}
                                onClick={() => handleCreateInvoice(apt.id)}
                                className="text-blue-600 border-blue-200 hover:bg-blue-50"
                              >
                                <FileText className="w-3.5 h-3.5 mr-1" />Invoice
                              </Button>
                            </>
                          )}
                          {apt.status !== 'completed' && apt.status !== 'cancelled' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={async () => {
                                await completeMut.mutateAsync({ id: apt.id, data: {} });
                                qc.invalidateQueries({ queryKey: getListAppointmentsQueryKey() });
                                toast({ title: 'Job marked complete' });
                              }}
                              className="text-green-600 border-green-200 hover:bg-green-50"
                            >
                              Complete
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:bg-destructive/10"
                            onClick={async () => {
                              if (!confirm('Delete appointment?')) return;
                              await deleteMut.mutateAsync({ id: apt.id });
                              qc.invalidateQueries({ queryKey: getListAppointmentsQueryKey() });
                              toast({ title: 'Appointment deleted' });
                            }}
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </AppLayout>
  );
}
