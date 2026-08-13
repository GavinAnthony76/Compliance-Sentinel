import { useState, useEffect, useRef } from 'react';
import { useListInvoices, useCreateInvoice, useMarkInvoicePaid, useSendInvoice, useDeleteInvoice, useListCustomers, useListAppointments, useUpdateInvoice } from '@workspace/api-client-react';
import type { CreateInvoiceRequest, UpdateInvoiceRequest } from '@workspace/api-client-react';
import { useSearch, useLocation } from 'wouter';
import { AppLayout } from '@/components/layout';
import { Card, Button, Input } from '@/components/ui';
import { Plus, FileText, Download, Bell, Banknote, Pencil, Eye } from 'lucide-react';
import { useAuthState } from '@/hooks/use-auth-state';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { getListInvoicesQueryKey } from '@workspace/api-client-react';
import { format } from 'date-fns';
import { LineItemsEditor, type LineItem as InvoiceLineItemInput } from '@/components/line-items-editor';
import { SearchableSelect } from '@/components/searchable-select';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { MdyDateInput } from '@/components/mdy-date-input';

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
  processing: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

// Friendly status labels. The transient "processing" status is set by the
// backend while a card charge is being attempted; surface it clearly instead
// of the raw word so staff watching the list know a payment is underway.
const STATUS_LABELS: Record<string, string> = {
  processing: 'Payment in progress…',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.charAt(0).toUpperCase() + status.slice(1);
}

