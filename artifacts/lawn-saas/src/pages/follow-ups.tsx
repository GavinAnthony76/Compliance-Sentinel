import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout';
import { PlanGate } from '@/components/plan-gate';
import { Card, Button, Input, Badge } from '@/components/ui';
import { useToast } from '@/hooks/use-toast';
import {
  Plus, X, Mail, MessageSquare, Trash2, Power, Send, ScrollText, Megaphone, Clock,
} from 'lucide-react';

const TOKEN = () => localStorage.getItem('greensync_token');

async function api(path: string, opts: RequestInit = {}) {
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN()}`,
      ...(opts.headers ?? {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(body?.message || body?.error || 'Request failed');
  return body;
}

interface Campaign {
  id: number;
  name: string;
  triggerType: string;
  delayHours: number;
  channel: string;
  subject: string | null;
  messageTemplate: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface FollowUpLog {
  id: number;
  campaignId: number;
  entityType: string;
  entityId: number;
  customerId: number | null;
  leadId: number | null;
  channel: string;
  status: string;
  errorMessage: string | null;
  sentAt: string | null;
  createdAt: string;
}

const TRIGGERS: { key: string; label: string; desc: string }[] = [
  { key: 'lead_created', label: 'New Lead Created', desc: 'When a lead enters your pipeline' },
  { key: 'estimate_sent', label: 'Estimate Sent', desc: 'After an estimate is sent to a customer' },
  { key: 'appointment_completed', label: 'Job Completed', desc: 'After an appointment is marked complete' },
  { key: 'invoice_sent', label: 'Invoice Sent', desc: 'After an invoice is sent' },
];

const TRIGGER_LABEL = (k: string) => TRIGGERS.find((t) => t.key === k)?.label ?? k;

function formatDelay(hours: number) {
  if (hours === 0) return 'Immediately';
  if (hours < 24) return `${hours}h after`;
  const days = Math.round((hours / 24) * 10) / 10;
  return `${days % 1 === 0 ? days : days.toFixed(1)} day${days === 1 ? '' : 's'} after`;
}

const emptyForm = {
  name: '',
  triggerType: 'lead_created',
  delayHours: 0,
  channel: 'email',
  subject: '',
  messageTemplate: '',
  isActive: false,
};

function FollowUpsContent() {
  const { toast } = useToast();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  const [logsFor, setLogsFor] = useState<Campaign | null>(null);
  const [logs, setLogs] = useState<FollowUpLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const [testFor, setTestFor] = useState<Campaign | null>(null);
  const [testForm, setTestForm] = useState({ email: '', phone: '', firstName: '' });
  const [testing, setTesting] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api('/follow-ups');
      setCampaigns(data.campaigns ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setEditing(null);
    setForm({ ...emptyForm });
    setShowForm(true);
  }

  function openEdit(c: Campaign) {
    setEditing(c);
    setForm({
      name: c.name,
      triggerType: c.triggerType,
      delayHours: c.delayHours,
      channel: c.channel,
      subject: c.subject ?? '',
      messageTemplate: c.messageTemplate,
      isActive: c.isActive,
    });
    setShowForm(true);
  }

  async function save() {
    if (!form.name.trim()) { toast({ title: 'Name is required', variant: 'destructive' }); return; }
    if (!form.messageTemplate.trim()) { toast({ title: 'Message template is required', variant: 'destructive' }); return; }
    if (form.channel === 'email' && !form.subject.trim()) { toast({ title: 'Email campaigns require a subject', variant: 'destructive' }); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        triggerType: form.triggerType,
        delayHours: Number(form.delayHours) || 0,
        channel: form.channel,
        subject: form.channel === 'email' ? form.subject.trim() : null,
        messageTemplate: form.messageTemplate.trim(),
        isActive: form.isActive,
      };
      if (editing) {
        await api(`/follow-ups/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast({ title: 'Campaign updated' });
      } else {
        await api('/follow-ups', { method: 'POST', body: JSON.stringify(payload) });
        toast({ title: 'Campaign created' });
      }
      setShowForm(false);
      load();
    } catch (e: any) {
      toast({ title: 'Save failed', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function toggle(c: Campaign) {
    try {
      await api(`/follow-ups/${c.id}/toggle`, { method: 'POST' });
      load();
    } catch (e: any) {
      toast({ title: 'Failed to toggle', description: e.message, variant: 'destructive' });
    }
  }

  async function remove(c: Campaign) {
    if (!confirm(`Delete campaign "${c.name}"? This cannot be undone.`)) return;
    try {
      await api(`/follow-ups/${c.id}`, { method: 'DELETE' });
      toast({ title: 'Campaign deleted' });
      load();
    } catch (e: any) {
      toast({ title: 'Delete failed', description: e.message, variant: 'destructive' });
    }
  }

  async function openLogs(c: Campaign) {
    setLogsFor(c);
    setLogsLoading(true);
    setLogs([]);
    try {
      const data = await api(`/follow-ups/${c.id}/logs`);
      setLogs(data.logs ?? []);
    } catch (e: any) {
      toast({ title: 'Failed to load logs', description: e.message, variant: 'destructive' });
    } finally {
      setLogsLoading(false);
    }
  }

  function openTest(c: Campaign) {
    setTestFor(c);
    setTestForm({ email: '', phone: '', firstName: '' });
  }

  async function sendTest() {
    if (!testFor) return;
    if (testFor.channel === 'email' && !testForm.email.trim()) { toast({ title: 'Enter a test email', variant: 'destructive' }); return; }
    if (testFor.channel === 'sms' && !testForm.phone.trim()) { toast({ title: 'Enter a test phone number', variant: 'destructive' }); return; }
    setTesting(true);
    try {
      await api(`/follow-ups/${testFor.id}/test`, {
        method: 'POST',
        body: JSON.stringify({
          email: testForm.email.trim() || null,
          phone: testForm.phone.trim() || null,
          firstName: testForm.firstName.trim() || null,
        }),
      });
      toast({ title: 'Test sent', description: `Sent a test ${testFor.channel} message.` });
      setTestFor(null);
    } catch (e: any) {
      toast({ title: 'Test failed', description: e.message, variant: 'destructive' });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground flex items-center gap-2">
            <Megaphone className="w-7 h-7 text-primary" />
            Follow-Up Campaigns
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">Automatically nurture leads and customers with timed email & SMS messages.</p>
        </div>
        <Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" /> New Campaign</Button>
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => <Card key={i} className="h-40 animate-pulse bg-muted/40" />)}
        </div>
      ) : error ? (
        <Card className="p-8 text-center">
          <p className="text-destructive font-medium">{error}</p>
          <Button variant="outline" className="mt-4" onClick={load}>Retry</Button>
        </Card>
      ) : campaigns.length === 0 ? (
        <Card className="p-12 text-center">
          <Megaphone className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
          <h3 className="font-semibold text-lg text-foreground">No campaigns yet</h3>
          <p className="text-muted-foreground text-sm mt-1 max-w-md mx-auto">Create your first follow-up campaign to automatically reach out after key events like new leads or completed jobs.</p>
          <Button onClick={openCreate} className="mt-5 gap-2"><Plus className="w-4 h-4" /> New Campaign</Button>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {campaigns.map((c) => (
            <Card key={c.id} className="p-5 flex flex-col">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-foreground truncate">{c.name}</h3>
                    <Badge variant={c.isActive ? 'success' : 'secondary'}>{c.isActive ? 'Active' : 'Paused'}</Badge>
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                    <span className="inline-flex items-center gap-1">
                      {c.channel === 'email' ? <Mail className="w-3.5 h-3.5" /> : <MessageSquare className="w-3.5 h-3.5" />}
                      {c.channel === 'email' ? 'Email' : 'SMS'}
                    </span>
                    <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {formatDelay(c.delayHours)}</span>
                  </div>
                </div>
                <button
                  onClick={() => toggle(c)}
                  title={c.isActive ? 'Pause' : 'Activate'}
                  className={`shrink-0 p-2 rounded-lg transition-colors ${c.isActive ? 'text-emerald-600 hover:bg-emerald-50' : 'text-muted-foreground hover:bg-accent'}`}
                >
                  <Power className="w-4 h-4" />
                </button>
              </div>

              <div className="mt-3 text-xs">
                <Badge variant="outline" className="font-normal">Trigger: {TRIGGER_LABEL(c.triggerType)}</Badge>
              </div>
              {c.subject && <p className="mt-3 text-sm font-medium text-foreground truncate">{c.subject}</p>}
              <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{c.messageTemplate}</p>

              <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border">
                <Button variant="outline" size="sm" onClick={() => openEdit(c)}>Edit</Button>
                <Button variant="outline" size="sm" className="gap-1" onClick={() => openTest(c)}><Send className="w-3.5 h-3.5" /> Test</Button>
                <Button variant="outline" size="sm" className="gap-1" onClick={() => openLogs(c)}><ScrollText className="w-3.5 h-3.5" /> Logs</Button>
                <button onClick={() => remove(c)} className="ml-auto p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" title="Delete">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => !saving && setShowForm(false)}>
          <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold text-foreground">{editing ? 'Edit Campaign' : 'New Campaign'}</h2>
              <button onClick={() => setShowForm(false)} className="p-1 rounded-lg hover:bg-accent"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Campaign Name</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. New lead welcome" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Trigger</label>
                <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.triggerType} onChange={(e) => setForm({ ...form, triggerType: e.target.value })}>
                  {TRIGGERS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
                <p className="text-xs text-muted-foreground mt-1">{TRIGGERS.find((t) => t.key === form.triggerType)?.desc}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Channel</label>
                  <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
                    <option value="email">Email</option>
                    <option value="sms">SMS</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Delay (hours)</label>
                  <Input type="number" min={0} value={form.delayHours} onChange={(e) => setForm({ ...form, delayHours: Number(e.target.value) })} />
                </div>
              </div>
              {form.channel === 'email' && (
                <div>
                  <label className="block text-sm font-medium mb-1">Subject</label>
                  <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Email subject line" />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium mb-1">Message</label>
                <textarea
                  className="w-full min-h-[120px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.messageTemplate}
                  onChange={(e) => setForm({ ...form, messageTemplate: e.target.value })}
                  placeholder="Hi {{firstName}}, thanks for reaching out..."
                />
                <p className="text-xs text-muted-foreground mt-1">Use {'{{firstName}}'} to personalize the message.</p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} className="rounded border-input" />
                Activate immediately
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="outline" onClick={() => setShowForm(false)} disabled={saving}>Cancel</Button>
              <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Campaign'}</Button>
            </div>
          </Card>
        </div>
      )}

      {/* Test modal */}
      {testFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => !testing && setTestFor(null)}>
          <Card className="w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-foreground">Send Test — {testFor.name}</h2>
              <button onClick={() => setTestFor(null)} className="p-1 rounded-lg hover:bg-accent"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              {testFor.channel === 'email' ? (
                <div>
                  <label className="block text-sm font-medium mb-1">Test Email</label>
                  <Input type="email" value={testForm.email} onChange={(e) => setTestForm({ ...testForm, email: e.target.value })} placeholder="you@example.com" />
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium mb-1">Test Phone</label>
                  <Input value={testForm.phone} onChange={(e) => setTestForm({ ...testForm, phone: e.target.value })} placeholder="+1 555 123 4567" />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium mb-1">First Name (optional)</label>
                <Input value={testForm.firstName} onChange={(e) => setTestForm({ ...testForm, firstName: e.target.value })} placeholder="For {{firstName}} personalization" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="outline" onClick={() => setTestFor(null)} disabled={testing}>Cancel</Button>
              <Button onClick={sendTest} disabled={testing} className="gap-2"><Send className="w-4 h-4" /> {testing ? 'Sending…' : 'Send Test'}</Button>
            </div>
          </Card>
        </div>
      )}

      {/* Logs modal */}
      {logsFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setLogsFor(null)}>
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-foreground">Send Logs — {logsFor.name}</h2>
              <button onClick={() => setLogsFor(null)} className="p-1 rounded-lg hover:bg-accent"><X className="w-5 h-5" /></button>
            </div>
            {logsLoading ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
            ) : logs.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No sends yet for this campaign.</p>
            ) : (
              <div className="divide-y divide-border">
                {logs.map((l) => (
                  <div key={l.id} className="py-3 flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate capitalize">
                        {l.leadId ? `Lead #${l.leadId}` : l.customerId ? `Customer #${l.customerId}` : `${l.entityType} #${l.entityId}`}
                      </p>
                      <p className="text-xs text-muted-foreground">{new Date(l.sentAt ?? l.createdAt).toLocaleString()} · {l.channel}</p>
                      {l.errorMessage && <p className="text-xs text-destructive mt-0.5">{l.errorMessage}</p>}
                    </div>
                    <Badge variant={l.status === 'sent' ? 'success' : l.status === 'failed' ? 'danger' : 'secondary'}>{l.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

export function FollowUpsPage() {
  return (
    <AppLayout>
      <PlanGate feature="follow_up_campaigns">
        <FollowUpsContent />
      </PlanGate>
    </AppLayout>
  );
}
