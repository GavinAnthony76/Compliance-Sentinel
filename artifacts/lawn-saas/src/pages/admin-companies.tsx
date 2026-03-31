import { useState } from 'react';
import { useAdminListCompanies, useAdminGetCompany, useAdminSuspendCompany, useAdminActivateCompany, useAdminUpdateCompanyPlan } from '@workspace/api-client-react';
import { AdminLayout } from './admin-dashboard';
import { Button, Input } from '@/components/ui';
import { Search, ChevronRight, Plus, X, Pencil, UserX, UserCheck, Trash2, UserPlus, KeyRound, FileText } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { useParams, useLocation } from 'wouter';

function adminFetch(path: string, opts: RequestInit = {}) {
  const token = localStorage.getItem('greensync_admin_token');
  return fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers ?? {}) } });
}

// ─── Create Company Modal ─────────────────────────────────────────────────────
function CreateCompanyModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [form, setForm] = useState({
    name: '', email: '', phone: '', city: '', state: '',
    plan: 'starter', ownerFirstName: '', ownerLastName: '', ownerEmail: '', ownerPassword: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const res = await adminFetch('/api/admin/companies', { method: 'POST', body: JSON.stringify(form) });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || 'Failed to create company'); }
      toast({ title: 'Company created successfully' });
      onCreated();
      onClose();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const field = (key: keyof typeof form, label: string, opts?: { type?: string; required?: boolean; placeholder?: string }) => (
    <div>
      <label className="text-xs font-medium text-slate-400">{label}{opts?.required !== false ? ' *' : ''}</label>
      <input type={opts?.type ?? 'text'} className="w-full mt-1 h-10 px-3 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-primary" placeholder={opts?.placeholder ?? label} value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} required={opts?.required !== false} />
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 rounded-2xl w-full max-w-lg border border-slate-700 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <h2 className="text-lg font-bold text-white">Create New Company</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Company Info</p>
          {field('name', 'Company Name')}
          {field('email', 'Company Email', { type: 'email' })}
          <div className="grid grid-cols-2 gap-3">
            {field('phone', 'Phone', { required: false })}
            <div>
              <label className="text-xs font-medium text-slate-400">Plan *</label>
              <select className="w-full mt-1 h-10 px-3 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:border-primary" value={form.plan} onChange={e => setForm(f => ({ ...f, plan: e.target.value }))}>
                <option value="starter">Starter ($49/mo)</option>
                <option value="growth">Growth ($99/mo)</option>
                <option value="pro">Pro ($199/mo)</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field('city', 'City', { required: false })}
            {field('state', 'State', { required: false })}
          </div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider pt-2">Owner Account</p>
          <div className="grid grid-cols-2 gap-3">
            {field('ownerFirstName', 'First Name')}
            {field('ownerLastName', 'Last Name')}
          </div>
          {field('ownerEmail', 'Owner Email', { type: 'email' })}
          {field('ownerPassword', 'Password', { type: 'password', placeholder: 'Min 8 characters' })}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 h-10 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-sm font-medium transition-colors">Cancel</button>
            <button type="submit" disabled={isLoading} className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-medium transition-colors hover:bg-primary/90 disabled:opacity-60">
              {isLoading ? 'Creating...' : 'Create Company'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Edit Company Modal ───────────────────────────────────────────────────────
function EditCompanyModal({ company, onClose, onSaved }: { company: any; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [form, setForm] = useState({
    name: company.name ?? '', email: company.email ?? '', phone: company.phone ?? '',
    city: company.city ?? '', state: company.state ?? '', address: company.address ?? '', zip: company.zip ?? '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const res = await adminFetch(`/api/admin/companies/${company.id}`, { method: 'PUT', body: JSON.stringify(form) });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || 'Failed to update company'); }
      toast({ title: 'Company updated' });
      onSaved();
      onClose();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const field = (key: keyof typeof form, label: string, opts?: { type?: string }) => (
    <div>
      <label className="text-xs font-medium text-slate-400">{label}</label>
      <input type={opts?.type ?? 'text'} className="w-full mt-1 h-10 px-3 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:border-primary" value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 rounded-2xl w-full max-w-lg border border-slate-700 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <h2 className="text-lg font-bold text-white">Edit Company</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {field('name', 'Company Name')}
          {field('email', 'Email', { type: 'email' })}
          {field('phone', 'Phone')}
          {field('address', 'Address')}
          <div className="grid grid-cols-3 gap-3">
            {field('city', 'City')}
            {field('state', 'State')}
            {field('zip', 'ZIP')}
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 h-10 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-sm font-medium transition-colors">Cancel</button>
            <button type="submit" disabled={isLoading} className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-medium transition-colors hover:bg-primary/90 disabled:opacity-60">
              {isLoading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Add User Modal ───────────────────────────────────────────────────────────
function AddUserModal({ companyId, onClose, onAdded }: { companyId: number; onClose: () => void; onAdded: () => void }) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', role: 'staff' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const res = await adminFetch(`/api/admin/companies/${companyId}/users`, { method: 'POST', body: JSON.stringify(form) });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || 'Failed to add user'); }
      toast({ title: 'User added successfully' });
      onAdded();
      onClose();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 rounded-2xl w-full max-w-md border border-slate-700">
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <h2 className="text-lg font-bold text-white">Add Staff User</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-400">First Name *</label>
              <input className="w-full mt-1 h-10 px-3 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:border-primary" value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} required />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400">Last Name *</label>
              <input className="w-full mt-1 h-10 px-3 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:border-primary" value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} required />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400">Email *</label>
            <input type="email" className="w-full mt-1 h-10 px-3 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:border-primary" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400">Password *</label>
            <input type="password" placeholder="Min 8 characters" className="w-full mt-1 h-10 px-3 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:border-primary" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required minLength={8} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400">Role</label>
            <select className="w-full mt-1 h-10 px-3 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:border-primary" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 h-10 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-sm font-medium transition-colors">Cancel</button>
            <button type="submit" disabled={isLoading} className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-medium transition-colors hover:bg-primary/90 disabled:opacity-60">
              {isLoading ? 'Adding...' : 'Add User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Reset Password Modal ─────────────────────────────────────────────────────
function ResetPasswordModal({ companyId, ownerName, onClose }: { companyId: number; ownerName: string; onClose: () => void }) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { toast({ title: 'Passwords do not match', variant: 'destructive' }); return; }
    setIsLoading(true);
    try {
      const res = await adminFetch(`/api/admin/companies/${companyId}/owner/reset-password`, { method: 'POST', body: JSON.stringify({ password }) });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || 'Failed to reset password'); }
      toast({ title: `Password reset for ${ownerName}` });
      onClose();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 rounded-2xl w-full max-w-sm border border-slate-700">
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <h2 className="text-lg font-bold text-white">Reset Owner Password</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-slate-400 text-sm">Set a new password for <strong className="text-white">{ownerName}</strong></p>
          <div>
            <label className="text-xs font-medium text-slate-400">New Password *</label>
            <input type="password" placeholder="Min 8 characters" className="w-full mt-1 h-10 px-3 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:border-primary" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400">Confirm Password *</label>
            <input type="password" placeholder="Re-enter password" className="w-full mt-1 h-10 px-3 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:border-primary" value={confirm} onChange={e => setConfirm(e.target.value)} required minLength={8} />
          </div>
          {password && confirm && password !== confirm && <p className="text-red-400 text-xs">Passwords do not match</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 h-10 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-sm font-medium transition-colors">Cancel</button>
            <button type="submit" disabled={isLoading || (!!password && !!confirm && password !== confirm)} className="flex-1 h-10 rounded-xl bg-yellow-500 text-slate-900 text-sm font-medium transition-colors hover:bg-yellow-400 disabled:opacity-60">
              {isLoading ? 'Resetting...' : 'Reset Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Constants ────────────────────────────────────────────────────────────────
const PLAN_COLORS: Record<string, string> = {
  starter: 'bg-blue-400/10 text-blue-400',
  growth: 'bg-green-400/10 text-green-400',
  pro: 'bg-purple-400/10 text-purple-400',
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-400/10 text-green-400',
  trialing: 'bg-yellow-400/10 text-yellow-400',
  past_due: 'bg-red-400/10 text-red-400',
  canceled: 'bg-slate-600 text-slate-400',
};

// ─── Companies List Page ──────────────────────────────────────────────────────
export function AdminCompaniesPage() {
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const { data, isLoading, refetch } = useAdminListCompanies({ search: search || undefined, plan: planFilter || undefined, status: statusFilter || undefined, page: 1, limit: 50 } as any);
  const [, setLocation] = useLocation();

  return (
    <AdminLayout>
      {showCreate && <CreateCompanyModal onClose={() => setShowCreate(false)} onCreated={() => refetch()} />}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Companies</h1>
          <p className="text-slate-400 text-sm mt-1">{data?.total ?? 0} total companies</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors">
          <Plus className="w-4 h-4" />New Company
        </button>
      </div>

      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input className="w-full h-11 pl-10 pr-4 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-primary" placeholder="Search companies..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-2 flex-wrap">
          {(['', 'starter', 'growth', 'pro'] as const).map(p => (
            <button key={p} onClick={() => setPlanFilter(p)} className={`px-3 py-2 rounded-xl text-sm font-medium transition-all ${planFilter === p ? 'bg-primary text-white' : 'bg-slate-800 border border-slate-700 text-slate-400 hover:text-white'}`}>
              {p ? p.charAt(0).toUpperCase() + p.slice(1) : 'All Plans'}
            </button>
          ))}
          <select
            className="h-11 px-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-400 text-sm focus:outline-none focus:border-primary"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
          >
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="trialing">Trialing</option>
            <option value="past_due">Past Due</option>
            <option value="canceled">Canceled</option>
          </select>
        </div>
      </div>

      <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
        ) : data?.companies.length === 0 ? (
          <div className="py-20 text-center text-slate-400">No companies found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left p-4 text-sm font-medium text-slate-400">Company</th>
                  <th className="text-left p-4 text-sm font-medium text-slate-400">Owner</th>
                  <th className="text-left p-4 text-sm font-medium text-slate-400">Plan</th>
                  <th className="text-left p-4 text-sm font-medium text-slate-400">Status</th>
                  <th className="text-left p-4 text-sm font-medium text-slate-400">Customers</th>
                  <th className="text-left p-4 text-sm font-medium text-slate-400">Joined</th>
                  <th className="text-right p-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {data?.companies.map((company: any) => (
                  <tr key={company.id} className="hover:bg-slate-800/50 transition-colors cursor-pointer" onClick={() => setLocation(`/admin/companies/${company.id}`)}>
                    <td className="p-4">
                      <div className="font-medium text-white">{company.name}</div>
                      <div className="text-xs text-slate-500">{company.email || company.slug}</div>
                    </td>
                    <td className="p-4 text-sm text-slate-300">{company.ownerName || '—'}</td>
                    <td className="p-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${PLAN_COLORS[company.subscriptionPlan] || 'bg-slate-700 text-slate-400'}`}>
                        {company.subscriptionPlan || 'None'}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[company.subscriptionStatus] || 'bg-slate-700 text-slate-400'}`}>
                        {company.subscriptionStatus || 'No sub'}
                      </span>
                    </td>
                    <td className="p-4 text-sm text-slate-400">{company.customersCount}</td>
                    <td className="p-4 text-sm text-slate-400">{format(new Date(company.createdAt), 'MMM d, yyyy')}</td>
                    <td className="p-4 text-right">
                      <ChevronRight className="w-4 h-4 text-slate-400 ml-auto" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

// ─── Company Detail Page ──────────────────────────────────────────────────────
export function AdminCompanyDetailPage() {
  const params = useParams<{ id: string }>();
  const { data, isLoading, refetch } = useAdminGetCompany(Number(params.id));
  const { toast } = useToast();
  const qc = useQueryClient();
  const suspendMut = useAdminSuspendCompany();
  const activateMut = useAdminActivateCompany();
  const planMut = useAdminUpdateCompanyPlan();
  const [, setLocation] = useLocation();

  const [showEdit, setShowEdit] = useState(false);
  const [showAddUser, setShowAddUser] = useState(false);
  const [showResetPw, setShowResetPw] = useState(false);
  const [togglingUser, setTogglingUser] = useState<number | null>(null);
  const [deletingUser, setDeletingUser] = useState<number | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [savingNotes, setSavingNotes] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: [`/api/admin/companies/${params.id}`] });
    refetch();
  };

  const handleToggleUser = async (userId: number) => {
    setTogglingUser(userId);
    try {
      const res = await adminFetch(`/api/admin/companies/${params.id}/users/${userId}/toggle`, { method: 'PUT' });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || 'Failed to toggle user'); }
      const result = await res.json();
      toast({ title: result.isActive ? 'User activated' : 'User deactivated' });
      invalidate();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setTogglingUser(null);
    }
  };

  const handleDeleteUser = async (userId: number, userName: string) => {
    if (!confirm(`Delete user "${userName}"? This cannot be undone.`)) return;
    setDeletingUser(userId);
    try {
      const res = await adminFetch(`/api/admin/companies/${params.id}/users/${userId}`, { method: 'DELETE' });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || 'Failed to delete user'); }
      toast({ title: 'User deleted' });
      invalidate();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setDeletingUser(null);
    }
  };

  const handleSaveNotes = async () => {
    setSavingNotes(true);
    try {
      const res = await adminFetch(`/api/admin/companies/${params.id}/notes`, { method: 'PUT', body: JSON.stringify({ notes }) });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message); }
      toast({ title: 'Notes saved' });
      invalidate();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSavingNotes(false);
    }
  };

  if (isLoading) return <AdminLayout><div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div></AdminLayout>;
  if (!data?.company) return <AdminLayout><div className="text-slate-400 py-20 text-center">Company not found</div></AdminLayout>;

  const { company, users, recentActivity } = data;
  const currentNotes = notes !== null ? notes : (company.internalNotes ?? '');

  return (
    <AdminLayout>
      {showEdit && <EditCompanyModal company={company} onClose={() => setShowEdit(false)} onSaved={invalidate} />}
      {showAddUser && <AddUserModal companyId={company.id} onClose={() => setShowAddUser(false)} onAdded={invalidate} />}
      {showResetPw && <ResetPasswordModal companyId={company.id} ownerName={company.ownerName ?? 'Owner'} onClose={() => setShowResetPw(false)} />}

      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <button onClick={() => setLocation('/admin/companies')} className="text-slate-400 hover:text-white text-sm">← Back</button>
        <h1 className="text-2xl font-bold text-white">{company.name}</h1>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${company.isActive ? 'bg-green-400/10 text-green-400' : 'bg-red-400/10 text-red-400'}`}>
          {company.isActive ? 'Active' : 'Suspended'}
        </span>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${PLAN_COLORS[company.subscriptionPlan] ?? 'bg-slate-700 text-slate-400'}`}>
          {company.subscriptionPlan}
        </span>
        <div className="ml-auto flex gap-2">
          <button onClick={() => setShowResetPw(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-yellow-400 hover:bg-slate-700 text-xs font-medium transition-colors">
            <KeyRound className="w-3.5 h-3.5" />Reset PW
          </button>
          <button onClick={() => setShowEdit(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-white text-xs font-medium transition-colors">
            <Pencil className="w-3.5 h-3.5" />Edit Info
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Stats row */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Customers', value: company.customersCount },
              { label: 'Appointments', value: company.appointmentsCount },
              { label: 'Invoices', value: company.invoicesTotal ?? 0 },
              { label: 'Revenue', value: `$${Number(company.revenue ?? 0).toLocaleString()}` },
            ].map(s => (
              <div key={s.label} className="bg-slate-900 rounded-xl border border-slate-800 p-4 text-center">
                <p className="text-white text-xl font-bold">{s.value}</p>
                <p className="text-slate-400 text-xs mt-1">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Company info */}
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
            <h2 className="font-bold text-white mb-4">Company Info</h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              {([
                ['Email', company.email],
                ['Phone', company.phone],
                ['Address', company.address],
                ['City / State', [company.city, company.state].filter(Boolean).join(', ')],
                ['Owner', company.ownerName],
                ['Owner Email', company.ownerEmail],
                ['Subscription', company.subscriptionStatus],
                ['Joined', format(new Date(company.createdAt), 'MMM d, yyyy')],
              ] as [string, any][]).map(([k, v]) => (
                <div key={k}>
                  <span className="text-slate-400">{k}: </span>
                  <span className="text-white capitalize">{v ?? '—'}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Users */}
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-white">Users ({users?.length ?? 0})</h2>
              <button onClick={() => setShowAddUser(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 text-xs font-medium transition-colors">
                <UserPlus className="w-3.5 h-3.5" />Add User
              </button>
            </div>
            <div className="space-y-1">
              {users?.map((u: any) => (
                <div key={u.id} className="flex items-center justify-between py-2.5 px-2 rounded-lg hover:bg-slate-800/60 transition-colors">
                  <div>
                    <span className="text-white text-sm font-medium">{u.firstName} {u.lastName}</span>
                    <span className="text-slate-400 text-xs ml-2">{u.email}</span>
                    {u.lastLoginAt && <span className="text-slate-600 text-xs ml-2">· last login {format(new Date(u.lastLoginAt), 'MMM d')}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${u.role === 'owner' ? 'bg-purple-400/10 text-purple-400' : 'bg-slate-700 text-slate-400'}`}>{u.role}</span>
                    {!u.isActive && <span className="px-2 py-0.5 rounded-full text-xs bg-red-400/10 text-red-400">Inactive</span>}
                    {u.role !== 'owner' && (
                      <>
                        <button onClick={() => handleToggleUser(u.id)} disabled={togglingUser === u.id} title={u.isActive ? 'Deactivate' : 'Activate'} className="p-1.5 rounded-lg text-slate-400 hover:text-yellow-400 hover:bg-slate-700 transition-colors disabled:opacity-50">
                          {u.isActive ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                        </button>
                        <button onClick={() => handleDeleteUser(u.id, `${u.firstName} ${u.lastName}`)} disabled={deletingUser === u.id} title="Delete user" className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-700 transition-colors disabled:opacity-50">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {(!users || users.length === 0) && <p className="text-slate-500 text-sm text-center py-4">No users found</p>}
            </div>
          </div>

          {/* Internal notes */}
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-4 h-4 text-slate-400" />
              <h2 className="font-bold text-white">Internal Notes</h2>
              <span className="text-slate-500 text-xs">(admin-only)</span>
            </div>
            <textarea
              className="w-full h-28 px-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-primary resize-none"
              placeholder="Add internal notes about this company..."
              value={currentNotes}
              onChange={e => setNotes(e.target.value)}
            />
            <div className="flex justify-end mt-2">
              <button onClick={handleSaveNotes} disabled={savingNotes} className="px-4 py-2 bg-primary text-white text-xs font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-60">
                {savingNotes ? 'Saving...' : 'Save Notes'}
              </button>
            </div>
          </div>
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
            <h2 className="font-bold text-white mb-3 text-sm">Actions</h2>
            <div className="space-y-2">
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Change Plan</label>
                <select className="w-full h-9 px-3 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm" value={company.subscriptionPlan || ''} onChange={async (e) => {
                  if (!e.target.value) return;
                  await planMut.mutateAsync({ id: company.id, data: { plan: e.target.value as any } });
                  invalidate();
                  toast({ title: 'Plan updated' });
                }}>
                  <option value="">Select plan...</option>
                  <option value="starter">Starter ($49)</option>
                  <option value="growth">Growth ($99)</option>
                  <option value="pro">Pro ($199)</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Subscription Status</label>
                <select className="w-full h-9 px-3 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm" value={company.subscriptionStatus || ''} onChange={async (e) => {
                  if (!e.target.value) return;
                  await adminFetch(`/api/admin/companies/${company.id}`, { method: 'PUT', body: JSON.stringify({ subscriptionStatus: e.target.value }) });
                  invalidate();
                  toast({ title: 'Status updated' });
                }}>
                  <option value="">Current: {company.subscriptionStatus || '—'}</option>
                  <option value="active">Active</option>
                  <option value="trialing">Trialing</option>
                  <option value="past_due">Past Due</option>
                  <option value="canceled">Canceled</option>
                </select>
              </div>
              {company.isActive ? (
                <Button size="sm" variant="destructive" className="w-full" onClick={async () => {
                  await suspendMut.mutateAsync({ id: company.id });
                  invalidate();
                  toast({ title: 'Company suspended' });
                }}>Suspend Company</Button>
              ) : (
                <Button size="sm" className="w-full" onClick={async () => {
                  await activateMut.mutateAsync({ id: company.id });
                  invalidate();
                  toast({ title: 'Company activated' });
                }}>Activate Company</Button>
              )}
            </div>
          </div>

          <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
            <h2 className="font-bold text-white mb-3 text-sm">Recent Activity</h2>
            <div className="space-y-2">
              {recentActivity?.slice(0, 6).map((log: any) => (
                <div key={log.id} className="text-xs">
                  <span className="text-slate-300 break-all">{log.action}</span>
                  <span className="text-slate-500 block">{format(new Date(log.createdAt), 'MMM d, h:mm a')}</span>
                </div>
              ))}
              {(!recentActivity || recentActivity.length === 0) && <p className="text-slate-500 text-xs">No recent activity</p>}
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
