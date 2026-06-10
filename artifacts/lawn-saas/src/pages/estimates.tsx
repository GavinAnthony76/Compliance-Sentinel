import { useState, useEffect } from 'react';
import { useListEstimates, useCreateEstimate, useDeleteEstimate, useUpdateEstimate, useListCustomers, useGetEstimate, useListServices } from '@workspace/api-client-react';
import { AppLayout } from '@/components/layout';
import { Card, Button, Input } from '@/components/ui';
import { LineItemsEditor, type LineItem } from '@/components/line-items-editor';
import { Plus, FileText, PenLine, Send, Sparkles, X } from 'lucide-react';
import { useAuthState } from '@/hooks/use-auth-state';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { getListEstimatesQueryKey } from '@workspace/api-client-react';
import { format } from 'date-fns';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  sent: 'bg-blue-100 text-blue-700',
  accepted: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  expired: 'bg-gray-100 text-gray-500',
};

function EstimateModal({ onClose, estimate }: { onClose: () => void; estimate?: any }) {
  const isEdit = !!estimate?.id;
  const [form, setForm] = useState({ customerId: '', tax: '0', notes: '', validUntil: '' });
  const [useNewRecipient, setUseNewRecipient] = useState(false);
  const [recipient, setRecipient] = useState({ name: '', email: '', phone: '' });
  const [lineItems, setLineItems] = useState<LineItem[]>([{ description: '', quantity: 1, unitPrice: 0, lineTotal: 0 }]);
  const [initialized, setInitialized] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [aiForm, setAiForm] = useState({ jobDescription: '', propertySize: '' });
  const [aiLoading, setAiLoading] = useState(false);
  const { user } = useAuthState();
  const isPro = user?.company?.subscriptionPlan === 'pro';
  const { toast } = useToast();
  const qc = useQueryClient();
  const createMut = useCreateEstimate();
  const updateMut = useUpdateEstimate();
  const { data: customers } = useListCustomers({ page: 1, limit: 100 } as any);
  const { data: services } = useListServices({ limit: 200 } as any);
  const { data: detail } = useGetEstimate(estimate?.id ?? 0, { query: { enabled: isEdit } } as any);

  useEffect(() => {
    if (isEdit && detail && !initialized) {
      setForm({
        customerId: String(detail.customerId),
        tax: String(detail.tax ?? 0),
        notes: (detail as any).notes ?? '',
        validUntil: (detail as any).validUntil ? new Date((detail as any).validUntil).toISOString().slice(0, 10) : '',
      });
      setLineItems((detail as any).lineItems?.length > 0
        ? (detail as any).lineItems.map((li: any) => ({
            description: li.description,
            quantity: Number(li.quantity),
            unitPrice: Number(li.unitPrice),
            lineTotal: Number((Number(li.quantity) * Number(li.unitPrice)).toFixed(2)),
          }))
        : [{ description: '', quantity: 1, unitPrice: 0, lineTotal: 0 }]);
      setInitialized(true);
    }
  }, [detail, isEdit, initialized]);

  const subtotal = lineItems.reduce((s, li) => s + li.lineTotal, 0);
  const total = subtotal + Number(form.tax);

  const addServiceLine = (serviceId: string) => {
    const svc = (services as any)?.services?.find((s: any) => String(s.id) === serviceId);
    if (!svc) return;
    const price = Number(svc.basePrice ?? 0);
    const row: LineItem = { description: svc.name, quantity: 1, unitPrice: price, lineTotal: price };
    setLineItems(prev => {
      const onlyEmpty = prev.length === 1 && !prev[0].description && prev[0].unitPrice === 0;
      return onlyEmpty ? [row] : [...prev, row];
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = lineItems.filter(li => li.description.trim());
    if (cleaned.length === 0) {
      toast({ title: 'Add at least one line item', variant: 'destructive' });
      return;
    }
    const invalid = cleaned.some(li => !Number.isFinite(li.quantity) || li.quantity <= 0 || !Number.isFinite(li.unitPrice) || li.unitPrice < 0);
    if (invalid) {
      toast({ title: 'Check line item quantities and prices', description: 'Quantity must be greater than 0 and price cannot be negative.', variant: 'destructive' });
      return;
    }
    const lineItemsPayload = cleaned.map(li => ({
      description: li.description,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      total: li.lineTotal,
    }));
    try {
      if (isEdit) {
        await updateMut.mutateAsync({
          id: estimate.id,
          data: {
            subtotal: total - Number(form.tax),
            tax: Number(form.tax),
            total,
            notes: form.notes || undefined,
            validUntil: form.validUntil ? new Date(form.validUntil).toISOString() : undefined,
            lineItems: lineItemsPayload,
          } as any,
        });
        toast({ title: 'Estimate updated' });
      } else {
        if (useNewRecipient) {
          if (!recipient.name.trim() || !recipient.email.trim()) {
            toast({ title: 'Enter a name and email for the new recipient', variant: 'destructive' });
            return;
          }
        } else if (!form.customerId) {
          toast({ title: 'Select a customer', variant: 'destructive' });
          return;
        }
        await createMut.mutateAsync({
          data: {
            ...(useNewRecipient
              ? { recipient: { name: recipient.name.trim(), email: recipient.email.trim(), phone: recipient.phone.trim() || undefined } }
              : { customerId: Number(form.customerId) }),
            subtotal: total - Number(form.tax),
            tax: Number(form.tax),
            total,
            notes: form.notes || undefined,
            validUntil: form.validUntil ? new Date(form.validUntil).toISOString() : undefined,
            lineItems: lineItemsPayload,
          } as any,
        });
        toast({ title: useNewRecipient ? 'Estimate created & lead captured' : 'Estimate created' });
      }
      qc.invalidateQueries({ queryKey: getListEstimatesQueryKey() });
      onClose();
    } catch {
      toast({ title: isEdit ? 'Error updating estimate' : 'Error creating estimate', variant: 'destructive' });
    }
  };

  const handleAiDraft = async () => {
    if (aiForm.jobDescription.trim().length < 3) { toast({ title: 'Describe the job first', variant: 'destructive' }); return; }
    setAiLoading(true);
    try {
      const res = await fetch('/api/estimates/ai-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('greensync_token')}` },
        body: JSON.stringify({ jobDescription: aiForm.jobDescription.trim(), propertySize: aiForm.propertySize.trim() || null }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || d.error || 'Failed to draft');
      const items: LineItem[] = (d.lineItems ?? []).map((li: any) => ({
        description: li.description,
        quantity: Number(li.quantity),
        unitPrice: Number(li.unitPrice),
        lineTotal: Number((Number(li.quantity) * Number(li.unitPrice)).toFixed(2)),
      }));
      if (items.length === 0) { toast({ title: 'No items generated', description: 'Try adding more detail.', variant: 'destructive' }); return; }
      setLineItems(items);
      setShowAi(false);
      toast({ title: 'Draft generated', description: `${items.length} line item${items.length === 1 ? '' : 's'} added${d.source === 'mock' ? ' (sample estimate)' : ''}. Review before sending.` });
    } catch (err: any) {
      toast({ title: 'AI draft failed', description: err.message, variant: 'destructive' });
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-xl p-6 my-4">
        <h2 className="text-xl font-bold mb-6">{isEdit ? 'Edit Estimate' : 'New Estimate'}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {!isEdit && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium">{useNewRecipient ? 'New Recipient *' : 'Customer *'}</label>
                <button
                  type="button"
                  onClick={() => setUseNewRecipient(v => !v)}
                  className="text-xs text-primary hover:underline font-medium"
                >
                  {useNewRecipient ? 'Pick an existing customer' : 'Send to someone new'}
                </button>
              </div>
              {useNewRecipient ? (
                <div className="space-y-2">
                  <Input
                    placeholder="Full name *"
                    value={recipient.name}
                    onChange={e => setRecipient(r => ({ ...r, name: e.target.value }))}
                    required
                  />
                  <Input
                    type="email"
                    placeholder="Email *"
                    value={recipient.email}
                    onChange={e => setRecipient(r => ({ ...r, email: e.target.value }))}
                    required
                  />
                  <Input
                    placeholder="Phone (optional)"
                    value={recipient.phone}
                    onChange={e => setRecipient(r => ({ ...r, phone: e.target.value }))}
                  />
                  <p className="text-[11px] text-muted-foreground">They'll be saved as a lead so you can follow up — no account needed to receive the estimate.</p>
                </div>
              ) : (
                <select className="w-full h-11 px-3 rounded-xl border border-input bg-background text-sm" value={form.customerId} onChange={e => setForm(f => ({ ...f, customerId: e.target.value }))} required>
                  <option value="">Select customer...</option>
                  {customers?.customers.map(c => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
                </select>
              )}
            </div>
          )}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">Line Items</label>
              {isPro && (
                <button type="button" onClick={() => setShowAi(s => !s)} className="text-xs text-violet-600 hover:underline inline-flex items-center gap-1 font-medium">
                  <Sparkles className="w-3.5 h-3.5" /> AI Draft
                </button>
              )}
            </div>
            <div className="mb-3">
              <select
                className="w-full h-11 px-3 rounded-xl border border-input bg-background text-sm"
                value=""
                onChange={e => { if (e.target.value) { addServiceLine(e.target.value); e.target.value = ''; } }}
              >
                <option value="">+ Add the service the customer requested...</option>
                {(services as any)?.services?.map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.basePrice != null ? ` — $${Number(s.basePrice).toFixed(2)}` : ''}
                  </option>
                ))}
              </select>
            </div>
            {isPro && showAi && (
              <div className="mb-3 rounded-xl border border-violet-200 bg-violet-50/60 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-violet-700 inline-flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" /> AI Estimate Draft</p>
                  <button type="button" onClick={() => setShowAi(false)} className="text-violet-400 hover:text-violet-600"><X className="w-4 h-4" /></button>
                </div>
                <textarea
                  className="w-full min-h-[64px] rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm"
                  placeholder="Describe the job, e.g. 'Weekly mowing, edging and leaf cleanup for a medium suburban lawn with flower beds.'"
                  value={aiForm.jobDescription}
                  onChange={e => setAiForm(a => ({ ...a, jobDescription: e.target.value }))}
                />
                <Input
                  placeholder="Property size (optional), e.g. 0.25 acre"
                  value={aiForm.propertySize}
                  onChange={e => setAiForm(a => ({ ...a, propertySize: e.target.value }))}
                />
                <div className="flex justify-end">
                  <Button type="button" size="sm" onClick={handleAiDraft} isLoading={aiLoading} className="gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" /> Generate Line Items
                  </Button>
                </div>
                <p className="text-[11px] text-violet-500">AI-generated estimates are a starting point — review prices before sending.</p>
              </div>
            )}
            <div className="border border-border rounded-xl p-3">
              <LineItemsEditor items={lineItems} onChange={setLineItems} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Tax ($)</label>
              <Input type="number" step="0.01" className="mt-1" value={form.tax} onChange={e => setForm(f => ({ ...f, tax: e.target.value }))} placeholder="0.00" />
            </div>
            <div>
              <label className="text-sm font-medium">Valid Until</label>
              <Input type="date" className="mt-1" value={form.validUntil} onChange={e => setForm(f => ({ ...f, validUntil: e.target.value }))} />
            </div>
          </div>
          <div className="bg-accent/50 rounded-xl p-4 space-y-1">
            <div className="flex justify-between text-sm text-muted-foreground"><span>Subtotal</span><span>${subtotal.toFixed(2)}</span></div>
            <div className="flex justify-between text-sm text-muted-foreground"><span>Tax</span><span>${Number(form.tax || 0).toFixed(2)}</span></div>
            <div className="flex justify-between text-sm pt-1 border-t border-border"><span className="font-medium">Total</span><span className="font-bold">${total.toFixed(2)}</span></div>
          </div>
          <div>
            <label className="text-sm font-medium">Notes</label>
            <Input className="mt-1" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional terms or notes..." />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button type="submit" className="flex-1" isLoading={createMut.isPending || updateMut.isPending}>{isEdit ? 'Save Changes' : 'Create Estimate'}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function EstimatesPage() {
  const { data, isLoading } = useListEstimates({ page: 1, limit: 50 } as any);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const { toast } = useToast();
  const qc = useQueryClient();
  const deleteMut = useDeleteEstimate();
  const updateMut = useUpdateEstimate();
  const [sendingSignId, setSendingSignId] = useState<number | null>(null);

  const handleSendForSignature = async (estId: number) => {
    setSendingSignId(estId);
    try {
      const res = await fetch(`/api/estimates/${estId}/send-for-signature`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('greensync_token')}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to send');
      qc.invalidateQueries({ queryKey: getListEstimatesQueryKey() });
      toast({ title: 'Sent for signature!', description: 'Customer will receive email + SMS with signing link.' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSendingSignId(null);
    }
  };

  return (
    <AppLayout>
      {showNew && <EstimateModal onClose={() => setShowNew(false)} />}
      {editing && <EstimateModal estimate={editing} onClose={() => setEditing(null)} />}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold">Estimates</h1>
          <p className="text-muted-foreground mt-1">Create and send quotes to customers</p>
        </div>
        <Button onClick={() => setShowNew(true)}><Plus className="w-4 h-4 mr-2" />New Estimate</Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
      ) : (
        <Card className="border-border/50 overflow-hidden">
          {data?.estimates.length === 0 ? (
            <div className="p-12 text-center">
              <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No estimates yet</h3>
              <Button onClick={() => setShowNew(true)} className="mt-4"><Plus className="w-4 h-4 mr-2" />Create First Estimate</Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-accent/30">
                    <th className="text-left p-4 text-sm font-semibold text-muted-foreground">Estimate #</th>
                    <th className="text-left p-4 text-sm font-semibold text-muted-foreground">Customer</th>
                    <th className="text-left p-4 text-sm font-semibold text-muted-foreground">Total</th>
                    <th className="text-left p-4 text-sm font-semibold text-muted-foreground">Status</th>
                    <th className="text-left p-4 text-sm font-semibold text-muted-foreground">Valid Until</th>
                    <th className="text-right p-4 text-sm font-semibold text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data?.estimates.map(est => (
                    <tr key={est.id} className="hover:bg-accent/30">
                      <td className="p-4 font-mono text-sm font-medium">{est.estimateNumber}</td>
                      <td className="p-4 text-sm">{est.customerName || '—'}</td>
                      <td className="p-4 text-sm font-semibold">${Number(est.total).toFixed(2)}</td>
                      <td className="p-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[est.status] || 'bg-gray-100 text-gray-600'}`}>{est.status}</span>
                      </td>
                      <td className="p-4 text-sm text-muted-foreground">{est.validUntil ? format(new Date(est.validUntil), 'MMM d, yyyy') : '—'}</td>
                      <td className="p-4">
                        <div className="flex items-center gap-2 justify-end flex-wrap">
                          {(est.status === 'draft' || est.status === 'sent') && (
                            <Button size="sm" variant="outline" onClick={() => setEditing(est)}>Edit</Button>
                          )}
                          {(est.status === 'draft' || est.status === 'sent') && !est.signedAt && (
                            <Button size="sm" variant="outline" onClick={() => handleSendForSignature(est.id)} isLoading={sendingSignId === est.id}>
                              <PenLine className="w-3.5 h-3.5 mr-1" />Send for Signature
                            </Button>
                          )}
                          {est.status === 'draft' && (
                            <Button size="sm" variant="outline" onClick={async () => {
                              await updateMut.mutateAsync({ id: est.id, data: { status: 'sent' } });
                              qc.invalidateQueries({ queryKey: getListEstimatesQueryKey() });
                              toast({ title: 'Marked as sent' });
                            }}><Send className="w-3.5 h-3.5 mr-1" />Mark as Sent</Button>
                          )}
                          <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={async () => {
                            if (!confirm('Delete estimate?')) return;
                            await deleteMut.mutateAsync({ id: est.id });
                            qc.invalidateQueries({ queryKey: getListEstimatesQueryKey() });
                            toast({ title: 'Estimate deleted' });
                          }}>Delete</Button>
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
