import { useState } from 'react';
import { useAdminListAdmins, useAdminCreateAdmin } from '@workspace/api-client-react';
import { AdminLayout } from './admin-dashboard';
import { Button, Input } from '@/components/ui';
import { Plus, Shield, Mail } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { getAdminListAdminsQueryKey } from '@workspace/api-client-react';
import { format } from 'date-fns';

export function AdminAdminsPage() {
  const { data, isLoading } = useAdminListAdmins();
  const [showNew, setShowNew] = useState(false);
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

  return (
    <AdminLayout>
      {showNew && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold text-white mb-6">New Admin User</h2>
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
              <div key={admin.id} className="flex items-center justify-between p-5 hover:bg-slate-800/50">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold">
                    {admin.firstName[0]}{admin.lastName[0]}
                  </div>
                  <div>
                    <p className="font-medium text-white">{admin.firstName} {admin.lastName}</p>
                    <p className="text-sm text-slate-400 flex items-center gap-1"><Mail className="w-3 h-3" />{admin.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {admin.lastLoginAt && <span className="text-xs text-slate-500">Last login: {format(new Date(admin.lastLoginAt), 'MMM d')}</span>}
                  <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${admin.role === 'superadmin' ? 'bg-purple-400/10 text-purple-400' : 'bg-blue-400/10 text-blue-400'}`}>
                    <Shield className="w-3 h-3" />{admin.role}
                  </span>
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
