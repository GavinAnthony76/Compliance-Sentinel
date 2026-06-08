import { useState } from 'react';
import {
  useListRoutes, useCreateRoute, useUpdateRoute, useDeleteRoute,
  useGetRoute, useAddRouteStop, useDeleteRouteStop,
  useListTeam, useListAppointments,
  getListRoutesQueryKey, getGetRouteQueryKey,
} from '@workspace/api-client-react';
import { AppLayout } from '@/components/layout';
import { PlanGate } from '@/components/plan-gate';
import { Card, Button, Input } from '@/components/ui';
import { Plus, Route as RouteIcon, MapPin, Clock, Bell, X, Pencil, ChevronRight, Navigation, Trash2, Sparkles } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';

// ─── Status helpers ──────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  planned: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
};

const STATUS_NEXT: Record<string, string> = {
  planned: 'in_progress',
  in_progress: 'completed',
};

const STATUS_ACTION_LABEL: Record<string, string> = {
  planned: 'Start Route',
  in_progress: 'Mark Complete',
};

// ─── Route Form Modal (create + edit) ────────────────────────────────────────

function RouteFormModal({ route, onClose }: { route?: any; onClose: () => void }) {
  const isEdit = !!route?.id;
  const [form, setForm] = useState({
    name: route?.name ?? '',
    date: route?.routeDate ? new Date(route.routeDate).toISOString().slice(0, 10) : '',
    notes: route?.notes ?? '',
    assignedUserId: route?.assignedUserId ? String(route.assignedUserId) : '',
  });
  const { toast } = useToast();
  const qc = useQueryClient();
  const createMut = useCreateRoute();
  const updateMut = useUpdateRoute();
  const { data: team } = useListTeam();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (isEdit) {
        await updateMut.mutateAsync({
          id: route.id,
          data: {
            name: form.name || undefined,
            routeDate: new Date(form.date).toISOString(),
            notes: form.notes || undefined,
            assignedUserId: form.assignedUserId ? Number(form.assignedUserId) : null,
          } as any,
        });
        toast({ title: 'Route updated' });
      } else {
        await createMut.mutateAsync({
          data: {
            name: form.name || undefined,
            routeDate: new Date(form.date).toISOString(),
            notes: form.notes || undefined,
            assignedUserId: form.assignedUserId ? Number(form.assignedUserId) : undefined,
          } as any,
        });
        toast({ title: 'Route created' });
      }
      qc.invalidateQueries({ queryKey: getListRoutesQueryKey() });
      onClose();
    } catch {
      toast({ title: isEdit ? 'Error updating route' : 'Error creating route', variant: 'destructive' });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-md p-6">
        <h2 className="text-xl font-bold mb-6">{isEdit ? 'Edit Route' : 'New Route'}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Route Name *</label>
            <Input className="mt-1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Monday South Route" required />
          </div>
          <div>
            <label className="text-sm font-medium">Date *</label>
            <Input type="date" className="mt-1" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} required />
          </div>
          <div>
            <label className="text-sm font-medium">Assign To</label>
            <select className="w-full mt-1 h-11 px-3 rounded-xl border border-input bg-background text-sm" value={form.assignedUserId} onChange={e => setForm(f => ({ ...f, assignedUserId: e.target.value }))}>
              <option value="">Unassigned</option>
              {team?.members.filter(m => m.isActive).map(m => (
                <option key={m.id} value={m.id}>{m.firstName} {m.lastName}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">Notes</label>
            <Input className="mt-1" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes" />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button type="submit" className="flex-1" isLoading={createMut.isPending || updateMut.isPending}>
              {isEdit ? 'Save Changes' : 'Create Route'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Stops Modal ─────────────────────────────────────────────────────────────

function StopsModal({ routeId, routeName, onClose }: { routeId: number; routeName: string; onClose: () => void }) {
  const { data, isLoading } = useGetRoute(routeId);
  const { data: apptList } = useListAppointments({ page: 1, limit: 100, status: 'confirmed' } as any);
  const { toast } = useToast();
  const qc = useQueryClient();
  const addStopMut = useAddRouteStop();
  const deleteStopMut = useDeleteRouteStop();
  const [selectedApptId, setSelectedApptId] = useState('');
  const [sendingOnMyWay, setSendingOnMyWay] = useState<number | null>(null);
  const [etaMinutes, setEtaMinutes] = useState('');
  const [optimizing, setOptimizing] = useState(false);

  const existingApptIds = new Set((data as any)?.stops?.map((s: any) => s.appointmentId) ?? []);

  const availableAppts = (apptList?.appointments ?? []).filter(a => !existingApptIds.has(a.id));

  const handleAddStop = async () => {
    if (!selectedApptId) return;
    try {
      const currentStops = (data as any)?.stops ?? [];
      await addStopMut.mutateAsync({
        id: routeId,
        data: { appointmentId: Number(selectedApptId), stopOrder: currentStops.length } as any,
      });
      qc.invalidateQueries({ queryKey: getGetRouteQueryKey(routeId) });
      qc.invalidateQueries({ queryKey: getListRoutesQueryKey() });
      setSelectedApptId('');
      toast({ title: 'Stop added' });
    } catch {
      toast({ title: 'Error adding stop', variant: 'destructive' });
    }
  };

  const handleDeleteStop = async (stopId: number) => {
    try {
      await deleteStopMut.mutateAsync({ routeId, stopId });
      qc.invalidateQueries({ queryKey: getGetRouteQueryKey(routeId) });
      qc.invalidateQueries({ queryKey: getListRoutesQueryKey() });
      toast({ title: 'Stop removed' });
    } catch {
      toast({ title: 'Error removing stop', variant: 'destructive' });
    }
  };

  const handleOnMyWay = async (stopId: number) => {
    setSendingOnMyWay(stopId);
    try {
      const res = await fetch(`/api/routes/${routeId}/stops/${stopId}/on-my-way`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('greensync_token')}` },
        body: JSON.stringify({ etaMinutes: etaMinutes ? Number(etaMinutes) : undefined }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || 'Failed');
      toast({ title: 'Customer notified!', description: d.notified ? 'SMS/email sent successfully.' : 'No contact info on file.' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSendingOnMyWay(null);
    }
  };

  const handleOptimize = async () => {
    setOptimizing(true);
    try {
      const res = await fetch(`/api/routes/${routeId}/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('greensync_token')}` },
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || 'Failed to optimize');
      if (!d.optimized) {
        toast({ title: 'Could not optimize', description: d.message, variant: 'destructive' });
      } else {
        qc.invalidateQueries({ queryKey: getGetRouteQueryKey(routeId) });
        toast({
          title: 'Route optimized!',
          description: `${d.stopCount} stops · ~${d.totalDistanceMiles} mi total drive${d.ungeocodedCount ? ` (${d.ungeocodedCount} without coordinates placed last)` : ''}.`,
        });
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setOptimizing(false);
    }
  };

  const stops: any[] = (data as any)?.stops ?? [];

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-card rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border shrink-0">
          <div>
            <h2 className="text-xl font-bold">{routeName}</h2>
            <p className="text-sm text-muted-foreground mt-0.5">{stops.length} stop{stops.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleOptimize}
              disabled={stops.length < 2}
              isLoading={optimizing}
              className="gap-1.5"
              title={stops.length < 2 ? 'Add at least 2 stops to optimize' : 'Reorder stops to minimize drive time'}
            >
              <Sparkles className="w-4 h-4" />Optimize
            </Button>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-accent transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-6 space-y-6">
          {/* Add Stop */}
          <div>
            <p className="text-sm font-medium mb-2">Add Stop</p>
            <div className="flex gap-2">
              <select
                className="flex-1 h-10 px-3 rounded-xl border border-input bg-background text-sm"
                value={selectedApptId}
                onChange={e => setSelectedApptId(e.target.value)}
              >
                <option value="">Pick an appointment...</option>
                {availableAppts.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.customerName} — {format(new Date(a.scheduledStart), 'MMM d, h:mm a')} {a.serviceName ? `(${a.serviceName})` : ''}
                  </option>
                ))}
              </select>
              <Button size="sm" onClick={handleAddStop} disabled={!selectedApptId} isLoading={addStopMut.isPending}>
                <Plus className="w-4 h-4 mr-1" />Add
              </Button>
            </div>
          </div>

          {/* ETA for On My Way */}
          <div>
            <p className="text-sm font-medium mb-2">ETA for "On My Way" (optional)</p>
            <Input
              type="number"
              placeholder="Minutes away (e.g. 15)"
              value={etaMinutes}
              onChange={e => setEtaMinutes(e.target.value)}
              className="w-48"
            />
          </div>

          {/* Stops List */}
          {isLoading ? (
            <div className="flex justify-center py-8"><div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" /></div>
          ) : stops.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <MapPin className="w-8 h-8 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No stops yet. Add appointments above to build this route.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {stops.map((stop: any, idx: number) => {
                const appt = stop.appointment;
                return (
                  <div key={stop.id} className="flex items-start gap-3 p-4 rounded-xl border border-border bg-accent/20">
                    <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{appt?.customerName || `Appointment #${stop.appointmentId}`}</p>
                      {appt?.customerAddress && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3 h-3" />
                          {appt.customerAddress}{appt.customerCity ? `, ${appt.customerCity}` : ''}
                        </p>
                      )}
                      {appt?.scheduledStart && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Clock className="w-3 h-3" />
                          {format(new Date(appt.scheduledStart), 'h:mm a')}
                          {appt.serviceName ? ` · ${appt.serviceName}` : ''}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs px-2 py-1 h-auto"
                        onClick={() => handleOnMyWay(stop.id)}
                        isLoading={sendingOnMyWay === stop.id}
                      >
                        <Navigation className="w-3 h-3 mr-1" />On My Way
                      </Button>
                      <button
                        onClick={() => handleDeleteStop(stop.id)}
                        className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
                        title="Remove stop"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Routes Page ─────────────────────────────────────────────────────────────

export function RoutesPage() {
  const { data, isLoading } = useListRoutes({ page: 1, limit: 50 } as any);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [stopsRouteId, setStopsRouteId] = useState<number | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();
  const updateMut = useUpdateRoute();
  const deleteMut = useDeleteRoute();
  const [sendingReminders, setSendingReminders] = useState(false);

  const handleSendReminders = async () => {
    setSendingReminders(true);
    try {
      const res = await fetch('/api/routes/send-appointment-reminders', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('greensync_token')}` } });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || 'Failed');
      toast({ title: `Reminders sent!`, description: `${d.remindersSent} of ${d.totalTomorrow} tomorrow's appointments notified.` });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSendingReminders(false);
    }
  };

  const handleStatusCycle = async (route: any) => {
    const next = STATUS_NEXT[route.status ?? 'planned'];
    if (!next) return;
    await updateMut.mutateAsync({ id: route.id, data: { status: next } as any });
    qc.invalidateQueries({ queryKey: getListRoutesQueryKey() });
    toast({ title: `Route ${next === 'in_progress' ? 'started' : 'completed'}` });
  };

  const stopsRoute = stopsRouteId !== null
    ? data?.routes.find((r: any) => r.id === stopsRouteId)
    : null;

  return (
    <AppLayout>
      <PlanGate feature="route_optimization">
        {(showForm || editing) && (
          <RouteFormModal
            route={editing ?? undefined}
            onClose={() => { setShowForm(false); setEditing(null); }}
          />
        )}
        {stopsRouteId !== null && stopsRoute && (
          <StopsModal
            routeId={stopsRouteId}
            routeName={stopsRoute.name || format(new Date((stopsRoute as any).routeDate), 'EEE, MMM d, yyyy')}
            onClose={() => setStopsRouteId(null)}
          />
        )}

        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-display font-bold">Routes</h1>
            <p className="text-muted-foreground mt-1">Plan and manage your daily job routes</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleSendReminders} isLoading={sendingReminders}>
              <Bell className="w-4 h-4 mr-2" />Send Reminders
            </Button>
            <Button onClick={() => setShowForm(true)}><Plus className="w-4 h-4 mr-2" />New Route</Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
        ) : data?.routes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4"><RouteIcon className="w-8 h-8 text-primary" /></div>
            <h3 className="text-xl font-semibold mb-2">No routes yet</h3>
            <p className="text-muted-foreground mb-6 text-center max-w-sm">Create routes to group appointments by geography for efficient daily scheduling</p>
            <Button onClick={() => setShowForm(true)}><Plus className="w-4 h-4 mr-2" />Create First Route</Button>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {data?.routes.map((route: any) => (
              <Card key={route.id} className="border-border/50 hover:shadow-md transition-all">
                <div className="p-6">
                  {/* Header row */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0 mr-3">
                      <h3 className="font-semibold truncate">{route.name || format(new Date(route.routeDate), 'EEE, MMM d, yyyy')}</h3>
                      <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Clock className="w-3.5 h-3.5 shrink-0" />
                        {format(new Date(route.routeDate), 'EEE, MMM d, yyyy')}
                        {route.assignedUserName && ` · ${route.assignedUserName}`}
                      </p>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize shrink-0 ${STATUS_COLOR[route.status ?? 'planned'] ?? STATUS_COLOR.planned}`}>
                      {route.status ?? 'planned'}
                    </span>
                  </div>

                  {/* Stop count */}
                  <div className="flex items-center gap-1 text-sm text-muted-foreground mb-3">
                    <MapPin className="w-3.5 h-3.5" />
                    {route.stopsCount ?? 0} stop{(route.stopsCount ?? 0) !== 1 ? 's' : ''}
                  </div>

                  {route.notes && <p className="text-xs text-muted-foreground mb-4">{route.notes}</p>}

                  {/* Action buttons */}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex items-center gap-1"
                      onClick={() => setStopsRouteId(route.id)}
                    >
                      <MapPin className="w-3.5 h-3.5" />Stops
                      <ChevronRight className="w-3 h-3 ml-0.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditing(route)}
                    >
                      <Pencil className="w-3.5 h-3.5 mr-1" />Edit
                    </Button>
                    {STATUS_NEXT[route.status ?? 'planned'] && (
                      <Button
                        size="sm"
                        variant="outline"
                        isLoading={updateMut.isPending}
                        onClick={() => handleStatusCycle(route)}
                      >
                        {STATUS_ACTION_LABEL[route.status ?? 'planned']}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:bg-destructive/10 ml-auto"
                      onClick={async () => {
                        if (!confirm('Delete this route and all its stops?')) return;
                        await deleteMut.mutateAsync({ id: route.id });
                        qc.invalidateQueries({ queryKey: getListRoutesQueryKey() });
                        toast({ title: 'Route deleted' });
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </PlanGate>
    </AppLayout>
  );
}
