import { useState, useEffect } from 'react';
import { useListInvoices, useCreateInvoice, useMarkInvoicePaid, useSendInvoice, useDeleteInvoice, useListCustomers, useListAppointments, useUpdateInvoice } from '@workspace/api-client-react';
import { AppLayout } from '@/components/layout';
import { Card, Button, Input } from '@/components/ui';
import { Plus, FileText, Download, Bell, Trash2, Banknote, Pencil } from 'lucide-react';
import { useAuthState } from '@/hooks/use-auth-state';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { getListInvoicesQueryKey } from '@workspace/api-client-react';
import { format } from 'date-fns';

function downloadExport(path: string, filename: string, onError: (msg: string) => void) {
  fetch(path, { headers: { Authorization: `Bearer ${localStorage.getItem('greensync_token')}` } })
    .then(r => {
      if (!r.ok) throw new Error(r.status === 403 ? 'CSV export requires the Pro plan.' : `Export failed (${r.status})`);
      return r.blob();
    })
    .then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    })
    .catch(err => onError(err.message || 'Export failed'));
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  sent: 'bg-blue-100 text-blue-700',
  paid: 'bg-green-100 text-green-700',
  overdue: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

type LineItem = { description: string; quantity: number; unitPrice: number; lineTotal: number };

function LineItemsEditor({ items, onChange }: { items: LineItem[]; onChange: (items: LineItem[]) => void }) {
  const addRow = () => onChange([...items, { description: '', quantity: 1, unitPrice: 0, lineTotal: 0 }]);
  const removeRow = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const update = (i: number, field: keyof LineItem, val: string) => {
    const updated = items.map((li, idx) => {
      if (idx !== i) return li;
      const next = { ...li, [field]: field === 'description' ? val : Number(val) };
      next.lineTotal = Number((next.quantity * next.unitPrice).toFixed(2));
      return next;
    });
    onChange(updated);
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-12 gap-1 text-xs font-semibold text-muted-foreground px-1">
        <span className="col-span-5">Description</span>
        <span className="col-span-2 text-center">Qty</span>
        <span className="col-span-2 text-right">Unit Price</span>
        <span className="col-span-2 text-right">Total</span>
        <span className="col-span-1" />
      </div>
      {items.map((li, i) => (
        <div key={i} className="grid grid-cols-12 gap-1 items-center">
          <Input className="col-span-5 h-9 text-sm" value={li.description} onChange={e => update(i, 'description', e.target.value)} placeholder="Service description" required />
          <Input className="col-span-2 h-9 text-sm text-center" type="number" min="0.01" step="0.01" value={li.quantity} onChange={e => update(i, 'quantity', e.target.value)} />
          <Input className="col-span-2 h-9 text-sm text-right" type="number" min="0" step="0.01" value={li.unitPrice} onChange={e => update(i, 'unitPrice', e.target.value)} />
          <div className="col-span-2 text-right text-sm font-medium pr-1">${li.lineTotal.toFixed(2)}</div>
          <button type="button" onClick={() => removeRow(i)} className="col-span-1 flex justify-center text-muted-foreground hover:text-destructive">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}
      <button type="button" onClick={addRow} className="text-xs text-primary underline underline-offset-2 hover:opacity-80 mt-1">+ Add Line Item</button>
    </div>
  );
}

function NewInvoiceModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const createMut = useCreateInvoice();
  const { data: customers } = useListCustomers({ page: 1, limit: 200 } as any);
  const { data: apptData } = useListAppointments({ limit: 100, status: 'scheduled' } as any);
  const token = localStorage.getItem('greensync_token');

  const [form, setForm] = useState({ customerId: '', appointmentId: '', tax: '0', notes: '', dueDate: '' });
  const [lineItems, setLineItems] = useState<LineItem[]>([{ description: '', quantity: 1, unitPrice: 0, lineTotal: 0 }]);
  const [loadingAppt, setLoadingAppt] = useState(false);

  const subtotal = lineItems.reduce((s, li) => s + li.lineTotal, 0);
  const tax = Number(form.tax) || 0;
  const total = subtotal + tax;

  const handleAppointmentChange = async (apptId: string) => {
    setForm(f => ({ ...f, appointmentId: apptId }));
    if (!apptId) return;
    setLoadingAppt(true);
    try {
      const res = await fetch(`/api/invoices/from-appointment/${apptId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Could not load appointment');
      const data = await res.json();
      if (data.existingInvoiceId) {
        toast({ title: 'Invoice already exists', description: `Invoice #${data.existingInvoiceId} already created for this appointment.`, variant: 'destructive' });
        setForm(f => ({ ...f, appointmentId: '' }));
        return;
      }
      setForm(f => ({ ...f, customerId: String(data.customerId), notes: data.notes || '' }));
      setLineItems(data.lineItems.map((li: any) => ({
        description: li.description,
        quantity: Number(li.quantity),
        unitPrice: Number(li.unitPrice),
        lineTotal: Number((li.quantity * li.unitPrice).toFixed(2)),
      })));
    } catch {
      toast({ title: 'Could not load appointment data', variant: 'destructive' });
    } finally {
      setLoadingAppt(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.customerId) { toast({ title: 'Please select a customer', variant: 'destructive' }); return; }
    if (lineItems.length === 0 || lineItems.every(li => !li.description)) {
      toast({ title: 'Add at least one line item', variant: 'destructive' }); return;
    }
    try {
      await createMut.mutateAsync({
        data: {
          customerId: Number(form.customerId),
          appointmentId: form.appointmentId ? Number(form.appointmentId) : undefined,
          lineItems: lineItems as any,
          subtotal, tax, total,
          notes: form.notes || undefined,
          dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
        } as any,
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
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-6">New Invoice</h2>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="text-sm font-medium">Customer *</label>
            <select className="w-full mt-1 h-11 px-3 rounded-xl border border-input bg-background text-sm" value={form.customerId} onChange={e => setForm(f => ({ ...f, customerId: e.target.value }))} required>
              <option value="">Select customer...</option>
              {customers?.customers.map(c => {
                const name = `${c.firstName || ''} ${c.lastName || ''}`.trim() || (c as any).phone || 'Customer';
                return <option key={c.id} value={c.id}>{name}</option>;
              })}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium">Link to Appointment (optional)</label>
            <select
              className="w-full mt-1 h-11 px-3 rounded-xl border border-input bg-background text-sm"
              value={form.appointmentId}
              onChange={e => handleAppointmentChange(e.target.value)}
              disabled={loadingAppt}
            >
              <option value="">None — enter line items manually</option>
              {apptData?.appointments?.map((a: any) => {
                const dateStr = new Date(a.scheduledStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                const custName = a.customerName || `Customer #${a.customerId}`;
                const svcName = a.serviceName ? ` — ${a.serviceName}` : '';
                return <option key={a.id} value={a.id}>{dateStr} · {custName}{svcName}</option>;
              })}
            </select>
            {loadingAppt && <p className="text-xs text-muted-foreground mt-1">Loading appointment data...</p>}
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">Line Items *</label>
            <div className="border border-border rounded-xl p-3">
              <LineItemsEditor items={lineItems} onChange={setLineItems} />
            </div>
          </div>

          <div className="flex justify-end gap-6 text-sm">
            <div className="text-muted-foreground">Subtotal: <span className="font-semibold text-foreground">${subtotal.toFixed(2)}</span></div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Tax ($):</span>
              <Input type="number" step="0.01" min="0" value={form.tax} onChange={e => setForm(f => ({ ...f, tax: e.target.value }))} className="w-20 h-8 text-sm text-right" />
            </div>
            <div className="font-bold text-base">Total: ${total.toFixed(2)}</div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Due Date</label>
              <Input type="date" className="mt-1" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium">Notes</label>
              <Input className="mt-1" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes..." />
            </div>
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

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash', check: 'Check', zelle: 'Zelle', venmo: 'Venmo',
  cashapp: 'Cash App', bank_transfer: 'Bank Transfer', card: 'Card (Online)', other: 'Other',
};

function MarkPaidDialog({ invoice, onClose, onPaid }: { invoice: any; onClose: () => void; onPaid: () => void }) {
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paymentNote, setPaymentNote] = useState('');
  const { toast } = useToast();
  const markPaidMut = useMarkInvoicePaid();
  const qc = useQueryClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await markPaidMut.mutateAsync({ id: invoice.id, data: { paymentMethod, paymentMethodNote: paymentNote || undefined } as any });
      qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
      toast({ title: `Invoice ${invoice.invoiceNumber} marked as paid` });
      onPaid();
    } catch {
      toast({ title: 'Error marking as paid', variant: 'destructive' });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <h2 className="text-xl font-bold mb-4">Mark as Paid</h2>
        <p className="text-sm text-muted-foreground mb-5">{invoice.invoiceNumber} — ${Number(invoice.total).toFixed(2)}</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Payment Method *</label>
            <select className="w-full mt-1 h-11 px-3 rounded-xl border border-input bg-background text-sm" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} required>
              {Object.entries(PAYMENT_METHOD_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">Note (optional)</label>
            <Input className="mt-1" value={paymentNote} onChange={e => setPaymentNote(e.target.value)} placeholder="e.g. Check #1234, Zelle ref..." />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button type="submit" className="flex-1 bg-green-600 hover:bg-green-700 text-white" isLoading={markPaidMut.isPending}>Confirm Paid</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditInvoiceModal({ invoice, onClose }: { invoice: any; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const updateMut = useUpdateInvoice();
  const token = localStorage.getItem('greensync_token');

  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [tax, setTax] = useState('0');
  const [notes, setNotes] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/invoices/${invoice.id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => {
        setLineItems(d.lineItems?.map((li: any) => ({
          description: li.description,
          quantity: Number(li.quantity),
          unitPrice: Number(li.unitPrice),
          lineTotal: Number(li.lineTotal),
        })) ?? [{ description: '', quantity: 1, unitPrice: 0, lineTotal: 0 }]);
        setTax(String(d.tax ?? 0));
        setNotes(d.notes ?? '');
        setDueDate(d.dueDate ? d.dueDate.split('T')[0] : '');
      })
      .catch(() => toast({ title: 'Could not load invoice', variant: 'destructive' }))
      .finally(() => setLoading(false));
  }, [invoice.id]);

  const subtotal = lineItems.reduce((s, li) => s + li.lineTotal, 0);
  const taxNum = Number(tax) || 0;
  const total = subtotal + taxNum;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lineItems.every(li => !li.description)) {
      toast({ title: 'Add at least one line item', variant: 'destructive' }); return;
    }
    try {
      await updateMut.mutateAsync({
        id: invoice.id,
        data: {
          lineItems: lineItems as any,
          subtotal, tax: taxNum, total,
          notes: notes || undefined,
          dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
        } as any,
      });
      toast({ title: 'Invoice updated' });
      qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
      onClose();
    } catch {
      toast({ title: 'Error updating invoice', variant: 'destructive' });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-1">Edit Invoice</h2>
        <p className="text-sm text-muted-foreground mb-6">{invoice.invoiceNumber} · Draft</p>
        {loading ? (
          <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="text-sm font-medium mb-2 block">Line Items</label>
              <div className="border border-border rounded-xl p-3">
                <LineItemsEditor items={lineItems} onChange={setLineItems} />
              </div>
            </div>
            <div className="flex justify-end gap-6 text-sm">
              <div className="text-muted-foreground">Subtotal: <span className="font-semibold text-foreground">${subtotal.toFixed(2)}</span></div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Tax ($):</span>
                <Input type="number" step="0.01" min="0" value={tax} onChange={e => setTax(e.target.value)} className="w-20 h-8 text-sm text-right" />
              </div>
              <div className="font-bold text-base">Total: ${total.toFixed(2)}</div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Due Date</label>
                <Input type="date" className="mt-1" value={dueDate} onChange={e => setDueDate(e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium">Notes</label>
                <Input className="mt-1" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes..." />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
              <Button type="submit" className="flex-1" isLoading={updateMut.isPending}>Save Changes</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export function InvoicesPage() {
  const [showNew, setShowNew] = useState(false);
  const [markingPaid, setMarkingPaid] = useState<any>(null);
  const [editingDraft, setEditingDraft] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const { data, isLoading } = useListInvoices({ status: statusFilter || undefined, page: 1, limit: 50 } as any);
  const { toast } = useToast();
  const qc = useQueryClient();
  const sendMut = useSendInvoice();
  const deleteMut = useDeleteInvoice();
  const { user } = useAuthState();
  const plan = user?.company?.subscriptionPlan ?? 'starter';
  const [sendingReminders, setSendingReminders] = useState(false);

  const handleSendReminders = async () => {
    setSendingReminders(true);
    try {
      const res = await fetch('/api/autopay/invoices/send-reminders', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('greensync_token')}` } });
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
      {markingPaid && <MarkPaidDialog invoice={markingPaid} onClose={() => setMarkingPaid(null)} onPaid={() => setMarkingPaid(null)} />}
      {editingDraft && <EditInvoiceModal invoice={editingDraft} onClose={() => setEditingDraft(null)} />}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-display font-bold">Invoices</h1>
          <p className="text-muted-foreground mt-1">Track payments and billing</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {['pro', 'growth'].includes(plan) && (
            <Button variant="outline" onClick={handleSendReminders} isLoading={sendingReminders}>
              <Bell className="w-4 h-4 mr-2" />Send Reminders
            </Button>
          )}
          {plan === 'pro' && (
            <Button variant="outline" onClick={() => downloadExport('/api/export/invoices', 'invoices.csv', msg => toast({ title: msg, variant: 'destructive' }))}>
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
                        <div className="flex items-center gap-1.5">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[inv.status] || 'bg-gray-100 text-gray-600'}`}>
                            {inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
                          </span>
                          {inv.status === 'paid' && (inv as any).paymentMethod && (
                            <span className="text-xs text-muted-foreground">· {PAYMENT_METHOD_LABELS[(inv as any).paymentMethod] ?? (inv as any).paymentMethod}</span>
                          )}
                        </div>
                      </td>
                      <td className="p-4 text-sm text-muted-foreground">{inv.dueDate ? format(new Date(inv.dueDate), 'MMM d, yyyy') : '—'}</td>
                      <td className="p-4">
                        <div className="flex items-center gap-2 justify-end">
                          {inv.status === 'draft' && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => setEditingDraft(inv)}>
                                <Pencil className="w-3.5 h-3.5 mr-1" />Edit
                              </Button>
                              <Button size="sm" variant="outline" onClick={async () => {
                                await sendMut.mutateAsync({ id: inv.id });
                                qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
                                toast({ title: 'Invoice sent' });
                              }}>Send</Button>
                            </>
                          )}
                          {['sent', 'overdue'].includes(inv.status) && (
                            <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => setMarkingPaid(inv)}>
                              <Banknote className="w-3.5 h-3.5 mr-1" />Mark Paid
                            </Button>
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
