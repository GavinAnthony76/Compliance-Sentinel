import { useState } from 'react';
import { useRoute, Link, useLocation } from 'wouter';
import {
  useGetCustomer, useUpdateCustomer, useDeleteCustomer,
  useCreateProperty, useUpdateProperty, useDeleteProperty,
  useCreateAppointment, useUpdateAppointment, useCompleteAppointment, useDeleteAppointment,
  useCreateInvoice, useMarkInvoicePaid, useDeleteInvoice,
  useListServices, useListTeam,
  getListCustomersQueryKey,
} from '@workspace/api-client-react';
import type { CreateInvoiceRequest } from '@workspace/api-client-react';
import { AppLayout } from '@/components/layout';
import { Card, CardContent, Button, Input } from '@/components/ui';
import { AppointmentStatusBadge } from '@/components/status-badge';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  ArrowLeft, User, MapPin, Phone, Mail, Globe, Edit2, Trash2,
  Plus, Calendar, FileText, Check, Home, Tag, ExternalLink, CreditCard, Zap, Pencil, Copy,
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  sent: 'bg-blue-100 text-blue-700',
  paid: 'bg-green-100 text-green-700',
  overdue: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

function EditCustomerModal({ customer, onClose }: { customer: any; onClose: () => void }) {
  const [form, setForm] = useState({
    firstName: customer.firstName ?? '',
    lastName: customer.lastName ?? '',
    email: customer.email ?? '',
    phone: customer.phone ?? '',
    addressLine1: customer.addressLine1 ?? '',
    city: customer.city ?? '',
    state: customer.state ?? '',
    zip: customer.zip ?? '',
    notes: customer.notes ?? '',
  });
  const { toast } = useToast();
  const qc = useQueryClient();
  const updateMut = useUpdateCustomer();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateMut.mutateAsync({ id: customer.id, data: form });
      qc.invalidateQueries({ queryKey: [`/api/customers/${customer.id}`] });
      qc.invalidateQueries({ queryKey: getListCustomersQueryKey() });
      toast({ title: 'Customer updated' });
      onClose();
    } catch {
      toast({ title: 'Error updating customer', variant: 'destructive' });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-lg p-6">
        <h2 className="text-xl font-bold mb-6">Edit Customer</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">First Name *</label>
              <Input value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} placeholder="Jane" required />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Last Name *</label>
              <Input value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} placeholder="Smith" required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Email</label>
              <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@example.com" icon={<Mail className="w-4 h-4" />} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Phone</label>
              <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="(555) 000-0000" icon={<Phone className="w-4 h-4" />} />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Street Address</label>
            <Input value={form.addressLine1} onChange={e => setForm(f => ({ ...f, addressLine1: e.target.value }))} placeholder="123 Oak St" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1 col-span-1">
              <label className="text-sm font-medium">City</label>
              <Input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder="Austin" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">State</label>
              <Input value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} placeholder="TX" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">ZIP</label>
              <Input value={form.zip} onChange={e => setForm(f => ({ ...f, zip: e.target.value }))} placeholder="78701" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Notes</label>
            <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any special notes about this customer..." />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button type="submit" className="flex-1" isLoading={updateMut.isPending}>Save Changes</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddPropertyModal({ customerId, onClose }: { customerId: number; onClose: () => void }) {
  const [form, setForm] = useState({ propertyName: '', addressLine1: '', city: '', state: '', zip: '', gateNotes: '', yardSize: '' });
  const { toast } = useToast();
  const qc = useQueryClient();
  const createMut = useCreateProperty();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createMut.mutateAsync({ data: { ...form, customerId } });
      qc.invalidateQueries({ queryKey: [`/api/customers/${customerId}`] });
      toast({ title: 'Property added' });
      onClose();
    } catch {
      toast({ title: 'Error adding property', variant: 'destructive' });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-lg p-6">
        <h2 className="text-xl font-bold mb-6">Add Property</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Property Name</label>
            <Input value={form.propertyName} onChange={e => setForm(f => ({ ...f, propertyName: e.target.value }))} placeholder="Main Residence, Rental Property..." icon={<Home className="w-4 h-4" />} />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Street Address *</label>
            <Input value={form.addressLine1} onChange={e => setForm(f => ({ ...f, addressLine1: e.target.value }))} placeholder="123 Oak Street" required icon={<MapPin className="w-4 h-4" />} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1 col-span-1">
              <label className="text-sm font-medium">City</label>
              <Input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder="Austin" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">State</label>
              <Input value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} placeholder="TX" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">ZIP</label>
              <Input value={form.zip} onChange={e => setForm(f => ({ ...f, zip: e.target.value }))} placeholder="78701" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Gate / Access Notes</label>
            <Input value={form.gateNotes} onChange={e => setForm(f => ({ ...f, gateNotes: e.target.value }))} placeholder="Gate code, dog in backyard..." />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Yard Size</label>
            <Input value={form.yardSize} onChange={e => setForm(f => ({ ...f, yardSize: e.target.value }))} placeholder="1/4 acre, small, large..." />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button type="submit" className="flex-1" isLoading={createMut.isPending}>Add Property</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditAppointmentModal({ appointment, customerId, onClose }: { appointment: any; customerId: number; onClose: () => void }) {
  const toLocalDT = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };
  const [form, setForm] = useState({
    serviceId: appointment.serviceId ? String(appointment.serviceId) : '',
    assignedUserId: appointment.assignedUserId ? String(appointment.assignedUserId) : '',
    scheduledStart: appointment.scheduledStart ? toLocalDT(appointment.scheduledStart) : '',
    scheduledEnd: appointment.scheduledEnd ? toLocalDT(appointment.scheduledEnd) : '',
    status: appointment.status ?? 'pending',
    notes: appointment.notes ?? '',
    price: appointment.price != null ? String(appointment.price) : '',
  });
  const { toast } = useToast();
  const qc = useQueryClient();
  const updateMut = useUpdateAppointment();
  const { data: services } = useListServices();
  const { data: team } = useListTeam();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateMut.mutateAsync({
        id: appointment.id,
        data: {
          serviceId: form.serviceId ? Number(form.serviceId) : undefined,
          assignedUserId: form.assignedUserId ? Number(form.assignedUserId) : undefined,
          scheduledStart: new Date(form.scheduledStart).toISOString(),
          scheduledEnd: form.scheduledEnd ? new Date(form.scheduledEnd).toISOString() : undefined,
          status: form.status as any,
          notes: form.notes || undefined,
          price: form.price ? Number(form.price) : undefined,
        },
      });
      qc.invalidateQueries({ queryKey: [`/api/customers/${customerId}`] });
      toast({ title: 'Appointment updated' });
      onClose();
    } catch {
      toast({ title: 'Error updating appointment', variant: 'destructive' });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-lg p-6">
        <h2 className="text-xl font-bold mb-6">Edit Appointment</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Service</label>
              <select className="w-full h-11 px-3 rounded-xl border border-input bg-background text-sm" value={form.serviceId} onChange={e => setForm(f => ({ ...f, serviceId: e.target.value }))}>
                <option value="">No service selected</option>
                {services?.services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Assigned To</label>
              <select className="w-full h-11 px-3 rounded-xl border border-input bg-background text-sm" value={form.assignedUserId} onChange={e => setForm(f => ({ ...f, assignedUserId: e.target.value }))}>
                <option value="">Unassigned</option>
                {team?.members.filter(m => m.isActive).map(m => <option key={m.id} value={m.id}>{m.firstName} {m.lastName}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Start Date/Time *</label>
              <Input type="datetime-local" value={form.scheduledStart} onChange={e => setForm(f => ({ ...f, scheduledStart: e.target.value }))} required />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">End Date/Time</label>
              <Input type="datetime-local" value={form.scheduledEnd} onChange={e => setForm(f => ({ ...f, scheduledEnd: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Status</label>
              <select className="w-full h-11 px-3 rounded-xl border border-input bg-background text-sm" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                <option value="pending">Pending</option>
                <option value="confirmed">Confirmed</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Price ($)</label>
              <Input type="number" step="0.01" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} placeholder="0.00" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Notes</label>
            <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Special instructions..." />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button type="submit" className="flex-1" isLoading={updateMut.isPending}>Save Changes</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function NewAppointmentModal({ customerId, onClose }: { customerId: number; onClose: () => void }) {
  const [form, setForm] = useState({ serviceId: '', assignedUserId: '', scheduledStart: '', scheduledEnd: '', status: 'pending', notes: '', price: '' });
  const { toast } = useToast();
  const qc = useQueryClient();
  const createMut = useCreateAppointment();
  const { data: services } = useListServices();
  const { data: team } = useListTeam();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createMut.mutateAsync({
        data: {
          customerId,
          serviceId: form.serviceId ? Number(form.serviceId) : undefined,
          assignedUserId: form.assignedUserId ? Number(form.assignedUserId) : undefined,
          scheduledStart: new Date(form.scheduledStart).toISOString(),
          scheduledEnd: form.scheduledEnd ? new Date(form.scheduledEnd).toISOString() : undefined,
          status: form.status as any,
          notes: form.notes || undefined,
          price: form.price ? Number(form.price) : undefined,
        },
      });
      qc.invalidateQueries({ queryKey: [`/api/customers/${customerId}`] });
      toast({ title: 'Appointment scheduled' });
      onClose();
    } catch {
      toast({ title: 'Error creating appointment', variant: 'destructive' });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-lg p-6">
        <h2 className="text-xl font-bold mb-6">Schedule Appointment</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Service</label>
              <select className="w-full h-11 px-3 rounded-xl border border-input bg-background text-sm" value={form.serviceId} onChange={e => setForm(f => ({ ...f, serviceId: e.target.value }))}>
                <option value="">No service selected</option>
                {services?.services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Assigned To</label>
              <select className="w-full h-11 px-3 rounded-xl border border-input bg-background text-sm" value={form.assignedUserId} onChange={e => setForm(f => ({ ...f, assignedUserId: e.target.value }))}>
                <option value="">Unassigned</option>
                {team?.members.filter(m => m.isActive).map(m => <option key={m.id} value={m.id}>{m.firstName} {m.lastName}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Start Date/Time *</label>
              <Input type="datetime-local" value={form.scheduledStart} onChange={e => setForm(f => ({ ...f, scheduledStart: e.target.value }))} required />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">End Date/Time</label>
              <Input type="datetime-local" value={form.scheduledEnd} onChange={e => setForm(f => ({ ...f, scheduledEnd: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Status</label>
              <select className="w-full h-11 px-3 rounded-xl border border-input bg-background text-sm" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                <option value="pending">Pending</option>
                <option value="confirmed">Confirmed</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Price ($)</label>
              <Input type="number" step="0.01" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} placeholder="0.00" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Notes</label>
            <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Special instructions..." />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button type="submit" className="flex-1" isLoading={createMut.isPending}>Schedule</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

type InvoiceLineItemInput = { description: string; quantity: number; unitPrice: number; lineTotal: number };

function LineItemsEditor({ items, onChange }: { items: InvoiceLineItemInput[]; onChange: (items: InvoiceLineItemInput[]) => void }) {
  const addRow = () => onChange([...items, { description: '', quantity: 1, unitPrice: 0, lineTotal: 0 }]);
  const removeRow = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const update = (i: number, field: keyof InvoiceLineItemInput, val: string) => {
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
        <span className="col-span-2 text-right">Unit $</span>
        <span className="col-span-2 text-right">Total</span>
        <span className="col-span-1" />
      </div>
      {items.map((li, i) => (
        <div key={i} className="grid grid-cols-12 gap-1 items-center">
          <Input className="col-span-5 h-8 text-sm" value={li.description} onChange={e => update(i, 'description', e.target.value)} placeholder="Service" required />
          <Input className="col-span-2 h-8 text-sm text-center" type="number" min="0.01" step="0.01" value={li.quantity} onChange={e => update(i, 'quantity', e.target.value)} />
          <Input className="col-span-2 h-8 text-sm text-right" type="number" min="0" step="0.01" value={li.unitPrice} onChange={e => update(i, 'unitPrice', e.target.value)} />
          <div className="col-span-2 text-right text-xs font-medium pr-1">${li.lineTotal.toFixed(2)}</div>
          <button type="button" onClick={() => removeRow(i)} className="col-span-1 flex justify-center text-muted-foreground hover:text-destructive text-xs">✕</button>
        </div>
      ))}
      <button type="button" onClick={addRow} className="text-xs text-primary underline underline-offset-2 hover:opacity-80">+ Add Line Item</button>
    </div>
  );
}

function NewInvoiceModal({ customerId, onClose }: { customerId: number; onClose: () => void }) {
  const [lineItems, setLineItems] = useState<InvoiceLineItemInput[]>([{ description: '', quantity: 1, unitPrice: 0, lineTotal: 0 }]);
  const [tax, setTax] = useState('0');
  const [notes, setNotes] = useState('');
  const [dueDate, setDueDate] = useState('');
  const { toast } = useToast();
  const qc = useQueryClient();
  const createMut = useCreateInvoice();

  const subtotal = lineItems.reduce((s, li) => s + li.lineTotal, 0);
  const taxNum = Number(tax) || 0;
  const total = subtotal + taxNum;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lineItems.every(li => !li.description)) {
      toast({ title: 'Add at least one line item', variant: 'destructive' }); return;
    }
    try {
      const payload: CreateInvoiceRequest = {
        customerId,
        subtotal,
        tax: taxNum,
        total,
        lineItems,
        notes: notes || undefined,
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
      };
      await createMut.mutateAsync({ data: payload });
      qc.invalidateQueries({ queryKey: [`/api/customers/${customerId}`] });
      toast({ title: 'Invoice created' });
      onClose();
    } catch {
      toast({ title: 'Error creating invoice', variant: 'destructive' });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-6">New Invoice</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Line Items *</label>
            <div className="border border-border rounded-xl p-3">
              <LineItemsEditor items={lineItems} onChange={setLineItems} />
            </div>
          </div>
          <div className="flex justify-end gap-4 text-sm">
            <div className="text-muted-foreground">Subtotal: <span className="font-semibold text-foreground">${subtotal.toFixed(2)}</span></div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Tax ($):</span>
              <Input type="number" step="0.01" min="0" value={tax} onChange={e => setTax(e.target.value)} className="w-16 h-7 text-sm text-right" />
            </div>
            <div className="font-bold">Total: ${total.toFixed(2)}</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Due Date</label>
              <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Notes</label>
              <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes..." />
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

type Tab = 'overview' | 'appointments' | 'invoices' | 'properties';

export function CustomerDetailPage() {
  const [, params] = useRoute('/customers/:id');
  const [, setLocation] = useLocation();
  const id = Number(params?.id);
  const { data, isLoading, error } = useGetCustomer(id);
  const { toast } = useToast();
  const qc = useQueryClient();

  const [tab, setTab] = useState<Tab>('overview');
  const [showEdit, setShowEdit] = useState(false);
  const [showAddProperty, setShowAddProperty] = useState(false);
  const [showNewAppt, setShowNewAppt] = useState(false);
  const [showNewInvoice, setShowNewInvoice] = useState(false);
  const [editingAppt, setEditingAppt] = useState<any>(null);

  const deleteMut = useDeleteCustomer();
  const deletePropertyMut = useDeleteProperty();
  const completeApptMut = useCompleteAppointment();
  const deleteApptMut = useDeleteAppointment();
  const markPaidMut = useMarkInvoicePaid();
  const deleteInvoiceMut = useDeleteInvoice();
  const [sendingInvite, setSendingInvite] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [togglingAutopay, setTogglingAutopay] = useState(false);
  const [removingCard, setRemovingCard] = useState(false);

  const handleSendPortalInvite = async () => {
    if (!customer.phone) {
      toast({ title: 'Customer has no phone number', description: 'Add a phone number first to send a portal invite', variant: 'destructive' });
      return;
    }
    setSendingInvite(true);
    try {
      const res = await fetch('/api/portal/auth/send-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('greensync_token')}` },
        body: JSON.stringify({ customerId: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to send invite');
      setInviteUrl(data.portalUrl);
      toast({ title: 'Portal invite sent!', description: `Invite link sent via SMS to ${customer.phone}` });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSendingInvite(false);
    }
  };

  if (isLoading) return (
    <AppLayout>
      <div className="flex h-[50vh] items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    </AppLayout>
  );

  if (error || !data) return (
    <AppLayout>
      <div className="p-8 text-center">
        <p className="text-destructive mb-4">Customer not found.</p>
        <Link href="/customers"><Button variant="outline"><ArrowLeft className="w-4 h-4 mr-2" />Back to Customers</Button></Link>
      </div>
    </AppLayout>
  );

  const { customer, properties, recentAppointments, recentInvoices } = data;
  const fullName = [customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.phone || 'Customer';
  const initials = customer.firstName?.[0] || customer.phone?.[0] || 'C';
  const totalRevenue = recentInvoices.filter(i => i.status === 'paid').reduce((s, i) => s + Number(i.total), 0);
  const outstandingBalance = recentInvoices.filter(i => ['sent', 'overdue'].includes(i.status)).reduce((s, i) => s + Number(i.total), 0);

  const handleDeleteCustomer = async () => {
    if (!confirm(`Delete ${fullName}? This cannot be undone.`)) return;
    await deleteMut.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: getListCustomersQueryKey() });
    toast({ title: 'Customer deleted' });
    setLocation('/customers');
  };

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'appointments', label: 'Appointments', count: recentAppointments.length },
    { id: 'invoices', label: 'Invoices', count: recentInvoices.length },
    { id: 'properties', label: 'Properties', count: properties.length },
  ];

  return (
    <AppLayout>
      {showEdit && <EditCustomerModal customer={customer} onClose={() => setShowEdit(false)} />}
      {showAddProperty && <AddPropertyModal customerId={id} onClose={() => setShowAddProperty(false)} />}
      {showNewAppt && <NewAppointmentModal customerId={id} onClose={() => setShowNewAppt(false)} />}
      {editingAppt && <EditAppointmentModal appointment={editingAppt} customerId={id} onClose={() => setEditingAppt(null)} />}
      {showNewInvoice && <NewInvoiceModal customerId={id} onClose={() => setShowNewInvoice(false)} />}
      {inviteUrl && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                <ExternalLink className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <h3 className="font-bold text-lg">Invite Sent!</h3>
                <p className="text-sm text-muted-foreground">Sent via SMS to {customer.phone}</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-3">You can also share this link directly with your customer:</p>
            <div className="flex gap-2">
              <input readOnly value={inviteUrl} className="flex-1 text-xs border border-border rounded-lg px-3 py-2 bg-muted/50 font-mono truncate" />
              <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(inviteUrl); toast({ title: 'Link copied!' }); }} className="shrink-0">
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            <Button className="w-full mt-4" onClick={() => setInviteUrl(null)}>Done</Button>
          </div>
        </div>
      )}

      {/* Back link */}
      <Link href="/customers" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
        <ArrowLeft className="w-4 h-4" />Back to Customers
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-6 mb-8">
        <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center text-primary font-bold text-3xl shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl font-display font-bold text-foreground">{fullName}</h1>
          <div className="flex flex-wrap gap-3 mt-2">
            {customer.email && (
              <a href={`mailto:${customer.email}`} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors">
                <Mail className="w-4 h-4" />{customer.email}
              </a>
            )}
            {customer.phone && (
              <a href={`tel:${customer.phone}`} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors">
                <Phone className="w-4 h-4" />{customer.phone}
              </a>
            )}
            {customer.addressLine1 && (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="w-4 h-4" />{customer.addressLine1}{customer.city ? `, ${customer.city}` : ''}
              </span>
            )}
          </div>
          {customer.notes && (
            <p className="text-sm text-muted-foreground mt-2 italic">{customer.notes}</p>
          )}
          {customer.tags && customer.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {customer.tags.map(tag => (
                <span key={tag} className="flex items-center gap-1 px-2 py-0.5 bg-primary/10 text-primary rounded-full text-xs font-medium">
                  <Tag className="w-2.5 h-2.5" />{tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2 shrink-0 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleSendPortalInvite} isLoading={sendingInvite}>
            <ExternalLink className="w-4 h-4 mr-2" />Portal Invite
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowEdit(true)}>
            <Edit2 className="w-4 h-4 mr-2" />Edit
          </Button>
          <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10" onClick={handleDeleteCustomer} isLoading={deleteMut.isPending}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Revenue', value: formatCurrency(totalRevenue), color: 'text-green-600' },
          { label: 'Outstanding', value: formatCurrency(outstandingBalance), color: 'text-orange-600' },
          { label: 'Appointments', value: recentAppointments.length.toString(), color: 'text-blue-600' },
          { label: 'Properties', value: properties.length.toString(), color: 'text-purple-600' },
        ].map(stat => (
          <Card key={stat.label} className="border-border/50">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              <p className={`text-xl font-bold mt-1 ${stat.color}`}>{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Button size="sm" onClick={() => setShowNewAppt(true)}><Calendar className="w-4 h-4 mr-2" />New Appointment</Button>
        <Button size="sm" variant="outline" onClick={() => setShowNewInvoice(true)}><FileText className="w-4 h-4 mr-2" />New Invoice</Button>
        <Button size="sm" variant="outline" onClick={() => setShowAddProperty(true)}><MapPin className="w-4 h-4 mr-2" />Add Property</Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border mb-6">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px ${
              tab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${tab === t.id ? 'bg-primary/10' : 'bg-muted'}`}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab: Overview */}
      {tab === 'overview' && (
        <div className="grid lg:grid-cols-2 gap-6">
          <Card className="border-border/50">
            <CardContent className="p-6">
              <h3 className="font-semibold mb-4 flex items-center gap-2"><User className="w-4 h-4 text-primary" />Contact Details</h3>
              <dl className="space-y-3 text-sm">
                {[
                  { label: 'Full Name', value: fullName },
                  { label: 'Email', value: customer.email || '—' },
                  { label: 'Phone', value: customer.phone || '—' },
                  { label: 'Address', value: [customer.addressLine1, customer.city, customer.state, customer.zip].filter(Boolean).join(', ') || '—' },
                  { label: 'Customer Since', value: formatDate(customer.createdAt) },
                ].map(row => (
                  <div key={row.label} className="flex gap-4">
                    <dt className="w-32 shrink-0 text-muted-foreground">{row.label}</dt>
                    <dd className="text-foreground">{row.value}</dd>
                  </div>
                ))}
              </dl>
              <Button variant="outline" size="sm" className="mt-4" onClick={() => setShowEdit(true)}>
                <Edit2 className="w-3.5 h-3.5 mr-1.5" />Edit Contact
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardContent className="p-6">
              <h3 className="font-semibold mb-4 flex items-center gap-2"><MapPin className="w-4 h-4 text-primary" />Properties</h3>
              {properties.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">
                  <MapPin className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No properties on file</p>
                  <Button size="sm" variant="outline" className="mt-3" onClick={() => setShowAddProperty(true)}>
                    <Plus className="w-3.5 h-3.5 mr-1.5" />Add Property
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {properties.map(p => (
                    <div key={p.id} className="flex items-start gap-3 p-3 rounded-xl bg-accent/40">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                        <Home className="w-4 h-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{p.propertyName || p.addressLine1}</p>
                        <p className="text-xs text-muted-foreground">{[p.addressLine1, p.city, p.state].filter(Boolean).join(', ')}</p>
                        {p.gateNotes && <p className="text-xs text-amber-600 mt-0.5">🔑 {p.gateNotes}</p>}
                      </div>
                      <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10 shrink-0" onClick={async () => {
                        if (!confirm('Delete this property?')) return;
                        await deletePropertyMut.mutateAsync({ id: p.id });
                        qc.invalidateQueries({ queryKey: [`/api/customers/${id}`] });
                        toast({ title: 'Property deleted' });
                      }}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" className="w-full mt-1" onClick={() => setShowAddProperty(true)}>
                    <Plus className="w-3.5 h-3.5 mr-1.5" />Add Another Property
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tab: Overview — Payment & Autopay */}
      {tab === 'overview' && (
        <Card className="border-border/50 mt-6">
          <CardContent className="p-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2"><CreditCard className="w-4 h-4 text-primary" />Payment & Autopay</h3>
            {customer.stripePaymentMethodId ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-xl">
                  <CreditCard className="w-5 h-5 text-green-600" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-green-800">Card on file</p>
                    <p className="text-xs text-green-600">Saved payment method ready for autopay</p>
                  </div>
                  <Button size="sm" variant="ghost" className="text-destructive" isLoading={removingCard} onClick={async () => {
                    if (!confirm('Remove saved card?')) return;
                    setRemovingCard(true);
                    try {
                      const res = await fetch(`/api/autopay/customers/${id}/payment-method`, { method: 'DELETE', headers: { Authorization: `Bearer ${localStorage.getItem('greensync_token')}` } });
                      if (!res.ok) throw new Error();
                      qc.invalidateQueries({ queryKey: [`/api/customers/${id}`] });
                      toast({ title: 'Card removed' });
                    } catch { toast({ title: 'Error removing card', variant: 'destructive' }); }
                    finally { setRemovingCard(false); }
                  }}>Remove</Button>
                </div>
                <div className="flex items-center justify-between p-3 bg-accent/40 rounded-xl">
                  <div>
                    <p className="text-sm font-medium flex items-center gap-2"><Zap className="w-4 h-4 text-primary" />Autopay</p>
                    <p className="text-xs text-muted-foreground">Automatically charge invoices when due</p>
                  </div>
                  <Button size="sm" variant={customer.autopayEnabled === 'true' ? 'default' : 'outline'} isLoading={togglingAutopay} onClick={async () => {
                    setTogglingAutopay(true);
                    try {
                      const res = await fetch(`/api/autopay/customers/${id}/autopay`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('greensync_token')}` },
                        body: JSON.stringify({ enabled: customer.autopayEnabled !== 'true' }),
                      });
                      if (!res.ok) throw new Error((await res.json()).message);
                      qc.invalidateQueries({ queryKey: [`/api/customers/${id}`] });
                      toast({ title: customer.autopayEnabled === 'true' ? 'Autopay disabled' : 'Autopay enabled' });
                    } catch (err: any) { toast({ title: 'Error', description: err.message, variant: 'destructive' }); }
                    finally { setTogglingAutopay(false); }
                  }}>{customer.autopayEnabled === 'true' ? 'On' : 'Off'}</Button>
                </div>
              </div>
            ) : (
              <div className="text-center py-4 text-muted-foreground">
                <CreditCard className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No saved payment method</p>
                <p className="text-xs mt-1">Customer can add a card via the customer portal</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tab: Appointments */}
      {tab === 'appointments' && (
        <Card className="border-border/50 overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-3">
              <p className="text-sm font-medium text-muted-foreground">{recentAppointments.length} appointment{recentAppointments.length !== 1 ? 's' : ''}</p>
              <Link href="/appointments" className="text-xs text-primary hover:underline flex items-center gap-0.5">See all <ExternalLink className="w-3 h-3" /></Link>
            </div>
            <Button size="sm" onClick={() => setShowNewAppt(true)}><Plus className="w-4 h-4 mr-1.5" />Schedule</Button>
          </div>
          {recentAppointments.length === 0 ? (
            <div className="p-12 text-center">
              <Calendar className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground mb-4">No appointments yet</p>
              <Button onClick={() => setShowNewAppt(true)}><Plus className="w-4 h-4 mr-2" />Schedule First Appointment</Button>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {recentAppointments.map(appt => (
                <div key={appt.id} className="p-4 hover:bg-accent/30 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-sm">{appt.serviceName || 'No service'}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {format(new Date(appt.scheduledStart), 'EEEE, MMM d yyyy · h:mm a')}
                    </p>
                    {appt.notes && <p className="text-xs text-muted-foreground italic mt-0.5">{appt.notes}</p>}
                  </div>
                  <div className="flex items-center gap-2 sm:ml-auto">
                    <AppointmentStatusBadge status={appt.status} />
                    {appt.price && <span className="text-sm font-medium">{formatCurrency(Number(appt.price))}</span>}
                    <Button size="sm" variant="ghost" onClick={() => setEditingAppt(appt)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    {appt.status !== 'completed' && appt.status !== 'cancelled' && (
                      <Button size="sm" variant="outline" className="text-green-600 border-green-200 hover:bg-green-50" onClick={async () => {
                        await completeApptMut.mutateAsync({ id: appt.id, data: {} });
                        qc.invalidateQueries({ queryKey: [`/api/customers/${id}`] });
                        toast({ title: 'Job marked complete' });
                      }}>
                        <Check className="w-3.5 h-3.5 mr-1" />Complete
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={async () => {
                      if (!confirm('Delete this appointment?')) return;
                      await deleteApptMut.mutateAsync({ id: appt.id });
                      qc.invalidateQueries({ queryKey: [`/api/customers/${id}`] });
                      toast({ title: 'Appointment deleted' });
                    }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Tab: Invoices */}
      {tab === 'invoices' && (
        <Card className="border-border/50 overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-3">
              <p className="text-sm font-medium text-muted-foreground">{recentInvoices.length} invoice{recentInvoices.length !== 1 ? 's' : ''}</p>
              <Link href="/invoices" className="text-xs text-primary hover:underline flex items-center gap-0.5">See all <ExternalLink className="w-3 h-3" /></Link>
            </div>
            <Button size="sm" onClick={() => setShowNewInvoice(true)}><Plus className="w-4 h-4 mr-1.5" />New Invoice</Button>
          </div>
          {recentInvoices.length === 0 ? (
            <div className="p-12 text-center">
              <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground mb-4">No invoices yet</p>
              <Button onClick={() => setShowNewInvoice(true)}><Plus className="w-4 h-4 mr-2" />Create First Invoice</Button>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {recentInvoices.map(inv => (
                <div key={inv.id} className="p-4 hover:bg-accent/30 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-sm font-medium">{inv.invoiceNumber}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {inv.dueDate ? `Due ${format(new Date(inv.dueDate), 'MMM d, yyyy')}` : 'No due date'}
                    </p>
                    {inv.notes && <p className="text-xs text-muted-foreground italic mt-0.5">{inv.notes}</p>}
                  </div>
                  <div className="flex items-center gap-2 sm:ml-auto">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[inv.status] || 'bg-gray-100'}`}>
                      {inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
                    </span>
                    <span className="text-sm font-bold">{formatCurrency(Number(inv.total))}</span>
                    {['sent', 'overdue'].includes(inv.status) && (
                      <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={async () => {
                        await markPaidMut.mutateAsync({ id: inv.id, data: {} });
                        qc.invalidateQueries({ queryKey: [`/api/customers/${id}`] });
                        toast({ title: 'Marked as paid' });
                      }}>
                        <Check className="w-3.5 h-3.5 mr-1" />Mark Paid
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={async () => {
                      if (!confirm('Delete this invoice?')) return;
                      await deleteInvoiceMut.mutateAsync({ id: inv.id });
                      qc.invalidateQueries({ queryKey: [`/api/customers/${id}`] });
                      toast({ title: 'Invoice deleted' });
                    }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Tab: Properties */}
      {tab === 'properties' && (
        <Card className="border-border/50 overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">{properties.length} propert{properties.length !== 1 ? 'ies' : 'y'}</p>
            <Button size="sm" onClick={() => setShowAddProperty(true)}><Plus className="w-4 h-4 mr-1.5" />Add Property</Button>
          </div>
          {properties.length === 0 ? (
            <div className="p-12 text-center">
              <MapPin className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground mb-4">No properties on file</p>
              <Button onClick={() => setShowAddProperty(true)}><Plus className="w-4 h-4 mr-2" />Add Property</Button>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {properties.map(p => (
                <div key={p.id} className="p-4 hover:bg-accent/30 transition-colors flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                      <Home className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">{p.propertyName || p.addressLine1}</p>
                      <p className="text-sm text-muted-foreground">{[p.addressLine1, p.city, p.state, p.zip].filter(Boolean).join(', ')}</p>
                      {p.gateNotes && <p className="text-sm text-amber-600 mt-1">🔑 {p.gateNotes}</p>}
                      {p.yardSize && <p className="text-xs text-muted-foreground mt-0.5">Yard: {p.yardSize}</p>}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10 shrink-0" onClick={async () => {
                    if (!confirm('Delete this property?')) return;
                    await deletePropertyMut.mutateAsync({ id: p.id });
                    qc.invalidateQueries({ queryKey: [`/api/customers/${id}`] });
                    toast({ title: 'Property deleted' });
                  }}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </AppLayout>
  );
}
