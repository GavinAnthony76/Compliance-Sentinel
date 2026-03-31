import { useState } from 'react';
import { useListAutomations, useCreateAutomation, useUpdateAutomation, useDeleteAutomation, useToggleAutomation } from '@workspace/api-client-react';
import { AppLayout } from '@/components/layout';
import { PlanGate } from '@/components/plan-gate';
import { Card, Button, Input } from '@/components/ui';
import { Plus, Zap, Info, Play, Clock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { getListAutomationsQueryKey } from '@workspace/api-client-react';

const TRIGGERS: { value: string; label: string; badge?: string }[] = [
  { value: 'appointment_completed',    label: 'Appointment Completed' },
  { value: 'invoice_sent',             label: 'Invoice Sent' },
  { value: 'invoice_overdue',          label: 'Invoice Overdue' },
  { value: 'appointment_upcoming_24h', label: 'Appointment in 24 Hours', badge: 'Scheduled' },
  { value: 'customer_created',         label: 'New Customer Added' },
];

const ACTIONS: { value: string; label: string }[] = [
  { value: 'send_review_request',  label: 'Send Review Request' },
  { value: 'send_follow_up_email', label: 'Send Follow-Up Email' },
  { value: 'send_sms_reminder',    label: 'Send SMS Reminder' },
  { value: 'create_invoice',       label: 'Auto-Create Invoice' },
];

const TRIGGER_LABEL: Record<string, string> = Object.fromEntries(TRIGGERS.map(t => [t.value, t.label]));
const ACTION_LABEL: Record<string, string>  = Object.fromEntries(ACTIONS.map(a => [a.value, a.label]));

function AutomationModal({ automation, onClose }: { automation?: any; onClose: () => void }) {
  const [form, setForm] = useState({
    name: automation?.name ?? '',
    triggerType: automation?.triggerType ?? 'appointment_completed',
    actionType: automation?.actionType ?? 'send_review_request',
    isActive: automation?.isActive ?? true,
  });
  const { toast } = useToast();
  const qc = useQueryClient();
  const createMut = useCreateAutomation();
  const updateMut = useUpdateAutomation();

  const selectedTrigger = TRIGGERS.find(t => t.value === form.triggerType);

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
              {TRIGGERS.map(t => <option key={t.value} value={t.value}>{t.label}{t.badge ? ` (${t.badge})` : ''}</option>)}
            </select>
            {selectedTrigger?.badge === 'Scheduled' && (
              <p className="mt-1 text-xs text-blue-600 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                This trigger fires automatically via the background scheduler — no manual action needed.
              </p>
            )}
          </div>
          <div>
            <label className="text-sm font-medium">Action</label>
            <select className="w-full mt-1 h-11 px-3 rounded-xl border border-input bg-background text-sm" value={form.actionType} onChange={e => setForm(f => ({ ...f, actionType: e.target.value }))}>
              {ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
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

function TestResultModal({ result, onClose }: { result: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
          <Play className="w-5 h-5 text-primary" />Test Run (Dry Run)
        </h2>
        <p className="text-sm text-muted-foreground mb-4">No real messages were sent. Here is what would have happened:</p>
        <div className="bg-accent rounded-xl p-4 text-sm font-medium">{result}</div>
        <Button className="w-full mt-5" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}

const EXAMPLE_AUTOMATIONS = [
  { name: 'Send review after job', triggerType: 'appointment_completed', actionType: 'send_review_request', description: 'Automatically ask customers for a review when you complete a job.' },
  { name: 'Auto-invoice on completion', triggerType: 'appointment_completed', actionType: 'create_invoice', description: 'Create and send an invoice automatically when an appointment is completed.' },
  { name: 'Follow-up after invoice sent', triggerType: 'invoice_sent', actionType: 'send_follow_up_email', description: 'Send a thank-you email when an invoice is delivered to a customer.' },
  { name: '24h appointment reminder', triggerType: 'appointment_upcoming_24h', actionType: 'send_sms_reminder', description: 'Automatically SMS customers the day before their scheduled appointment.' },
  { name: 'Welcome new customer', triggerType: 'customer_created', actionType: 'send_follow_up_email', description: 'Send a welcome email when a new customer is added to the system.' },
];

export function AutomationsPage() {
  const { data, isLoading } = useListAutomations();
  const [editing, setEditing] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const [template, setTemplate] = useState<any>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();
  const deleteMut = useDeleteAutomation();
  const toggleMut = useToggleAutomation();

  const handleTest = async (id: number) => {
    setTestingId(id);
    try {
      const token = localStorage.getItem('greensync_token');
      const res = await fetch(`/api/automations/${id}/test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || 'Test failed');
      setTestResult(d.wouldHave || 'Test completed');
    } catch (err: any) {
      toast({ title: 'Test failed', description: err.message, variant: 'destructive' });
    } finally {
      setTestingId(null);
    }
  };

  const hasScheduler = data?.automations.some(a => a.triggerType === 'appointment_upcoming_24h' && a.isActive);

  return (
    <AppLayout>
      <PlanGate feature="automations">
        {(creating || editing || template) && (
          <AutomationModal automation={editing || template} onClose={() => { setEditing(null); setCreating(false); setTemplate(null); }} />
        )}
        {testResult && <TestResultModal result={testResult} onClose={() => setTestResult(null)} />}

        <div className="flex items-center gap-3 mb-6 p-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-sm">
          <Info className="w-4 h-4 shrink-0 text-blue-500" />
          <span>Automation rules fire and are logged when triggered, but email and SMS delivery runs in <strong>preview mode</strong> — messages are not delivered to real inboxes in this environment.</span>
        </div>

        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold">Automations</h1>
            <p className="text-muted-foreground mt-1">Automate your business workflows</p>
          </div>
          <div className="flex items-center gap-2">
            {hasScheduler && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-100 text-green-700 text-xs font-semibold">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                Scheduler Active
              </span>
            )}
            <Button onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-2" />New Rule</Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
        ) : data?.automations.length === 0 ? (
          <div>
            <div className="flex flex-col items-center justify-center py-10 mb-8">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4"><Zap className="w-8 h-8 text-primary" /></div>
              <h3 className="text-xl font-semibold mb-2">No automations yet</h3>
              <p className="text-muted-foreground mb-6 text-center max-w-sm">Create automation rules to send reminders, follow-ups, and review requests automatically</p>
              <Button onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-2" />Create First Automation</Button>
            </div>
            <div>
              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">Suggested rules to get started</p>
              <div className="grid sm:grid-cols-2 gap-3">
                {EXAMPLE_AUTOMATIONS.map(ex => (
                  <div key={ex.name} className="border border-border/60 rounded-xl p-4 flex items-start justify-between gap-4 hover:border-primary/40 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                        <Zap className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">{ex.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{ex.description}</p>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          <span className="px-1.5 py-0.5 rounded bg-accent text-xs">{TRIGGER_LABEL[ex.triggerType] ?? ex.triggerType}</span>
                          <span className="text-xs text-muted-foreground self-center">→</span>
                          <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-xs">{ACTION_LABEL[ex.actionType] ?? ex.actionType}</span>
                        </div>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" className="shrink-0" onClick={() => setTemplate({ ...ex, isActive: true })}>
                      Use
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {data?.automations.map(aut => {
              const isScheduled = aut.triggerType === 'appointment_upcoming_24h';
              return (
                <Card key={aut.id} className="border-border/50 hover:shadow-md transition-all">
                  <div className="p-6">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${aut.isActive ? 'bg-primary/10' : 'bg-accent'}`}>
                          <Zap className={`w-5 h-5 ${aut.isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                        </div>
                        <div>
                          <h3 className="font-semibold leading-tight">{aut.name}</h3>
                          {isScheduled && aut.isActive && (
                            <span className="inline-flex items-center gap-1 text-xs text-green-600 font-medium mt-0.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />Scheduler running
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          await toggleMut.mutateAsync({ id: aut.id });
                          qc.invalidateQueries({ queryKey: getListAutomationsQueryKey() });
                        }}
                        className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${aut.isActive ? 'bg-primary' : 'bg-gray-200'}`}
                      >
                        <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${aut.isActive ? 'translate-x-5' : 'translate-x-0.5'}`} />
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-2 mb-4">
                      <span className="px-2 py-1 rounded-lg bg-accent text-xs font-medium">
                        When: {TRIGGER_LABEL[aut.triggerType] ?? aut.triggerType.replace(/_/g, ' ')}
                      </span>
                      <span className="text-xs text-muted-foreground self-center">→</span>
                      <span className="px-2 py-1 rounded-lg bg-primary/10 text-primary text-xs font-medium">
                        {ACTION_LABEL[aut.actionType] ?? aut.actionType.replace(/_/g, ' ')}
                      </span>
                    </div>

                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => setEditing(aut)}>Edit</Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-primary border-primary/30 hover:bg-primary/10"
                        onClick={() => handleTest(aut.id)}
                        isLoading={testingId === aut.id}
                        title="Run a dry-run test of this automation"
                      >
                        <Play className="w-3.5 h-3.5 mr-1" />Test
                      </Button>
                      <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10" onClick={async () => {
                        if (!confirm('Delete this automation?')) return;
                        await deleteMut.mutateAsync({ id: aut.id });
                        qc.invalidateQueries({ queryKey: getListAutomationsQueryKey() });
                        toast({ title: 'Automation deleted' });
                      }}>Delete</Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </PlanGate>
    </AppLayout>
  );
}
