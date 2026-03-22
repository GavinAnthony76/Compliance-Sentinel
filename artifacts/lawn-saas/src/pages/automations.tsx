import { useState } from 'react';
import { useListAutomations, useCreateAutomation, useUpdateAutomation, useDeleteAutomation, useToggleAutomation } from '@workspace/api-client-react';
import { AppLayout } from '@/components/layout';
import { PlanGate } from '@/components/plan-gate';
import { Card, Button, Input } from '@/components/ui';
import { Plus, Zap } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { getListAutomationsQueryKey } from '@workspace/api-client-react';

const TRIGGERS = ['appointment_completed', 'invoice_overdue', 'appointment_upcoming_24h', 'customer_created', 'appointment_no_show'];
const ACTIONS = ['send_review_request', 'send_sms_reminder', 'send_email_reminder', 'create_invoice', 'send_followup_email'];

function AutomationModal({ automation, onClose }: { automation?: any; onClose: () => void }) {
  const [form, setForm] = useState({ name: automation?.name ?? '', triggerType: automation?.triggerType ?? 'appointment_completed', actionType: automation?.actionType ?? 'send_review_request', isActive: automation?.isActive ?? true });
  const { toast } = useToast();
  const qc = useQueryClient();
  const createMut = useCreateAutomation();
  const updateMut = useUpdateAutomation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (automation?.id) {
        await updateMut.mutateAsync({ id: automation.id, data: form });
      } else {
        await createMut.mutateAsync({ data: form });
      }
      toast({ title: automation?.id ? 'Automation updated' : 'Automation created' });
      qc.invalidateQueries({ queryKey: getListAutomationsQueryKey() });
      onClose();
    } catch {
      toast({ title: 'Error saving automation', variant: 'destructive' });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-lg p-6">
        <h2 className="text-xl font-bold mb-6">{automation?.id ? 'Edit Automation' : 'New Automation'}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Rule Name *</label>
            <Input className="mt-1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Send review after job" required />
          </div>
          <div>
            <label className="text-sm font-medium">Trigger</label>
            <select className="w-full mt-1 h-11 px-3 rounded-xl border border-input bg-background text-sm" value={form.triggerType} onChange={e => setForm(f => ({ ...f, triggerType: e.target.value }))}>
              {TRIGGERS.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">Action</label>
            <select className="w-full mt-1 h-11 px-3 rounded-xl border border-input bg-background text-sm" value={form.actionType} onChange={e => setForm(f => ({ ...f, actionType: e.target.value }))}>
              {ACTIONS.map(a => <option key={a} value={a}>{a.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <input type="checkbox" id="aut-active" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} className="w-4 h-4 accent-primary" />
            <label htmlFor="aut-active" className="text-sm font-medium">Active</label>
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button type="submit" className="flex-1" isLoading={createMut.isPending || updateMut.isPending}>Save Automation</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function AutomationsPage() {
  const { data, isLoading } = useListAutomations();
  const [editing, setEditing] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const deleteMut = useDeleteAutomation();
  const toggleMut = useToggleAutomation();

  return (
    <AppLayout>
      <PlanGate feature="automations">
      {(creating || editing) && <AutomationModal automation={editing} onClose={() => { setEditing(null); setCreating(false); }} />}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold">Automations</h1>
          <p className="text-muted-foreground mt-1">Automate your business workflows</p>
        </div>
        <Button onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-2" />New Rule</Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
      ) : data?.automations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4"><Zap className="w-8 h-8 text-primary" /></div>
          <h3 className="text-xl font-semibold mb-2">No automations yet</h3>
          <p className="text-muted-foreground mb-6 text-center max-w-sm">Create automation rules to send reminders, follow-ups, and review requests automatically</p>
          <Button onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-2" />Create First Automation</Button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {data?.automations.map(aut => (
            <Card key={aut.id} className="border-border/50 hover:shadow-md transition-all">
              <div className="p-6">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${aut.isActive ? 'bg-primary/10' : 'bg-accent'}`}>
                      <Zap className={`w-5 h-5 ${aut.isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                    </div>
                    <h3 className="font-semibold">{aut.name}</h3>
                  </div>
                  <button
                    onClick={async () => {
                      await toggleMut.mutateAsync({ id: aut.id });
                      qc.invalidateQueries({ queryKey: getListAutomationsQueryKey() });
                    }}
                    className={`relative w-11 h-6 rounded-full transition-colors ${aut.isActive ? 'bg-primary' : 'bg-gray-200'}`}
                  >
                    <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${aut.isActive ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 mb-4">
                  <span className="px-2 py-1 rounded-lg bg-accent text-xs font-medium">
                    When: {aut.triggerType.replace(/_/g, ' ')}
                  </span>
                  <span className="text-xs text-muted-foreground self-center">→</span>
                  <span className="px-2 py-1 rounded-lg bg-primary/10 text-primary text-xs font-medium">
                    {aut.actionType.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => setEditing(aut)}>Edit</Button>
                  <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10" onClick={async () => {
                    if (!confirm('Delete this automation?')) return;
                    await deleteMut.mutateAsync({ id: aut.id });
                    qc.invalidateQueries({ queryKey: getListAutomationsQueryKey() });
                    toast({ title: 'Automation deleted' });
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