export function InvoiceStatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[status] || 'bg-gray-100 text-gray-600'}`}>
      {status === 'processing' && (
        <span className="w-2.5 h-2.5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      )}
      {statusLabel(status)}
    </span>
  );
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash', check: 'Check', zelle: 'Zelle', venmo: 'Venmo',
  cashapp: 'Cash App', bank_transfer: 'Bank Transfer', card: 'Card (Online)', other: 'Other',
};

// Resolve the human-readable payment method for a paid invoice. Falls back to the
// online card label when a Stripe payment intent exists but no method was recorded
// (e.g. invoices paid online before the method was stored).
function displayPaymentMethod(inv: { paymentMethod?: string | null; stripePaymentIntentId?: string | null }): string | null {
  if (inv.paymentMethod) return PAYMENT_METHOD_LABELS[inv.paymentMethod] ?? inv.paymentMethod;
  if (inv.stripePaymentIntentId) return PAYMENT_METHOD_LABELS.card;
  return null;
}

function NewInvoiceModal({ onClose, preselectedApptId }: { onClose: () => void; preselectedApptId?: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const createMut = useCreateInvoice();
  // Server-side search keeps every record reachable — no hardcoded cap can
  // silently hide customers/appointments from companies with long lists.
  const [customerSearch, setCustomerSearch] = useState('');
  const [apptSearch, setApptSearch] = useState('');
  const debouncedCustomerSearch = useDebouncedValue(customerSearch, 250);
  const debouncedApptSearch = useDebouncedValue(apptSearch, 250);
  const [customerPage, setCustomerPage] = useState(1);
  const [apptPage, setApptPage] = useState(1);
  // Accumulated options across pages so "Load more" can reach every record.
  const [customerOptions, setCustomerOptions] = useState<{ value: string; label: string }[]>([]);
  const [apptOptions, setApptOptions] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => { setCustomerPage(1); }, [debouncedCustomerSearch]);
  useEffect(() => { setApptPage(1); }, [debouncedApptSearch]);
  const { data: customers, isFetching: customersFetching } = useListCustomers({ page: customerPage, limit: 50, ...(debouncedCustomerSearch ? { search: debouncedCustomerSearch } : {}) } as Parameters<typeof useListCustomers>[0]);
  const { data: apptData, isFetching: apptsFetching } = useListAppointments({ page: apptPage, limit: 50, ...(debouncedApptSearch ? { search: debouncedApptSearch } : {}) } as Parameters<typeof useListAppointments>[0]);

  useEffect(() => {
    if (!customers) return;
    const pageOpts = customers.customers.map(c => ({
      value: String(c.id),
      label: `${c.firstName || ''} ${c.lastName || ''}`.trim() || (c as { phone?: string }).phone || 'Customer',
    }));
    setCustomerOptions(prev => {
      const base = customers.page === 1 ? [] : prev;
      const seen = new Set(base.map(o => o.value));
      return [...base, ...pageOpts.filter(o => !seen.has(o.value))];
    });
  }, [customers]);

  useEffect(() => {
    const d = apptData as { appointments?: Array<{ id: number; scheduledStart: string; customerName?: string; customerId: number; serviceName?: string }>; page?: number } | undefined;
    if (!d?.appointments) return;
    const pageOpts = d.appointments.map(a => {
      const dateStr = new Date(a.scheduledStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const custName = a.customerName || `Customer #${a.customerId}`;
      const svcName = a.serviceName ? ` — ${a.serviceName}` : '';
      return { value: String(a.id), label: `${dateStr} · ${custName}${svcName}` };
    });
    setApptOptions(prev => {
      const base = (d.page ?? 1) === 1 ? [] : prev;
      const seen = new Set(base.map(o => o.value));
      return [...base, ...pageOpts.filter(o => !seen.has(o.value))];
    });
  }, [apptData]);
  const token = localStorage.getItem('greensync_token');

  const [form, setForm] = useState({ customerId: '', appointmentId: preselectedApptId ? String(preselectedApptId) : '', tax: '0', notes: '', dueDate: '' });
  // Labels for selections that may not be present in the current search page.
  const [selectedCustomerLabel, setSelectedCustomerLabel] = useState<string | undefined>();
  const [selectedApptLabel, setSelectedApptLabel] = useState<string | undefined>(preselectedApptId ? `Appointment #${preselectedApptId}` : undefined);
  const [lineItems, setLineItems] = useState<InvoiceLineItemInput[]>([{ description: '', quantity: 1, unitPrice: 0, lineTotal: 0 }]);
  const [loadingAppt, setLoadingAppt] = useState(false);
  const didAutoload = useRef(false);

  const subtotal = lineItems.reduce((s, li) => s + li.lineTotal, 0);
  const tax = Number(form.tax) || 0;
  const total = subtotal + tax;

  useEffect(() => {
    if (preselectedApptId && !didAutoload.current) {
      didAutoload.current = true;
      handleAppointmentChange(String(preselectedApptId));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectedApptId]);

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
      if (data.customerName) setSelectedCustomerLabel(data.customerName);
      setLineItems(data.lineItems.map((li: InvoiceLineItemInput) => ({
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
    const payload: CreateInvoiceRequest = {
      customerId: Number(form.customerId),
      appointmentId: form.appointmentId ? Number(form.appointmentId) : undefined,
      lineItems,
      subtotal,
      tax,
      total,
      notes: form.notes || undefined,
      dueDate: form.dueDate ? new Date(form.dueDate + 'T12:00:00').toISOString() : undefined,
    };
    try {
      await createMut.mutateAsync({ data: payload });
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
            <SearchableSelect
              value={form.customerId}
              selectedLabel={selectedCustomerLabel}
              options={customerOptions}
              onChange={v => {
                setForm(f => ({ ...f, customerId: v }));
                setSelectedCustomerLabel(customerOptions.find(o => o.value === v)?.label);
              }}
              onSearchChange={setCustomerSearch}
              placeholder="Select customer..."
              loading={customersFetching}
              total={customers?.total}
              onLoadMore={() => setCustomerPage(p => p + 1)}
            />
          </div>

          <div>
            <label className="text-sm font-medium">Link to Appointment (optional)</label>
            <SearchableSelect
              value={form.appointmentId}
              selectedLabel={selectedApptLabel}
              options={apptOptions}
              onChange={v => {
                setSelectedApptLabel(apptOptions.find(o => o.value === v)?.label);
                handleAppointmentChange(v);
              }}
              onSearchChange={setApptSearch}
              placeholder="None — enter line items manually"
              emptyOptionLabel="None — enter line items manually"
              disabled={loadingAppt}
              loading={apptsFetching}
              total={(apptData as { total?: number })?.total}
              onLoadMore={() => setApptPage(p => p + 1)}
            />
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
              <MdyDateInput className="mt-1" value={form.dueDate} onChange={v => setForm(f => ({ ...f, dueDate: v }))} />
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

function MarkPaidDialog({ invoice, onClose, onPaid }: { invoice: { id: number; invoiceNumber: string; total: string | number }; onClose: () => void; onPaid: () => void }) {
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paymentNote, setPaymentNote] = useState('');
  const { toast } = useToast();
  const markPaidMut = useMarkInvoicePaid();
  const qc = useQueryClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await markPaidMut.mutateAsync({ id: invoice.id, data: { paymentMethod, paymentMethodNote: paymentNote || undefined } as Parameters<typeof markPaidMut.mutateAsync>[0]['data'] });
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

type InvoiceDetail = {
  id: number;
  invoiceNumber: string;
  customerName?: string;
  status: string;
  subtotal: string | number;
  tax: string | number;
  total: string | number;
  dueDate?: string;
  notes?: string;
  paymentMethod?: string;
  paymentMethodNote?: string;
  stripePaymentIntentId?: string | null;
  lineItems: InvoiceLineItemInput[];
};

export function InvoiceDetailModal({ invoice, onClose }: { invoice: { id: number; invoiceNumber: string; status: string }; onClose: () => void }) {
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const token = localStorage.getItem('greensync_token');

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      fetch(`/api/invoices/${invoice.id}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(d => {
          if (cancelled) return;
          setDetail(d);
          // Poll while the payment is mid-charge so the modal flips to the
          // settled status without a manual reload.
          if (d?.status === 'processing') timer = setTimeout(load, 4000);
        })
        .catch(() => {})
        .finally(() => { if (!cancelled) setLoading(false); });
    };
    load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [invoice.id]);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold">{invoice.invoiceNumber}</h2>
            {detail?.customerName && <p className="text-sm text-muted-foreground mt-0.5">{detail.customerName}</p>}
          </div>
          <InvoiceStatusBadge status={detail?.status ?? invoice.status} />
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
        ) : detail ? (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Line Items</h3>
              <div className="border border-border rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-accent/50">
                      <th className="text-left p-3 font-medium text-muted-foreground">Description</th>
                      <th className="text-center p-3 font-medium text-muted-foreground">Qty</th>
                      <th className="text-right p-3 font-medium text-muted-foreground">Unit</th>
                      <th className="text-right p-3 font-medium text-muted-foreground">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {detail.lineItems.map((li, i) => (
                      <tr key={i}>
                        <td className="p-3">{li.description}</td>
                        <td className="p-3 text-center">{li.quantity}</td>
                        <td className="p-3 text-right">${Number(li.unitPrice).toFixed(2)}</td>
                        <td className="p-3 text-right font-medium">${Number(li.lineTotal).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-accent/30 rounded-xl p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>${Number(detail.subtotal).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tax</span>
                <span>${Number(detail.tax).toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold text-base border-t border-border pt-2 mt-1">
                <span>Total</span>
                <span>${Number(detail.total).toFixed(2)}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              {detail.dueDate && (
                <div><span className="text-muted-foreground">Due Date: </span>{format(new Date(detail.dueDate), 'M/d/yyyy')}</div>
              )}
              {displayPaymentMethod(detail) && (
                <div><span className="text-muted-foreground">Payment: </span>{displayPaymentMethod(detail)}</div>
              )}
            </div>

            {detail.notes && (
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Notes</p>
                <p className="text-sm">{detail.notes}</p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">Could not load invoice details.</p>
        )}

        <div className="pt-6">
          <Button variant="outline" onClick={onClose} className="w-full">Close</Button>
        </div>
      </div>
    </div>
  );
}

function EditInvoiceModal({ invoice, onClose }: { invoice: { id: number; invoiceNumber: string }; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const updateMut = useUpdateInvoice();
  const token = localStorage.getItem('greensync_token');

  const [lineItems, setLineItems] = useState<InvoiceLineItemInput[]>([]);
  const [tax, setTax] = useState('0');
  const [notes, setNotes] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/invoices/${invoice.id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then((d: InvoiceDetail) => {
        setLineItems(d.lineItems?.map(li => ({
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
    const payload: UpdateInvoiceRequest = {
      lineItems,
      subtotal,
      tax: taxNum,
      total,
      notes: notes || undefined,
      dueDate: dueDate ? new Date(dueDate + 'T12:00:00').toISOString() : undefined,
    };
    try {
      await updateMut.mutateAsync({ id: invoice.id, data: payload });
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
                <MdyDateInput className="mt-1" value={dueDate} onChange={setDueDate} />
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

// Local-date formatting (not toISOString, which shifts to UTC and can land on
// the wrong day for evening users).
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function presetRange(preset: string): { from: string; to: string } | null {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const q = Math.floor(m / 3);
  switch (preset) {
    case 'this_month':
      return { from: ymd(new Date(y, m, 1)), to: ymd(new Date(y, m + 1, 0)) };
    case 'last_month':
      return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) };
    case 'this_quarter':
      return { from: ymd(new Date(y, q * 3, 1)), to: ymd(new Date(y, q * 3 + 3, 0)) };
    case 'last_quarter':
      return { from: ymd(new Date(y, q * 3 - 3, 1)), to: ymd(new Date(y, q * 3, 0)) };
    case 'this_year':
      return { from: ymd(new Date(y, 0, 1)), to: ymd(new Date(y, 11, 31)) };
    case 'last_year':
      return { from: ymd(new Date(y - 1, 0, 1)), to: ymd(new Date(y - 1, 11, 31)) };
    default:
      return null;
  }
}

const DATE_PRESETS: Array<[string, string]> = [
  ['', 'All time'],
  ['this_month', 'This month'],
  ['last_month', 'Last month'],
  ['this_quarter', 'This quarter'],
  ['last_quarter', 'Last quarter'],
  ['this_year', 'This year'],
  ['last_year', 'Last year'],
  ['custom', 'Custom range…'],
];

export function InvoicesPage() {
  const [showNew, setShowNew] = useState(false);
  const [preselectedApptId, setPreselectedApptId] = useState<number | undefined>(undefined);
  const [markingPaid, setMarkingPaid] = useState<{ id: number; invoiceNumber: string; total: string | number } | null>(null);
  const [editingDraft, setEditingDraft] = useState<{ id: number; invoiceNumber: string } | null>(null);
  const [viewingInvoice, setViewingInvoice] = useState<{ id: number; invoiceNumber: string; status: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [methodFilter, setMethodFilter] = useState('');
  const [datePreset, setDatePreset] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  // Any filter change restarts the list from page 1 so the user never lands
  // on an out-of-range page of the new (smaller) result set.
  useEffect(() => {
    setPage(1);
  }, [statusFilter, methodFilter, fromDate, toDate]);

  const applyPreset = (preset: string) => {
    setDatePreset(preset);
    if (preset === 'custom') return; // keep current from/to for manual editing
    const range = presetRange(preset);
    setFromDate(range?.from ?? '');
    setToDate(range?.to ?? '');
  };

  const listParams = {
    status: statusFilter || undefined,
    paymentMethod: methodFilter || undefined,
    from: fromDate || undefined,
    to: toDate || undefined,
    page,
    limit: PAGE_SIZE,
  };
  const { data, isLoading } = useListInvoices(
    listParams as Parameters<typeof useListInvoices>[0],
    {
      query: {
        queryKey: getListInvoicesQueryKey(listParams as Parameters<typeof getListInvoicesQueryKey>[0]),
        // While any visible invoice is mid-charge ("processing"), poll every
        // few seconds so the list flips to paid/sent without a manual reload.
        refetchInterval: (query) => {
          const invoices = (query.state.data as { invoices?: { status: string }[] } | undefined)?.invoices;
          return invoices?.some(inv => inv.status === 'processing') ? 4000 : false;
        },
        // Keep the previous page's rows visible while the next page loads so
        // paging doesn't flash the full-screen spinner.
        placeholderData: (prev?: import('@workspace/api-client-react').InvoiceListResponse) => prev,
      },
    },
  );
  const { toast } = useToast();
  const qc = useQueryClient();
  const sendMut = useSendInvoice();
  const deleteMut = useDeleteInvoice();
  const { user } = useAuthState();
  const plan = user?.company?.subscriptionPlan ?? 'starter';
  const [sendingReminders, setSendingReminders] = useState(false);
  const search = useSearch();
  const [, setLocation] = useLocation();
  const [pendingOpenInvoiceId, setPendingOpenInvoiceId] = useState<number | null>(null);
  const didHandleParams = useRef(false);

  // Parse URL params once on mount
  useEffect(() => {
    if (didHandleParams.current) return;
    const params = new URLSearchParams(search);
    const fromAppt = params.get('fromAppt');
    const openInvoice = params.get('openInvoice');
    if (!fromAppt && !openInvoice) return;
    didHandleParams.current = true;
    setLocation('/invoices', { replace: true });
    if (fromAppt) {
      setPreselectedApptId(Number(fromAppt));
      setShowNew(true);
    } else if (openInvoice) {
      setPendingOpenInvoiceId(Number(openInvoice));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // When a deep link requests a specific invoice, fetch it directly by id so it
  // opens even when it isn't on the currently loaded page of the list.
  useEffect(() => {
    if (!pendingOpenInvoiceId) return;
    let cancelled = false;
    fetch(`/api/invoices/${pendingOpenInvoiceId}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('greensync_token')}` },
    })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((inv: { id: number; invoiceNumber: string; status: string }) => {
        if (cancelled) return;
        setViewingInvoice({ id: inv.id, invoiceNumber: inv.invoiceNumber, status: inv.status });
        setPendingOpenInvoiceId(null);
      })
      .catch(() => {
        if (cancelled) return;
        toast({ title: 'Invoice not found', description: 'The linked invoice could not be loaded.', variant: 'destructive' });
        setPendingOpenInvoiceId(null);
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOpenInvoiceId]);

  const handleSendReminders = async () => {
    setSendingReminders(true);
    try {
      const res = await fetch('/api/autopay/invoices/send-reminders', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('greensync_token')}` } });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || 'Failed');
      toast({ title: `Reminders sent!`, description: `${d.remindersSent} of ${d.totalOverdue} overdue invoices notified.` });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setSendingReminders(false);
    }
  };

  // Totals are aggregated server-side across the FULL filtered set, not just the current page.
  const totalUnpaid = data?.summary.outstanding ?? 0;
  const totalPaid = data?.summary.paidTotal ?? 0;
  const paidOnline = data?.summary.paidOnline ?? 0;
  const paidOffline = data?.summary.paidOffline ?? 0;

  return (
    <AppLayout>
      {showNew && <NewInvoiceModal onClose={() => { setShowNew(false); setPreselectedApptId(undefined); }} preselectedApptId={preselectedApptId} />}
      {markingPaid && <MarkPaidDialog invoice={markingPaid} onClose={() => setMarkingPaid(null)} onPaid={() => setMarkingPaid(null)} />}
      {editingDraft && <EditInvoiceModal invoice={editingDraft} onClose={() => setEditingDraft(null)} />}
      {viewingInvoice && <InvoiceDetailModal invoice={viewingInvoice} onClose={() => setViewingInvoice(null)} />}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-display font-bold">Invoices</h1>
          <p className="text-muted-foreground mt-1">Track payments and billing</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {plan === 'pro' && (
            <Button variant="outline" onClick={handleSendReminders} isLoading={sendingReminders}>
              <Bell className="w-4 h-4 mr-2" />Send Reminders
            </Button>
          )}
          {plan === 'pro' && (
            <Button variant="outline" onClick={() => {
              // Pass the active on-screen filters so the CSV matches the list.
              const params = new URLSearchParams();
              if (statusFilter) params.set('status', statusFilter);
              if (methodFilter) params.set('paymentMethod', methodFilter);
              if (fromDate) params.set('from', fromDate);
              if (toDate) params.set('to', toDate);
              const qs = params.toString();
              downloadExport(`/api/export/invoices${qs ? `?${qs}` : ''}`, 'invoices.csv', msg => toast({ title: msg, variant: 'destructive' }));
            }}>
              <Download className="w-4 h-4 mr-2" />Export CSV
            </Button>
          )}
          <Button onClick={() => setShowNew(true)}><Plus className="w-4 h-4 mr-2" />New Invoice</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <Card className="p-4 border-border/50">
          <p className="text-sm text-muted-foreground">Outstanding</p>
          <p className="text-2xl font-bold text-orange-600">${totalUnpaid.toFixed(2)}</p>
        </Card>
        <Card className="p-4 border-border/50">
          <p className="text-sm text-muted-foreground">Collected</p>
          <p className="text-2xl font-bold text-green-600">${totalPaid.toFixed(2)}</p>
        </Card>
        <Card className="p-4 border-border/50">
          <p className="text-sm text-muted-foreground">Paid online</p>
          <p className="text-2xl font-bold text-emerald-600">${paidOnline.toFixed(2)}</p>
        </Card>
        <Card className="p-4 border-border/50">
          <p className="text-sm text-muted-foreground">Paid offline</p>
          <p className="text-2xl font-bold text-teal-600">${paidOffline.toFixed(2)}</p>
        </Card>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
        <div className="flex gap-2 flex-wrap">
          {['', 'draft', 'sent', 'paid', 'overdue', 'cancelled'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${statusFilter === s ? 'bg-primary text-primary-foreground shadow-md' : 'bg-card border border-border hover:border-primary/50 text-muted-foreground'}`}>
              {s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All'}
            </button>
          ))}
        </div>
        <div className="sm:ml-auto flex flex-wrap items-center gap-2">
          <select
            value={datePreset}
            onChange={e => applyPreset(e.target.value)}
            className="h-10 px-3 rounded-xl border border-border bg-card text-sm font-medium text-muted-foreground hover:border-primary/50 transition-all"
            aria-label="Filter by date range"
          >
            {DATE_PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select
            value={methodFilter}
            onChange={e => setMethodFilter(e.target.value)}
            className="h-10 px-3 rounded-xl border border-border bg-card text-sm font-medium text-muted-foreground hover:border-primary/50 transition-all"
            aria-label="Filter by payment method"
          >
            <option value="">All payment methods</option>
            {Object.entries(PAYMENT_METHOD_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>

      {datePreset === 'custom' && (
        <div className="flex flex-wrap items-center gap-3 mb-6 -mt-2">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">From</span>
            <MdyDateInput value={fromDate} onChange={setFromDate} aria-label="Date range start" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">To</span>
            <MdyDateInput value={toDate} onChange={setToDate} aria-label="Date range end" />
          </div>
          {(fromDate || toDate) && (
            <button
              onClick={() => { setFromDate(''); setToDate(''); }}
              className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Clear dates
            </button>
          )}
        </div>
      )}

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
                  {data?.invoices.map(inv => {
                    const invExt = inv as typeof inv & { paymentMethod?: string | null; stripePaymentIntentId?: string | null };
                    const methodLabel = displayPaymentMethod(invExt);
                    return (
                      <tr key={inv.id} className="hover:bg-accent/30 transition-colors">
                        <td className="p-4 font-mono text-sm font-medium">
                          <button
                            onClick={() => setViewingInvoice({ id: inv.id, invoiceNumber: inv.invoiceNumber, status: inv.status })}
                            className="text-primary underline underline-offset-2 hover:opacity-80"
                          >
                            {inv.invoiceNumber}
                          </button>
                        </td>
                        <td className="p-4 text-sm">{inv.customerName || '—'}</td>
                        <td className="p-4 text-sm font-semibold">${Number(inv.total).toFixed(2)}</td>
                        <td className="p-4">
                          <div className="flex items-center gap-1.5">
                            <InvoiceStatusBadge status={inv.status} />
                            {inv.status === 'paid' && methodLabel && (
                              <span className="text-xs text-muted-foreground">· {methodLabel}</span>
                            )}
                          </div>
                        </td>
                        <td className="p-4 text-sm text-muted-foreground">{inv.dueDate ? format(new Date(inv.dueDate), 'MMM d, yyyy') : '—'}</td>
                        <td className="p-4">
                          <div className="flex items-center gap-2 justify-end">
                            <Button size="sm" variant="ghost" onClick={() => setViewingInvoice({ id: inv.id, invoiceNumber: inv.invoiceNumber, status: inv.status })}>
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" title="Download PDF" onClick={() => downloadExport(`/api/invoices/${inv.id}/pdf`, `invoice-${inv.invoiceNumber}.pdf`, msg => toast({ title: msg, variant: 'destructive' }))}>
                              <Download className="w-3.5 h-3.5" />
                            </Button>
                            {inv.status === 'draft' && (
                              <>
                                <Button size="sm" variant="outline" onClick={() => setEditingDraft({ id: inv.id, invoiceNumber: inv.invoiceNumber })}>
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
                              <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => setMarkingPaid({ id: inv.id, invoiceNumber: inv.invoiceNumber, total: inv.total })}>
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
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {(data?.total ?? 0) > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 border-t border-border">
              <p className="text-sm text-muted-foreground">
                Showing {(data!.page - 1) * data!.limit + 1}–{Math.min(data!.page * data!.limit, data!.total)} of {data!.total} invoice{data!.total === 1 ? '' : 's'}
              </p>
              {data!.total > data!.limit && (
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground px-1">
                    Page {data!.page} of {Math.max(1, Math.ceil(data!.total / data!.limit))}
                  </span>
                  <Button size="sm" variant="outline" disabled={data!.page * data!.limit >= data!.total} onClick={() => setPage(p => p + 1)}>
                    Next
                  </Button>
                </div>
              )}
            </div>
          )}
        </Card>
      )}
    </AppLayout>
  );
}
