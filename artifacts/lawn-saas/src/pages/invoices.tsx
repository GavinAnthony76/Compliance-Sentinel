import { useState } from 'react';
import { useListInvoices, useCreateInvoice, useMarkInvoicePaid, useSendInvoice, useDeleteInvoice, useListCustomers } from '@workspace/api-client-react';
import { AppLayout } from '@/components/layout';
import { Card, Button, Input } from '@/components/ui';
import { Plus, FileText, DollarSign, Download, Bell } from 'lucide-react';
import { useAuthState } from '@/hooks/use-auth-state';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

function downloadExport(path: string, filename: string) {
  fetch(path, { headers: { Authorization: `Bearer ${localStorage.getItem('greensync_token')}` } })
    .then(r => {
      if (!r.ok) throw new Error(`Export failed: ${r.status}`);
      return r.blob();
    })
    .then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    })
    .catch(err => console.error('Export error:', err));
}
import { getListInvoicesQueryKey } from '@workspace/api-client-react';
import { format } from 'date-fns';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  sent: 'bg-blue-100 text-blue-700',
  paid: 'bg-green-100 text-green-700',
  overdue: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

function NewInvoiceModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ customerId: '', subtotal: '', tax: '0', total: '', notes: '', dueDate: '' });
  const { toast } = useToast();
  const qc = useQueryClient();
  const createMut = useCreateInvoice();
  const { data: customers } = useListCustomers({ page: 1, limit: 100 } as any);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createMut.mutateAsync({
        data: {
          customerId: Number(form.customerId),
          subtotal: Number(form.subtotal),
          tax: Number(form.tax),
          total: Number(form.subtotal) + Number(form.tax),
          notes: form.notes || undefined,
          dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
        },
      });
      toast({ title: 'Invoice created' });
      qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
      onClose();
    } catch {
      toast({ title: 'Error creating invoice', variant: 'destructive' });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-lg p-6">
        <h2 className="text-xl font-bold mb-6">New Invoice</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Customer *</label>
            <select className="w-full mt-1 h-11 px-3 rounded-xl border border-input bg-background text-sm" value={form.customerId} onChange={e => setForm(f => ({ ...f, customerId: e.target.value }))} required>
              <option value="">Select customer...</option>
              {customers?.customers.map(c => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Subtotal ($) *</label>
              <Input type="number" step="0.01" className="mt-1" value={form.subtotal} onChange={e => setForm(f => ({ ...f, subtotal: e.target.value }))} placeholder="0.00" required />
            </div>
            <div>
              <label className="text-sm font-medium">Tax ($)</label>
              <Input type="number" step="0.01" className="mt-1" value={form.tax} onChange={e => setForm(f => ({ ...f, tax: e.target.value }))} placeholder="0.00" />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Due Date</label>
            <Input type="date" className="mt-1" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
          </div>
          <div>
            <label className="text-sm font-medium">Notes</label>
            <Input className="mt-1" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes..." />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button type="submit" className="flex-1" isLoading={createMut.isPending}>Create Invoice</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function InvoicesPage() {
  const [showNew, setShowNew] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const { data, isLoading } = useListInvoices({ status: statusFilter || undefined, page: 1, limit: 50 } as any);
  const { toast } = useToast();
  const qc = useQueryClient();
  const markPaidMut = useMarkInvoicePaid();
  const sendMut = useSendInvoice();
  const deleteMut = useDeleteInvoice();
  const { user } = useAuthState();
  const plan = user?.company?.subscriptionPlan ?? 'starter';
  const [sendingReminders, setSendingReminders] = useState(false);

  const handleSendReminders = async () => {
    setSendingReminders(true);
    try {
      const res = await fetch('/api/autopay/invoices/send-reminders', { method: 'POST' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || 'Failed');
      toast({ title: `Reminders sent!`, description: `${d.remindersSent} of ${d.totalOverdue} overdue invoices notified.` });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSendingReminders(false);
    }
  };

  const totalUnpaid = data?.invoices.filter(i => ['sent', 'overdue'].includes(i.status)).reduce((sum, i) => sum + Number(i.total), 0) ?? 0;
  const totalPaid = data?.invoices.filter(i => i.status === 'paid').reduce((sum, i) => sum + Number(i.total), 0) ?? 0;

  return (
    <AppLayout>
      {showNew && <NewInvoiceModal onClose={() => setShowNew(false)} />}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-display font-bold">Invoices</h1>
          <p className="text-muted-foreground mt-1">Track payments and billing</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={handleSendReminders} isLoading={sendingReminders}>
            <Bell className="w-4 h-4 mr-2" />Send Reminders
          </Button>
          {plan === 'pro' && (
            <Button variant="outline" onClick={() => downloadExport('/api/export/invoices', 'invoices.csv')}>
              <Download className="w-4 h-4 mr-2" />Export CSV
            </Button>
          )}
          <Button onClick={() => setShowNew(true)}><Plus className="w-4 h-4 mr-2" />New Invoice</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <Card className="p-4 border-border/50">
          <p className="text-sm text-muted-foreground">Outstanding</p>
          <p className="text-2xl font-bold text-orange-600">${totalUnpaid.toFixed(2)}</p>
        </Card>
        <Card className="p-4 border-border/50">
          <p className="text-sm text-muted-foreground">Collected</p>
          <p className="text-2xl font-bold text-green-600">${totalPaid.toFixed(2)}</p>
        </Card>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap">
        {['', 'draft', 'sent', 'paid', 'overdue', 'cancelled'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${statusFilter === s ? 'bg-primary text-primary-foreground shadow-md' : 'bg-card border border-border hover:border-primary/50 text-muted-foreground'}`}>
            {s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All'}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
      ) : (
        <Card className="border-border/50 overflow-hidden">
          {data?.invoices.length === 0 ? (
            <div className="p-12 text-center">
              <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No invoices yet</h3>
              <Button onClick={() => setShowNew(true)} className="mt-4"><Plus className="w-4 h-4 mr-2" />Create First Invoice</Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-accent/30">
                    <th className="text-left p-4 text-sm font-semibold text-muted-foreground">Invoice #</th>
                    <th className="text-left p-4 text-sm font-semibold text-muted-foreground">Customer</th>
                    <th className="text-left p-4 text-sm font-semibold text-muted-foreground">Total</th>
                    <th className="text-left p-4 text-sm font-semibold text-muted-foreground">Status</th>
                    <th className="text-left p-4 text-sm font-semibold text-muted-foreground">Due Date</th>
                    <th className="text-right p-4 text-sm font-semibold text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data?.invoices.map(inv => (
                    <tr key={inv.id} className="hover:bg-accent/30 transition-colors">
                      <td className="p-4 font-mono text-sm font-medium">{inv.invoiceNumber}</td>
                      <td className="p-4 text-sm">{inv.customerName || '—'}</td>
                      <td className="p-4 text-sm font-semibold">${Number(inv.total).toFixed(2)}</td>
                      <td className="p-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[inv.status] || 'bg-gray-100 text-gray-600'}`}>
                          {inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
                        </span>
                      </td>
                      <td className="p-4 text-sm text-muted-foreground">{inv.dueDate ? format(new Date(inv.dueDate), 'MMM d, yyyy') : '—'}</td>
                      <td className="p-4">
                        <div className="flex items-center gap-2 justify-end">
                          {inv.status === 'draft' && (
                            <Button size="sm" variant="outline" onClick={async () => {
                              await sendMut.mutateAsync({ id: inv.id });
                              qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
                              toast({ title: 'Invoice sent' });
                            }}>Send</Button>
                          )}
                          {['sent', 'overdue'].includes(inv.status) && (
                            <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={async () => {
                              await markPaidMut.mutateAsync({ id: inv.id, data: {} });
                              qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
                              toast({ title: 'Marked as paid' });
                            }}>Mark Paid</Button>
                          )}
                          <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={async () => {
                            if (!confirm('Delete invoice?')) return;
                            await deleteMut.mutateAsync({ id: inv.id });
                            qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
                            toast({ title: 'Invoice deleted' });
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
