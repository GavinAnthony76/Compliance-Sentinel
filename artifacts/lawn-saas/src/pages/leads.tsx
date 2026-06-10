import { useEffect, useState, useCallback } from 'react';
import { useLocation } from 'wouter';
import { AppLayout } from '@/components/layout';
import { PlanGate } from '@/components/plan-gate';
import { Card, Button, Input, Badge } from '@/components/ui';
import { useToast } from '@/hooks/use-toast';
import { useAuthState } from '@/hooks/use-auth-state';
import {
  Plus, X, Phone, Mail, MapPin, DollarSign, UserPlus, FileText,
  Trash2, ChevronLeft, ChevronRight, Pencil, Inbox,
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

interface Lead {
  id: number;
  customerId: number | null;
  propertyId: number | null;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  source: string;
  status: string;
  estimatedValue: string | null;
  assignedUserId: number | null;
  notes: string | null;
  nextFollowUpAt: string | null;
  lostReason: string | null;
  createdAt: string;
  updatedAt: string;
}

const STAGES: { key: string; label: string; accent: string }[] = [
  { key: 'new', label: 'New', accent: 'border-t-sky-400' },
  { key: 'contacted', label: 'Contacted', accent: 'border-t-indigo-400' },
  { key: 'site_visit_scheduled', label: 'Site Visit', accent: 'border-t-amber-400' },
  { key: 'estimate_sent', label: 'Estimate Sent', accent: 'border-t-violet-400' },
  { key: 'won', label: 'Won', accent: 'border-t-emerald-500' },
  { key: 'lost', label: 'Lost', accent: 'border-t-rose-400' },
];

const SOURCE_LABELS: Record<string, string> = {
  public_booking: 'Booking Page',
  manual: 'Manual',
  referral: 'Referral',
  website: 'Website',
  phone: 'Phone',
  other: 'Other',
};

function ordering(status: string) {
  const i = STAGES.findIndex((s) => s.key === status);
  return i === -1 ? 0 : i;
}

function LeadFormModal({ lead, onClose, onSaved }: { lead?: Lead; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!lead?.id;
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    firstName: lead?.firstName ?? '',
    lastName: lead?.lastName ?? '',
    email: lead?.email ?? '',
    phone: lead?.phone ?? '',
    address: lead?.address ?? '',
    source: lead?.source ?? 'manual',
    status: lead?.status ?? 'new',
    estimatedValue: lead?.estimatedValue ?? '',
    notes: lead?.notes ?? '',
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.firstName.trim()) {
      toast({ title: 'First name is required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        source: form.source,
        status: form.status,
        estimatedValue: form.estimatedValue === '' ? null : form.estimatedValue,
        notes: form.notes.trim() || null,
      };
      if (isEdit) {
        await api(`/leads/${lead!.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast({ title: 'Lead updated' });
      } else {
        await api('/leads', { method: 'POST', body: JSON.stringify(payload) });
        toast({ title: 'Lead created' });
      }
      onSaved();
      onClose();
    } catch (err: any) {
      toast({ title: 'Could not save lead', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-lg bg-card rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-card">
          <h2 className="text-lg font-bold">{isEdit ? 'Edit Lead' : 'New Lead'}</h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="w-5 h-5" /></Button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">First name *</label>
              <Input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Last name</label>
              <Input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Email</label>
              <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Phone</label>
              <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Address</label>
            <Input value={form.address} onChange={(e) => set('address', e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Source</label>
              <select className={inputCls} value={form.source} onChange={(e) => set('source', e.target.value)}>
                {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Stage</label>
              <select className={inputCls} value={form.status} onChange={(e) => set('status', e.target.value)}>
                {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Est. value</label>
              <Input type="number" step="0.01" value={form.estimatedValue ?? ''} onChange={(e) => set('estimatedValue', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Notes</label>
            <textarea className={`${inputCls} min-h-[80px]`} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="flex-1" disabled={saving}>{saving ? 'Saving…' : isEdit ? 'Save' : 'Create Lead'}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function LeadCard({ lead, onMove, onEdit, onConvert, onEstimate, onDelete, busy, isManager }: {
  lead: Lead;
  onMove: (lead: Lead, dir: -1 | 1) => void;
  onEdit: (lead: Lead) => void;
  onConvert: (lead: Lead) => void;
  onEstimate: (lead: Lead) => void;
  onDelete: (lead: Lead) => void;
  busy: boolean;
  isManager: boolean;
}) {
  const idx = ordering(lead.status);
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-sm hover:shadow-md transition-shadow space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate">{lead.firstName} {lead.lastName}</p>
          <p className="text-[11px] text-muted-foreground">{SOURCE_LABELS[lead.source] ?? lead.source}</p>
        </div>
        <button onClick={() => onEdit(lead)} className="text-muted-foreground hover:text-foreground shrink-0" title="Edit">
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="space-y-1 text-[11px] text-muted-foreground">
        {lead.phone && <p className="flex items-center gap-1.5 truncate"><Phone className="w-3 h-3 shrink-0" />{lead.phone}</p>}
        {lead.email && <p className="flex items-center gap-1.5 truncate"><Mail className="w-3 h-3 shrink-0" />{lead.email}</p>}
        {lead.address && <p className="flex items-center gap-1.5 truncate"><MapPin className="w-3 h-3 shrink-0" />{lead.address}</p>}
        {lead.estimatedValue && <p className="flex items-center gap-1.5 font-medium text-foreground"><DollarSign className="w-3 h-3 shrink-0" />{Number(lead.estimatedValue).toLocaleString()}</p>}
      </div>
      {lead.customerId && <Badge variant="success" className="text-[10px]">Customer linked</Badge>}
      <div className="flex items-center gap-1 pt-1">
        <button disabled={idx === 0 || busy} onClick={() => onMove(lead, -1)} className="p-1 rounded hover:bg-accent disabled:opacity-30" title="Move back">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button disabled={idx >= STAGES.length - 1 || busy} onClick={() => onMove(lead, 1)} className="p-1 rounded hover:bg-accent disabled:opacity-30" title="Move forward">
          <ChevronRight className="w-4 h-4" />
        </button>
        <div className="flex-1" />
        {isManager && !lead.customerId && (
          <button disabled={busy} onClick={() => onConvert(lead)} className="p-1 rounded hover:bg-accent text-emerald-600 disabled:opacity-30" title="Convert to customer">
            <UserPlus className="w-4 h-4" />
          </button>
        )}
        {isManager && (
          <button disabled={busy} onClick={() => onEstimate(lead)} className="p-1 rounded hover:bg-accent text-violet-600 disabled:opacity-30" title="Create estimate">
            <FileText className="w-4 h-4" />
          </button>
        )}
        {isManager && (
          <button disabled={busy} onClick={() => onDelete(lead)} className="p-1 rounded hover:bg-accent text-rose-600 disabled:opacity-30" title="Delete">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function LeadsBoard() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { user } = useAuthState();
  const role = (user as any)?.role as string | undefined;
  const isManager = role === 'owner' || role === 'admin';
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Lead | undefined>(undefined);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api('/leads');
      setLeads(data.leads ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const move = async (lead: Lead, dir: -1 | 1) => {
    const next = STAGES[ordering(lead.status) + dir];
    if (!next) return;
    setBusyId(lead.id);
    setLeads((ls) => ls.map((l) => (l.id === lead.id ? { ...l, status: next.key } : l)));
    try {
      await api(`/leads/${lead.id}`, { method: 'PUT', body: JSON.stringify({ status: next.key }) });
    } catch (err: any) {
      toast({ title: 'Could not move lead', description: err.message, variant: 'destructive' });
      load();
    } finally {
      setBusyId(null);
    }
  };

  const convert = async (lead: Lead) => {
    setBusyId(lead.id);
    try {
      await api(`/leads/${lead.id}/convert-to-customer`, { method: 'POST' });
      toast({ title: 'Lead converted to customer' });
      load();
    } catch (err: any) {
      toast({ title: 'Could not convert', description: err.message, variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const estimate = async (lead: Lead) => {
    setBusyId(lead.id);
    try {
      const res = await api(`/leads/${lead.id}/create-estimate`, { method: 'POST' });
      toast({ title: 'Draft estimate created' });
      load();
      if (res?.estimate?.id) navigate('/estimates');
    } catch (err: any) {
      toast({ title: 'Could not create estimate', description: err.message, variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (lead: Lead) => {
    if (!confirm(`Delete lead "${lead.firstName} ${lead.lastName}"? This cannot be undone.`)) return;
    setBusyId(lead.id);
    try {
      await api(`/leads/${lead.id}`, { method: 'DELETE' });
      toast({ title: 'Lead deleted' });
      setLeads((ls) => ls.filter((l) => l.id !== lead.id));
    } catch (err: any) {
      toast({ title: 'Could not delete', description: err.message, variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const totalValue = leads
    .filter((l) => l.status !== 'lost')
    .reduce((sum, l) => sum + (l.estimatedValue ? Number(l.estimatedValue) : 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Lead Pipeline</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isManager
              ? <>{leads.length} {leads.length === 1 ? 'lead' : 'leads'} · ${totalValue.toLocaleString()} in open pipeline</>
              : <>{leads.length} {leads.length === 1 ? 'lead' : 'leads'} assigned to you</>}
          </p>
        </div>
        {isManager && (
          <Button onClick={() => { setEditing(undefined); setShowForm(true); }} className="gap-2">
            <Plus className="w-4 h-4" /> New Lead
          </Button>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          {STAGES.map((s) => (
            <div key={s.key} className="space-y-3">
              <div className="h-6 bg-muted rounded animate-pulse" />
              <div className="h-28 bg-muted rounded-xl animate-pulse" />
            </div>
          ))}
        </div>
      ) : error ? (
        <Card className="p-8 text-center">
          <p className="text-sm text-destructive mb-3">{error}</p>
          <Button variant="outline" onClick={load}>Retry</Button>
        </Card>
      ) : leads.length === 0 ? (
        <Card className="p-12 text-center">
          <Inbox className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <h3 className="font-semibold">{isManager ? 'No leads yet' : 'No leads assigned to you'}</h3>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            {isManager
              ? 'Leads from your booking page land here automatically, or add one manually.'
              : 'Leads assigned to you will appear here. Reach out to a manager if you expect to see leads.'}
          </p>
          {isManager && (
            <Button onClick={() => { setEditing(undefined); setShowForm(true); }} className="gap-2">
              <Plus className="w-4 h-4" /> Add your first lead
            </Button>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          {STAGES.map((stage) => {
            const items = leads.filter((l) => l.status === stage.key);
            return (
              <div key={stage.key} className={`bg-muted/40 rounded-xl border-t-4 ${stage.accent} p-2.5 min-h-[120px]`}>
                <div className="flex items-center justify-between px-1 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{stage.label}</span>
                  <span className="text-xs font-bold bg-background rounded-full w-5 h-5 flex items-center justify-center">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map((lead) => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      busy={busyId === lead.id}
                      isManager={isManager}
                      onMove={move}
                      onEdit={(l) => { setEditing(l); setShowForm(true); }}
                      onConvert={convert}
                      onEstimate={estimate}
                      onDelete={remove}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <LeadFormModal
          lead={editing}
          onClose={() => setShowForm(false)}
          onSaved={load}
        />
      )}
    </div>
  );
}

export function LeadsPage() {
  return (
    <AppLayout>
      <PlanGate feature="lead_pipeline">
        <LeadsBoard />
      </PlanGate>
    </AppLayout>
  );
}
