import { useState } from 'react';
import { useListRoutes, useCreateRoute, useUpdateRoute, useDeleteRoute } from '@workspace/api-client-react';
import { AppLayout } from '@/components/layout';
import { PlanGate } from '@/components/plan-gate';
import { Card, Button, Input } from '@/components/ui';
import { Plus, Route as RouteIcon, Sparkles, MapPin, Clock, Bell } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { getListRoutesQueryKey } from '@workspace/api-client-react';
import { format } from 'date-fns';

export function RoutesPage() {
  const { data, isLoading } = useListRoutes({ page: 1, limit: 50 } as any);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', date: '', notes: '' });
  const { toast } = useToast();
  const qc = useQueryClient();
  const createMut = useCreateRoute();
  const updateMut = useUpdateRoute();
  const deleteMut = useDeleteRoute();
  const [sendingReminders, setSendingReminders] = useState(false);

  const handleSendReminders = async () => {
    setSendingReminders(true);
    try {
      const res = await fetch('/api/routes/send-appointment-reminders', { method: 'POST' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || 'Failed');
      toast({ title: `Reminders sent!`, description: `${d.remindersSent} of ${d.totalTomorrow} tomorrow's appointments notified.` });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSendingReminders(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createMut.mutateAsync({ data: { name: form.name, date: new Date(form.date).toISOString(), notes: form.notes || undefined } });
      toast({ title: 'Route created' });
      qc.invalidateQueries({ queryKey: getListRoutesQueryKey() });
      setShowNew(false);
      setForm({ name: '', date: '', notes: '' });
    } catch {
      toast({ title: 'Error creating route', variant: 'destructive' });
    }
  };

  return (
    <AppLayout>
      <PlanGate feature="routes">
      {showNew && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold mb-6">New Route</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="text-sm font-medium">Route Name *</label>
                <Input className="mt-1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Monday South Route" required />
              </div>
              <div>
                <label className="text-sm font-medium">Date *</label>
                <Input type="date" className="mt-1" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} required />
              </div>
              <div>
                <label className="text-sm font-medium">Notes</label>
                <Input className="mt-1" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes" />
              </div>
              <div className="flex gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => setShowNew(false)} className="flex-1">Cancel</Button>
                <Button type="submit" className="flex-1" isLoading={createMut.isPending}>Create Route</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold">Routes</h1>
          <p className="text-muted-foreground mt-1">Plan and optimize your daily job routes</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSendReminders} isLoading={sendingReminders}>
            <Bell className="w-4 h-4 mr-2" />Send Reminders
          </Button>
          <Button onClick={() => setShowNew(true)}><Plus className="w-4 h-4 mr-2" />New Route</Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
      ) : data?.routes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4"><RouteIcon className="w-8 h-8 text-primary" /></div>
          <h3 className="text-xl font-semibold mb-2">No routes yet</h3>
          <p className="text-muted-foreground mb-6 text-center max-w-sm">Create routes to group and optimize appointments by geography for efficient scheduling</p>
          <Button onClick={() => setShowNew(true)}><Plus className="w-4 h-4 mr-2" />Create First Route</Button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {data?.routes.map(route => (
            <Card key={route.id} className="border-border/50 hover:shadow-md transition-all">
              <div className="p-6">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold">{route.name}</h3>
                    <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                      <Clock className="w-3.5 h-3.5" />{format(new Date(route.date), 'EEE, MMM d, yyyy')}
                    </p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${route.status === 'completed' ? 'bg-green-100 text-green-700' : route.status === 'in_progress' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                    {route.status || 'draft'}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
                  <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{route.stopsCount ?? 0} stops</span>
                  {route.totalDistanceKm && <span>{Number(route.totalDistanceKm).toFixed(1)} km</span>}
                  {route.estimatedDurationMin && <span><Clock className="w-3.5 h-3.5 inline mr-0.5" />{route.estimatedDurationMin} min</span>}
                </div>
                {route.notes && <p className="text-xs text-muted-foreground mb-4">{route.notes}</p>}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={async () => {
                      await updateMut.mutateAsync({ id: route.id, data: { status: 'optimized' } });
                      qc.invalidateQueries({ queryKey: getListRoutesQueryKey() });
                      toast({ title: 'Route updated!' });
                    }}
                    isLoading={updateMut.isPending}
                  >
                    <Sparkles className="w-3.5 h-3.5 mr-1.5" />Optimize
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10" onClick={async () => {
                    if (!confirm('Delete route?')) return;
                    await deleteMut.mutateAsync({ id: route.id });
                    qc.invalidateQueries({ queryKey: getListRoutesQueryKey() });
                    toast({ title: 'Route deleted' });
                  }}>Delete</Button>
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
