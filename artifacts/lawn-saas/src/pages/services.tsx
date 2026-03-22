import { useState } from 'react';
import { useListServices, useCreateService, useUpdateService, useDeleteService } from '@workspace/api-client-react';
import { AppLayout } from '@/components/layout';
import { Card, CardContent, Button, Input } from '@/components/ui';
import { Plus, Wrench, Edit2, Trash2, DollarSign, Clock, Tag } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { getListServicesQueryKey } from '@workspace/api-client-react';

function ServiceModal({ service, onClose }: { service?: any; onClose: () => void }) {
  const [form, setForm] = useState({
    name: service?.name ?? '',
    description: service?.description ?? '',
    durationMinutes: service?.durationMinutes ?? '',
    basePrice: service?.basePrice ?? '',
    category: service?.category ?? '',
    isActive: service?.isActive ?? true,
  });
  const { toast } = useToast();
  const qc = useQueryClient();
  const createMut = useCreateService();
  const updateMut = useUpdateService();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      name: form.name,
      description: form.description || undefined,
      durationMinutes: form.durationMinutes ? Number(form.durationMinutes) : undefined,
      basePrice: form.basePrice ? Number(form.basePrice) : undefined,
      category: form.category || undefined,
      isActive: form.isActive,
    };
    try {
      if (service?.id) {
        await updateMut.mutateAsync({ id: service.id, data: payload });
        toast({ title: 'Service updated' });
      } else {
        await createMut.mutateAsync({ data: payload });
        toast({ title: 'Service created' });
      }
      qc.invalidateQueries({ queryKey: getListServicesQueryKey() });
      onClose();
    } catch {
      toast({ title: 'Error saving service', variant: 'destructive' });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg shadow-2xl">
        <CardContent className="p-6">
          <h2 className="text-xl font-bold mb-6">{service?.id ? 'Edit Service' : 'New Service'}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Service Name *</label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Lawn Mowing" required />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Description</label>
              <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Brief description" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">Price ($)</label>
                <Input type="number" step="0.01" value={form.basePrice} onChange={e => setForm(f => ({ ...f, basePrice: e.target.value }))} placeholder="0.00" icon={<DollarSign className="w-4 h-4" />} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Duration (min)</label>
                <Input type="number" value={form.durationMinutes} onChange={e => setForm(f => ({ ...f, durationMinutes: e.target.value }))} placeholder="60" icon={<Clock className="w-4 h-4" />} />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Category</label>
              <Input value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} placeholder="e.g. Maintenance, Landscaping" icon={<Tag className="w-4 h-4" />} />
            </div>
            <div className="flex items-center gap-3">
              <input type="checkbox" id="isActive" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} className="w-4 h-4 accent-primary" />
              <label htmlFor="isActive" className="text-sm font-medium">Active (visible on booking page)</label>
            </div>
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
              <Button type="submit" className="flex-1" isLoading={createMut.isPending || updateMut.isPending}>Save Service</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export function ServicesPage() {
  const { data, isLoading } = useListServices();
  const [editing, setEditing] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const deleteMut = useDeleteService();

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this service?')) return;
    await deleteMut.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: getListServicesQueryKey() });
    toast({ title: 'Service deleted' });
  };

  return (
    <AppLayout>
      {(editing || creating) && (
        <ServiceModal
          service={editing}
          onClose={() => { setEditing(null); setCreating(false); }}
        />
      )}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold">Services</h1>
          <p className="text-muted-foreground mt-1">Manage your service catalog</p>
        </div>
        <Button onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-2" />Add Service</Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
      ) : data?.services.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 bg-accent rounded-full flex items-center justify-center mb-4"><Wrench className="w-8 h-8 text-muted-foreground" /></div>
          <h3 className="text-xl font-semibold mb-2">No services yet</h3>
          <p className="text-muted-foreground mb-6">Add your first service to get started</p>
          <Button onClick={() => setCreating(true)}><Plus className="w-4 h-4 mr-2" />Add Your First Service</Button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data?.services.map(service => (
            <Card key={service.id} className="hover:shadow-md transition-all border-border/50">
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Wrench className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">{service.name}</h3>
                      {service.category && <span className="text-xs text-muted-foreground">{service.category}</span>}
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${service.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                    {service.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                {service.description && <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{service.description}</p>}
                <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
                  {service.basePrice && <span className="flex items-center gap-1"><DollarSign className="w-3.5 h-3.5" />${Number(service.basePrice).toFixed(2)}</span>}
                  {service.durationMinutes && <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{service.durationMinutes} min</span>}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => setEditing(service)}>
                    <Edit2 className="w-3.5 h-3.5 mr-1" />Edit
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10" onClick={() => handleDelete(service.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </AppLayout>
  );
}
