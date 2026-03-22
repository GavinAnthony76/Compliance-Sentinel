import { useState } from 'react';
import { useListEstimates, useCreateEstimate, useDeleteEstimate, useUpdateEstimate, useListCustomers } from '@workspace/api-client-react';
import { AppLayout } from '@/components/layout';
import { PlanGate } from '@/components/plan-gate';
import { Card, Button, Input } from '@/components/ui';
import { Plus, FileText } from 'lucide-react';
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

function EstimateModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ customerId: '', subtotal: '', tax: '0', notes: '', validUntil: '', lineItems: [{ description: '', quantity: '1', unitPrice: '' }] });
  const { toast } = useToast();
  const qc = useQueryClient();
  const createMut = useCreateEstimate();
  const { data: customers } = useListCustomers({ page: 1, limit: 100 } as any);

  const total = form.lineItems.reduce((s, li) => s + Number(li.quantity) * Number(li.unitPrice || 0), 0) + Number(form.tax);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createMut.mutateAsync({
        data: {
          customerId: Number(form.customerId),
          subtotal: total - Number(form.tax),
          tax: Number(form.tax),
          total,
          notes: form.notes || undefined,
          validUntil: form.validUntil ? new Date(form.validUntil).toISOString() : undefined,
          lineItems: form.lineItems.filter(li => li.description && li.unitPrice).map(li => ({
            description: li.description,
            quantity: Number(li.quantity),
            unitPrice: Number(li.unitPrice),
            total: Number(li.quantity) * Number(li.unitPrice),
          })),
        },
      });
      toast({ title: 'Estimate created' });
      qc.invalidateQueries({ queryKey: getListEstimatesQueryKey() });
      onClose();
    } catch {
      toast({ title: 'Error creating estimate', variant: 'destructive' });
    }
  };

  const addLineItem = () => setForm(f => ({ ...f, lineItems: [...f.lineItems, { description: '', quantity: '1', unitPrice: '' }] }));

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-xl p-6 my-4">
        <h2 className="text-xl font-bold mb-6">New Estimate</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Customer *</label>
            <select className="w-full mt-1 h-11 px-3 rounded-xl border border-input bg-background text-sm" value={form.customerId} onChange={e => setForm(f => ({ ...f, customerId: e.target.value }))} required>
              <option value="">Select customer...</option>
              {customers?.customers.map(c => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
            </select>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">Line Items</label>
              <button type="button" onClick={addLineItem} className="text-xs text-primary hover:underline">+ Add Item</button>
            </div>
            <div className="space-y-2">
              {form.lineItems.map((li, i) => (
                <div key={i} className="grid grid-cols-12 gap-2">
                  <Input className="col-span-6" placeholder="Description" value={li.description} onChange={e => setForm(f => ({ ...f, lineItems: f.lineItems.map((l, j) => j === i ? { ...l, description: e.target.value } : l) }))} />
                  <Input className="col-span-2" type="number" placeholder="Qty" value={li.quantity} onChange={e => setForm(f => ({ ...f, lineItems: f.lineItems.map((l, j) => j === i ? { ...l, quantity: e.target.value } : l) }))} />
                  <Input className="col-span-3" type="number" step="0.01" placeholder="Price" value={li.unitPrice} onChange={e => setForm(f => ({ ...f, lineItems: f.lineItems.map((l, j) => j === i ? { ...l, unitPrice: e.target.value } : l) }))} />
                  {form.lineItems.length > 1 && <button type="button" onClick={() => setForm(f => ({ ...f, lineItems: f.lineItems.filter((_, j) => j !== i) }))} className="col-span-1 text-destructive text-lg">×</button>}
                </div>
              ))}
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
          <div className="bg-accent/50 rounded-xl p-4">
            <div className="flex justify-between text-sm"><span>Total</span><span className="font-bold">${total.toFixed(2)}</span></div>
          </div>
          <div>
            <label className="text-sm font-medium">Notes</label>
            <Input className="mt-1" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional terms or notes..." />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button type="submit" className="flex-1" isLoading={createMut.isPending}>Create Estimate</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function EstimatesPage() {
  const { data, isLoading } = useListEstimates({ page: 1, limit: 50 } as any);
  const [showNew, setShowNew] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const deleteMut = useDeleteEstimate();
  const updateMut = useUpdateEstimate();

  return (
    <AppLayout>
      <PlanGate feature="estimates">
      {showNew && <EstimateModal onClose={() => setShowNew(false)} />}
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
                        <div className="flex items-center gap-2 justify-end">
                          {est.status === 'draft' && (
                            <Button size="sm" variant="outline" onClick={async () => {
                              await updateMut.mutateAsync({ id: est.id, data: { status: 'sent' } });
                              qc.invalidateQueries({ queryKey: getListEstimatesQueryKey() });
                              toast({ title: 'Estimate sent' });
                            }}>Send</Button>
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
      </PlanGate>
    </AppLayout>
  );
}
