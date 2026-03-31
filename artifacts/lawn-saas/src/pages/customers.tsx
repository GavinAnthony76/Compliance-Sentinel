import { useState } from 'react';
import { useListCustomers, useCreateCustomer } from '@workspace/api-client-react';
import { AppLayout } from '@/components/layout';
import { Card, Button, Input, Badge } from '@/components/ui';
import { Search, Plus, MapPin, Phone, Mail, Download, UserPlus } from 'lucide-react';
import { Link } from 'wouter';
import { formatDate } from '@/lib/utils';
import { useAuthState } from '@/hooks/use-auth-state';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { getListCustomersQueryKey } from '@workspace/api-client-react';

function usePlan() {
  const { user } = useAuthState();
  return user?.company?.subscriptionPlan ?? 'starter';
}

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

function InviteLinkDialog({ portalUrl, phone, onClose }: { portalUrl: string; phone: string; onClose: () => void }) {
  const { toast } = useToast();
  const handleCopy = () => {
    navigator.clipboard.writeText(portalUrl).then(() => toast({ title: 'Link copied!' }));
  };
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
            <UserPlus className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <h3 className="font-bold text-lg">Customer Added!</h3>
            <p className="text-sm text-muted-foreground">Portal invite sent via SMS to {phone}</p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground mb-3">You can also share this link directly with your customer:</p>
        <div className="flex gap-2">
          <input
            readOnly
            value={portalUrl}
            className="flex-1 text-xs border border-border rounded-lg px-3 py-2 bg-muted/50 font-mono truncate"
          />
          <Button variant="outline" size="sm" onClick={handleCopy} className="shrink-0">Copy</Button>
        </div>
        <Button className="w-full mt-4" onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}

function AddCustomerModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', phone: '',
    addressLine1: '', city: '', state: '', zip: '', notes: '',
  });
  const [inviteInfo, setInviteInfo] = useState<{ portalUrl: string; phone: string } | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();
  const createMut = useCreateCustomer();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const sanitized = {
        ...form,
        email: form.email || undefined,
        addressLine1: form.addressLine1 || undefined,
        city: form.city || undefined,
        state: form.state || undefined,
        zip: form.zip || undefined,
        notes: form.notes || undefined,
        tags: [] as string[],
      };
      const result: any = await createMut.mutateAsync({ data: sanitized });
      qc.invalidateQueries({ queryKey: getListCustomersQueryKey() });
      if (result?.portalUrl) {
        setInviteInfo({ portalUrl: result.portalUrl, phone: form.phone });
      } else {
        toast({ title: 'Customer added' });
        onClose();
      }
    } catch {
      toast({ title: 'Error adding customer', variant: 'destructive' });
    }
  };

  if (inviteInfo) {
    return <InviteLinkDialog portalUrl={inviteInfo.portalUrl} phone={inviteInfo.phone} onClose={onClose} />;
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-1">Add Customer</h2>
        <p className="text-sm text-muted-foreground mb-5">A portal invite will be sent via SMS. The customer can fill in the rest of their info.</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Phone Number *</label>
            <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="(555) 000-0000" icon={<Phone className="w-4 h-4" />} required minLength={7} />
            <p className="text-xs text-muted-foreground">Required — the portal invite link will be sent here</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">First Name</label>
              <Input value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} placeholder="Jane" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Last Name</label>
              <Input value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} placeholder="Smith" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Email</label>
            <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@example.com" icon={<Mail className="w-4 h-4" />} />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Street Address</label>
            <Input value={form.addressLine1} onChange={e => setForm(f => ({ ...f, addressLine1: e.target.value }))} placeholder="123 Oak St" icon={<MapPin className="w-4 h-4" />} />
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
            <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any special notes..." />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button type="submit" className="flex-1" isLoading={createMut.isPending}>Add &amp; Send Invite</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function CustomersPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showAdd, setShowAdd] = useState(false);
  const limit = 20;
  const { data, isLoading } = useListCustomers({ search: search || undefined, page, limit });
  const plan = usePlan();
  const { toast } = useToast();
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <AppLayout>
      {showAdd && <AddCustomerModal onClose={() => setShowAdd(false)} />}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Customers</h1>
          <p className="text-muted-foreground mt-1">Manage your client base and their properties.</p>
        </div>
        <div className="flex gap-2">
          {plan === 'pro' && (
            <Button variant="outline" onClick={() => downloadExport('/api/export/customers', 'customers.csv', msg => toast({ title: msg, variant: 'destructive' }))}>
              <Download className="w-4 h-4 mr-2" />Export CSV
            </Button>
          )}
          <Button onClick={() => setShowAdd(true)}><UserPlus className="w-4 h-4 mr-2" />Add Customer</Button>
        </div>
      </div>

      <Card className="overflow-hidden border-border/50">
        <div className="p-4 border-b border-border bg-card/50 flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search customers by name, email, or phone..."
              className="w-full h-10 pl-9 pr-4 rounded-lg border border-border bg-background text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <span className="text-sm text-muted-foreground hidden sm:block">{total} customer{total !== 1 ? 's' : ''}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-accent/50 text-muted-foreground font-medium border-b border-border">
              <tr>
                <th className="px-6 py-4">Name</th>
                <th className="px-6 py-4">Contact</th>
                <th className="px-6 py-4">Location</th>
                <th className="px-6 py-4">Added</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr><td colSpan={5} className="p-8 text-center"><div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full mx-auto" /></td></tr>
              ) : data?.customers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-12 text-center">
                    <div className="flex flex-col items-center">
                      <div className="w-14 h-14 rounded-full bg-accent flex items-center justify-center mb-3">
                        <UserPlus className="w-7 h-7 text-muted-foreground" />
                      </div>
                      <p className="text-muted-foreground mb-3">{search ? 'No customers match your search.' : 'No customers yet.'}</p>
                      {!search && <Button size="sm" onClick={() => setShowAdd(true)}><Plus className="w-4 h-4 mr-2" />Add Your First Customer</Button>}
                    </div>
                  </td>
                </tr>
              ) : (
                data?.customers.map(customer => (
                  <tr key={customer.id} className="bg-card hover:bg-accent/30 transition-colors group cursor-pointer" onClick={() => window.location.href = `/customers/${customer.id}`}>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                          {customer.firstName?.[0] || customer.phone?.[0] || '?'}
                        </div>
                        <div>
                          <div className="font-semibold text-foreground">
                            {[customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.phone || 'Customer'}
                          </div>
                          <div className="flex gap-1 mt-0.5">
                            {customer.tags?.slice(0, 2).map(tag => (
                              <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">{tag}</Badge>
                            ))}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground space-y-1">
                      {customer.phone && <div className="flex items-center gap-2"><Phone className="w-3 h-3" /> {customer.phone}</div>}
                      {customer.email && <div className="flex items-center gap-2"><Mail className="w-3 h-3" /> {customer.email}</div>}
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {customer.addressLine1 ? (
                        <div className="flex items-start gap-2">
                          <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                          <span className="truncate max-w-[200px]">{customer.addressLine1}{customer.city ? `, ${customer.city}` : ''}</span>
                        </div>
                      ) : '—'}
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {formatDate(customer.createdAt)}
                    </td>
                    <td className="px-6 py-4 text-right" onClick={e => e.stopPropagation()}>
                      <Link href={`/customers/${customer.id}`}>
                        <Button variant="outline" size="sm" className="opacity-0 group-hover:opacity-100 transition-opacity">View Details</Button>
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="p-4 border-t border-border bg-card/50 flex items-center justify-between text-sm text-muted-foreground">
          <div>Showing {((page - 1) * limit) + 1}–{Math.min(page * limit, total)} of {total}</div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</Button>
          </div>
        </div>
      </Card>
    </AppLayout>
  );
}
