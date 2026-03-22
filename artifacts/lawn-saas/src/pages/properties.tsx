import { useState } from 'react';
import { useListProperties, useCreateProperty, useUpdateProperty, useDeleteProperty, useListCustomers } from '@workspace/api-client-react';
import { AppLayout } from '@/components/layout';
import { Card, Button, Input } from '@/components/ui';
import { Plus, MapPin } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { getListPropertiesQueryKey } from '@workspace/api-client-react';

function PropertyModal({ property, onClose }: { property?: any; onClose: () => void }) {
  const [form, setForm] = useState({
    customerId: property?.customerId ?? '',
    propertyName: property?.propertyName ?? '',
    addressLine1: property?.addressLine1 ?? '',
    city: property?.city ?? '',
    state: property?.state ?? '',
    zip: property?.zip ?? '',
    gateNotes: property?.gateNotes ?? '',
    yardSize: property?.yardSize ?? '',
    propertyNotes: property?.propertyNotes ?? '',
  });
  const { toast } = useToast();
  const qc = useQueryClient();
  const createMut = useCreateProperty();
  const updateMut = useUpdateProperty();
  const { data: customers } = useListCustomers({ page: 1, limit: 100 } as any);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = { ...form, customerId: Number(form.customerId) };
    try {
      if (property?.id) {
        await updateMut.mutateAsync({ id: property.id, data });
        toast({ title: 'Property updated' });
      } else {
        await createMut.mutateAsync({ data });
        toast({ title: 'Property created' });
      }
      qc.invalidateQueries({ queryKey: getListPropertiesQueryKey() });
      onClose();
    } catch {
      toast({ title: 'Error saving property', variant: 'destructive' });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-lg p-6">
        <h2 className="text-xl font-bold mb-6">{property?.id ? 'Edit Property' : 'New Property'}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Customer *</label>
            <select className="w-full mt-1 h-11 px-3 rounded-xl border border-input bg-background text-sm" value={form.customerId} onChange={e => setForm(f => ({ ...f, customerId: e.target.value }))} required>
              <option value="">Select customer...</option>
              {customers?.customers.map(c => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">Property Name</label>
            <Input className="mt-1" value={form.propertyName} onChange={e => setForm(f => ({ ...f, propertyName: e.target.value }))} placeholder="e.g. Main Residence, Rental Property" />
          </div>
          <div>
            <label className="text-sm font-medium">Street Address *</label>
            <Input className="mt-1" value={form.addressLine1} onChange={e => setForm(f => ({ ...f, addressLine1: e.target.value }))} placeholder="123 Oak Street" required />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1"><label className="text-sm font-medium">City</label><Input className="mt-1" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder="Austin" /></div>
            <div><label className="text-sm font-medium">State</label><Input className="mt-1" value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} placeholder="TX" /></div>
            <div><label className="text-sm font-medium">ZIP</label><Input className="mt-1" value={form.zip} onChange={e => setForm(f => ({ ...f, zip: e.target.value }))} placeholder="78701" /></div>
          </div>
          <div>
            <label className="text-sm font-medium">Gate Notes / Access</label>
            <Input className="mt-1" value={form.gateNotes} onChange={e => setForm(f => ({ ...f, gateNotes: e.target.value }))} placeholder="Gate code, dog in backyard, etc." />
          </div>
          <div>
            <label className="text-sm font-medium">Yard Size</label>
            <Input className="mt-1" value={form.yardSize} onChange={e => setForm(f => ({ ...f, yardSize: e.target.value }))} placeholder="e.g. 1/4 acre, small" />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button type="submit" className="flex-1" isLoading={createMut.isPending || updateMut.isPending}>Save</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function PropertiesPage() {
  const { data, isLoading } = useListProperties({} as any);
  const [editing, setEditing] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const deleteMut = useDeleteProperty();

  return (
    <AppLayout>
      {(creating || editing) && <PropertyModal property={editing} onClose={() => { setEditing(null); setCreating(false); }} />}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold">Properties</h1>
          <p className="text-muted-foreground mt-1">Customer service locations</p>
        </div>
        <Button onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-2" />Add Property</Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
      ) : (
        <Card className="border-border/50 overflow-hidden">
          {data?.properties.length === 0 ? (
            <div className="p-12 text-center">
              <MapPin className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No properties yet</h3>
              <Button onClick={() => setCreating(true)} className="mt-4"><Plus className="w-4 h-4 mr-2" />Add Property</Button>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {data?.properties.map(p => (
                <div key={p.id} className="p-4 hover:bg-accent/30 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><MapPin className="w-5 h-5 text-primary" /></div>
                    <div>
                      <div className="font-medium">{p.propertyName || p.addressLine1}</div>
                      <div className="text-sm text-muted-foreground">{[p.addressLine1, p.city, p.state].filter(Boolean).join(', ')}</div>
                      {p.gateNotes && <div className="text-xs text-amber-600 mt-0.5">🔑 {p.gateNotes}</div>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(p)}>Edit</Button>
                    <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={async () => {
                      if (!confirm('Delete property?')) return;
                      await deleteMut.mutateAsync({ id: p.id });
                      qc.invalidateQueries({ queryKey: getListPropertiesQueryKey() });
                      toast({ title: 'Property deleted' });
                    }}>Delete</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </AppLayout>
  );
}
