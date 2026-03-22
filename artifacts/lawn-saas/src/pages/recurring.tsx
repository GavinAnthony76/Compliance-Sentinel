import { useState } from 'react';
import { useListRecurringPlans, useCreateRecurringPlan, useUpdateRecurringPlan, useDeleteRecurringPlan, useListCustomers, useListServices } from '@workspace/api-client-react';
import { AppLayout } from '@/components/layout';
import { PlanGate } from '@/components/plan-gate';
import { Card, Button, Input } from '@/components/ui';
import { Plus, RotateCw, DollarSign } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { getListRecurringPlansQueryKey } from '@workspace/api-client-react';
import { format } from 'date-fns';

const FREQ_LABELS: Record<string, string> = { weekly: 'Weekly', biweekly: 'Every 2 Weeks', monthly: 'Monthly', custom: 'Custom' };
const FREQ_COLORS: Record<string, string> = { weekly: 'bg-blue-100 text-blue-700', biweekly: 'bg-purple-100 text-purple-700', monthly: 'bg-green-100 text-green-700', custom: 'bg-gray-100 text-gray-600' };

function PlanModal({ plan, onClose }: { plan?: any; onClose: () => void }) {
  const [form, setForm] = useState({ customerId: plan?.customerId ?? '', serviceId: plan?.serviceId ?? '', frequencyType: plan?.frequencyType ?? 'weekly', price: plan?.price ?? '', isActive: plan?.isActive ?? true });
  const { toast } = useToast();
  const qc = useQueryClient();
  const createMut = useCreateRecurringPlan();
  const updateMut = useUpdateRecurringPlan();
  const { data: customers } = useListCustomers({ page: 1, limit: 100 } as any);
  const { data: services } = useListServices();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = { ...form, customerId: Number(form.customerId), serviceId: form.serviceId ? Number(form.serviceId) : undefined, price: form.price ? Number(form.price) : undefined };
    try {
      if (plan?.id) {
        await updateMut.mutateAsync({ id: plan.id, data });
      } else {
        await createMut.mutateAsync({ data });
      }
      toast({ title: plan?.id ? 'Plan updated' : 'Recurring plan created' });
      qc.invalidateQueries({ queryKey: getListRecurringPlansQueryKey() });
      onClose();
    } catch {
      toast({ title: 'Error saving plan', variant: 'destructive' });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-lg p-6">
        <h2 className="text-xl font-bold mb-6">{plan?.id ? 'Edit Recurring Plan' : 'New Recurring Plan'}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Customer *</label>
            <select className="w-full mt-1 h-11 px-3 rounded-xl border border-input bg-background text-sm" value={form.customerId} onChange={e => setForm(f => ({ ...f, customerId: e.target.value }))} required>
              <option value="">Select customer...</option>
              {customers?.customers.map(c => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">Service</label>
            <select className="w-full mt-1 h-11 px-3 rounded-xl border border-input bg-background text-sm" value={form.serviceId} onChange={e => setForm(f => ({ ...f, serviceId: e.target.value }))}>
              <option value="">Select service...</option>
              {services?.services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Frequency</label>
              <select className="w-full mt-1 h-11 px-3 rounded-xl border border-input bg-background text-sm" value={form.frequencyType} onChange={e => setForm(f => ({ ...f, frequencyType: e.target.value }))}>
                {Object.entries(FREQ_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Price ($)</label>
              <Input type="number" step="0.01" className="mt-1" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} placeholder="0.00" icon={<DollarSign className="w-4 h-4" />} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input type="checkbox" id="active" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} className="w-4 h-4 accent-primary" />
            <label htmlFor="active" className="text-sm font-medium">Active</label>
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button type="submit" className="flex-1" isLoading={createMut.isPending || updateMut.isPending}>Save Plan</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function RecurringPage() {
  const { data, isLoading } = useListRecurringPlans();
  const [editing, setEditing] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const deleteMut = useDeleteRecurringPlan();

  return (
    <AppLayout>
      <PlanGate feature="recurring_plans">
      {(creating || editing) && <PlanModal plan={editing} onClose={() => { setEditing(null); setCreating(false); }} />}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold">Recurring Plans</h1>
          <p className="text-muted-foreground mt-1">Automate repeat service scheduling</p>
        </div>
        <Button onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-2" />New Plan</Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
      ) : data?.plans.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-16 h-16 bg-accent rounded-full flex items-center justify-center mb-4"><RotateCw className="w-8 h-8 text-muted-foreground" /></div>
          <h3 className="text-xl font-semibold mb-2">No recurring plans</h3>
          <p className="text-muted-foreground mb-6">Set up automatic repeat service schedules for your customers</p>
          <Button onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-2" />Create First Plan</Button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data?.plans.map(plan => (
            <Card key={plan.id} className="border-border/50 hover:shadow-md transition-all">
              <div className="p-6">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold">{plan.customerName || 'Unknown Customer'}</h3>
                    <p className="text-sm text-muted-foreground">{plan.serviceName || 'No service'}</p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${plan.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                    {plan.isActive ? 'Active' : 'Paused'}
                  </span>
                </div>
                <div className="flex items-center gap-3 mb-4">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${FREQ_COLORS[plan.frequencyType]}`}>
                    <RotateCw className="w-3 h-3 inline mr-1" />{FREQ_LABELS[plan.frequencyType]}
                  </span>
                  {plan.price && <span className="text-sm text-muted-foreground">${Number(plan.price).toFixed(2)}</span>}
                </div>
                {plan.nextRunAt && <p className="text-xs text-muted-foreground mb-4">Next: {format(new Date(plan.nextRunAt), 'MMM d, yyyy')}</p>}
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => setEditing(plan)}>Edit</Button>
                  <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10" onClick={async () => {
                    if (!confirm('Delete this recurring plan?')) return;
                    await deleteMut.mutateAsync({ id: plan.id });
                    qc.invalidateQueries({ queryKey: getListRecurringPlansQueryKey() });
                    toast({ title: 'Plan deleted' });
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
