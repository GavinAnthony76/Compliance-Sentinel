import { useState } from 'react';
import { useAdminListAdmins, useAdminCreateAdmin } from '@workspace/api-client-react';
import { AdminLayout } from './admin-dashboard';
import { Button, Input } from '@/components/ui';
import { Plus, Shield, Mail, Pencil, Trash2, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { getAdminListAdminsQueryKey } from '@workspace/api-client-react';
import { format } from 'date-fns';

function adminFetch(path: string, opts: RequestInit = {}) {
  const token = localStorage.getItem('greensync_admin_token');
  return fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers ?? {}) } });
}

function EditAdminModal({ admin, onClose, onSaved }: { admin: any; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [form, setForm] = useState({
    firstName: admin.firstName ?? '',
    lastName: admin.lastName ?? '',
    email: admin.email ?? '',
    role: admin.role ?? 'admin',
    password: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const body: any = { firstName: form.firstName, lastName: form.lastName, email: form.email, role: form.role };
      if (form.password) body.password = form.password;
      const res = await adminFetch(`/api/admin/admins/${admin.id}`, { method: 'PUT', body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || 'Failed to update admin'); }
      toast({ title: 'Admin updated' });
      onSaved();
      onClose();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <h2 className="text-xl font-bold text-white">Edit Admin</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-slate-300">First Name</label>
              <Input className="mt-1 bg-slate-800 border-slate-700 text-white" value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} required />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-300">Last Name</label>
              <Input className="mt-1 bg-slate-800 border-slate-700 text-white" value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} required />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-300">Email</label>
            <Input type="email" className="mt-1 bg-slate-800 border-slate-700 text-white" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} icon={<Mail className="w-4 h-4" />} required />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-300">New Password <span className="text-slate-500 font-normal">(leave blank to keep current)</span></label>
            <Input type="password" className="mt-1 bg-slate-800 border-slate-700 text-white" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="Min 8 characters" minLength={form.password ? 8 : undefined} />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-300">Role</label>
            <select className="w-full mt-1 h-11 px-3 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as any }))}>
              <option value="admin">Admin</option>
              <option value="superadmin">Super Admin</option>
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1 border-slate-700 text-slate-300">Cancel</Button>
            <Button type="submit" className="flex-1" isLoading={isLoading}>Save Changes</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function AdminAdminsPage() {
  const { data, isLoading, refetch } = useAdminListAdmins();
  const [showNew, setShowNew] = useState(false);
  const [editAdmin, setEditAdmin] = useState<any | null>(null);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', role: 'admin' as 'admin' | 'superadmin' });
  const { toast } = useToast();
  const qc = useQueryClient();
  const createMut = useAdminCreateAdmin();

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createMut.mutateAsync({ data: form });
      toast({ title: 'Admin created' });
      qc.invalidateQueries({ queryKey: getAdminListAdminsQueryKey() });
      setShowNew(false);
      setForm({ firstName: '', lastName: '', email: '', password: '', role: 'admin' });
    } catch (err: any) {
      toast({ title: 'Error creating admin', description: err.message, variant: 'destructive' });
    }
  };

  const handleDelete = async (admin: any) => {
    if (!confirm(`Delete admin "${admin.firstName} ${admin.lastName}"? This cannot be undone.`)) return;
    try {
      const res = await adminFetch(`/api/admin/admins/${admin.id}`, { method: 'DELETE' });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || 'Failed to delete admin'); }
      toast({ title: 'Admin deleted' });
      refetch();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  return (
    <AdminLayout>
      {showNew && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">New Admin User</h2>
              <button onClick={() => setShowNew(false)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-slate-300">First Name</label>
                  <Input className="mt-1 bg-slate-800 border-slate-700 text-white" value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} required />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-300">Last Name</label>
                  <Input className="mt-1 bg-slate-800 border-slate-700 text-white" value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} required />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-300">Email</label>
                <Input type="email" className="mt-1 bg-slate-800 border-slate-700 text-white" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} icon={<Mail className="w-4 h-4" />} required />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-300">Password</label>
                <Input type="password" className="mt-1 bg-slate-800 border-slate-700 text-white" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required minLength={8} />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-300">Role</label>
                <select className="w-full mt-1 h-11 px-3 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as any }))}>
                  <option value="admin">Admin</option>
                  <option value="superadmin">Super Admin</option>
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => setShowNew(false)} className="flex-1 border-slate-700 text-slate-300">Cancel</Button>
                <Button type="submit" className="flex-1" isLoading={createMut.isPending}>Create Admin</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editAdmin && (
        <EditAdminModal
          admin={editAdmin}
          onClose={() => setEditAdmin(null)}
          onSaved={() => { refetch(); setEditAdmin(null); }}
        />
      )}

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Admin Users</h1>
        <Button onClick={() => setShowNew(true)}><Plus className="w-4 h-4 mr-2" />New Admin</Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
      ) : (
        <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
          <div className="divide-y divide-slate-800">
            {data?.admins.map((admin: any) => (
              <div key={admin.id} className="flex items-center justify-between p-5 hover:bg-slate-800/50 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold">
                    {admin.firstName[0]}{admin.lastName[0]}
                  </div>
                  <div>
                    <p className="font-medium text-white">{admin.firstName} {admin.lastName}</p>
                    <p className="text-sm text-slate-400 flex items-center gap-1"><Mail className="w-3 h-3" />{admin.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {admin.lastLoginAt && <span className="text-xs text-slate-500">Last login: {format(new Date(admin.lastLoginAt), 'MMM d')}</span>}
                  <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${admin.role === 'superadmin' ? 'bg-purple-400/10 text-purple-400' : 'bg-blue-400/10 text-blue-400'}`}>
                    <Shield className="w-3 h-3" />{admin.role}
                  </span>
                  <button
                    onClick={() => setEditAdmin(admin)}
                    title="Edit admin"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(admin)}
                    title="Delete admin"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-700 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
            {data?.admins.length === 0 && <div className="py-20 text-center text-slate-400">No admin users found</div>}
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
