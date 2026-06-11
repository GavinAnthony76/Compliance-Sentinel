import { useEffect, useState } from 'react';
import { AdminLayout } from './admin-dashboard';
import { useAuthState } from '@/hooks/use-auth-state';
import { useToast } from '@/hooks/use-toast';
import { User, Lock, Save, ShieldAlert } from 'lucide-react';

function adminFetch(path: string, opts: RequestInit = {}) {
  const token = localStorage.getItem('greensync_admin_token');
  return fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers ?? {}) } });
}

export function AdminSettingsPage() {
  const { adminUser } = useAuthState();
  const { toast } = useToast();
  const [profileLoading, setProfileLoading] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);

  const [profile, setProfile] = useState({
    firstName: adminUser?.firstName ?? '',
    lastName: adminUser?.lastName ?? '',
    email: adminUser?.email ?? '',
  });

  const [passwords, setPasswords] = useState({
    newPassword: '',
    confirmPassword: '',
  });

  const [lockout, setLockout] = useState({ staleAdminDays: 90, staleAdminSweepEnabled: true });
  const [lockoutBounds, setLockoutBounds] = useState({ minStaleAdminDays: 1, maxStaleAdminDays: 3650 });
  const [lockoutLoaded, setLockoutLoaded] = useState(false);
  const [lockoutSaving, setLockoutSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await adminFetch('/api/admin/settings');
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setLockout({ staleAdminDays: data.staleAdminDays, staleAdminSweepEnabled: data.staleAdminSweepEnabled });
        if (data.bounds) setLockoutBounds(data.bounds);
      } catch {
        /* best effort */
      } finally {
        if (!cancelled) setLockoutLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleLockoutSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const days = Number(lockout.staleAdminDays);
    if (!Number.isFinite(days) || days < lockoutBounds.minStaleAdminDays || days > lockoutBounds.maxStaleAdminDays) {
      toast({ title: `Days must be between ${lockoutBounds.minStaleAdminDays} and ${lockoutBounds.maxStaleAdminDays}`, variant: 'destructive' });
      return;
    }
    setLockoutSaving(true);
    try {
      const res = await adminFetch('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({ staleAdminDays: days, staleAdminSweepEnabled: lockout.staleAdminSweepEnabled }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || 'Failed to update lockout policy'); }
      const data = await res.json();
      setLockout({ staleAdminDays: data.staleAdminDays, staleAdminSweepEnabled: data.staleAdminSweepEnabled });
      toast({ title: 'Lockout policy updated' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setLockoutSaving(false);
    }
  };

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileLoading(true);
    try {
      const res = await adminFetch(`/api/admin/admins/${adminUser?.id}`, {
        method: 'PUT',
        body: JSON.stringify({ firstName: profile.firstName, lastName: profile.lastName, email: profile.email }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || 'Failed to update profile'); }
      toast({ title: 'Profile updated successfully' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setProfileLoading(false);
    }
  };

  const handlePasswordSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwords.newPassword !== passwords.confirmPassword) {
      toast({ title: 'Passwords do not match', variant: 'destructive' });
      return;
    }
    if (passwords.newPassword.length < 8) {
      toast({ title: 'Password must be at least 8 characters', variant: 'destructive' });
      return;
    }
    setPasswordLoading(true);
    try {
      const res = await adminFetch(`/api/admin/admins/${adminUser?.id}`, {
        method: 'PUT',
        body: JSON.stringify({ password: passwords.newPassword }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || 'Failed to update password'); }
      toast({ title: 'Password updated successfully' });
      setPasswords({ newPassword: '', confirmPassword: '' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setPasswordLoading(false);
    }
  };

  const inputClass = "w-full h-11 px-4 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-primary transition-colors";
  const labelClass = "block text-sm font-medium text-slate-300 mb-1.5";

  return (
    <AdminLayout>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-slate-400 mt-1">Manage your admin account</p>
      </div>

      <div className="max-w-xl space-y-6">
        {/* Profile */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
              <User className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="font-bold text-white">Profile Information</h2>
              <p className="text-slate-400 text-xs">Update your name and email address</p>
            </div>
          </div>

          <form onSubmit={handleProfileSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>First Name</label>
                <input className={inputClass} value={profile.firstName} onChange={e => setProfile(p => ({ ...p, firstName: e.target.value }))} required />
              </div>
              <div>
                <label className={labelClass}>Last Name</label>
                <input className={inputClass} value={profile.lastName} onChange={e => setProfile(p => ({ ...p, lastName: e.target.value }))} required />
              </div>
            </div>
            <div>
              <label className={labelClass}>Email Address</label>
              <input type="email" className={inputClass} value={profile.email} onChange={e => setProfile(p => ({ ...p, email: e.target.value }))} required />
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={profileLoading}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-60"
              >
                <Save className="w-4 h-4" />
                {profileLoading ? 'Saving...' : 'Save Profile'}
              </button>
            </div>
          </form>
        </div>

        {/* Password */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-lg bg-yellow-400/10 flex items-center justify-center">
              <Lock className="w-5 h-5 text-yellow-400" />
            </div>
            <div>
              <h2 className="font-bold text-white">Change Password</h2>
              <p className="text-slate-400 text-xs">Set a new password for your admin account</p>
            </div>
          </div>

          <form onSubmit={handlePasswordSave} className="space-y-4">
            <div>
              <label className={labelClass}>New Password</label>
              <input
                type="password"
                className={inputClass}
                placeholder="Minimum 8 characters"
                value={passwords.newPassword}
                onChange={e => setPasswords(p => ({ ...p, newPassword: e.target.value }))}
                required
                minLength={8}
              />
            </div>
            <div>
              <label className={labelClass}>Confirm New Password</label>
              <input
                type="password"
                className={inputClass}
                placeholder="Re-enter new password"
                value={passwords.confirmPassword}
                onChange={e => setPasswords(p => ({ ...p, confirmPassword: e.target.value }))}
                required
                minLength={8}
              />
            </div>
            {passwords.newPassword && passwords.confirmPassword && passwords.newPassword !== passwords.confirmPassword && (
              <p className="text-red-400 text-sm">Passwords do not match</p>
            )}

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={passwordLoading}
                className="flex items-center gap-2 px-5 py-2.5 bg-yellow-500 text-slate-900 text-sm font-medium rounded-xl hover:bg-yellow-400 transition-colors disabled:opacity-60"
              >
                <Lock className="w-4 h-4" />
                {passwordLoading ? 'Updating...' : 'Update Password'}
              </button>
            </div>
          </form>
        </div>

        {/* Inactivity lockout policy */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-lg bg-red-400/10 flex items-center justify-center">
              <ShieldAlert className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <h2 className="font-bold text-white">Inactivity Lockout</h2>
              <p className="text-slate-400 text-xs">Control how long an admin can stay signed-out before being locked out</p>
            </div>
          </div>

          <form onSubmit={handleLockoutSave} className="space-y-4">
            <div>
              <label className={labelClass}>Lock out after (days of inactivity)</label>
              <input
                type="number"
                className={inputClass}
                value={lockout.staleAdminDays}
                min={lockoutBounds.minStaleAdminDays}
                max={lockoutBounds.maxStaleAdminDays}
                disabled={!lockoutLoaded}
                onChange={e => setLockout(l => ({ ...l, staleAdminDays: Number(e.target.value) }))}
                required
              />
              <p className="mt-1.5 text-xs text-slate-500">
                Admins with no sign-in for this many days (or who have never signed in) become eligible for lockout. Allowed range: {lockoutBounds.minStaleAdminDays}–{lockoutBounds.maxStaleAdminDays} days.
              </p>
            </div>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 w-4 h-4 rounded border-slate-600 bg-slate-800 text-primary focus:ring-primary"
                checked={lockout.staleAdminSweepEnabled}
                disabled={!lockoutLoaded}
                onChange={e => setLockout(l => ({ ...l, staleAdminSweepEnabled: e.target.checked }))}
              />
              <span className="text-sm text-slate-300">
                Run the automatic daily lockout sweep
                <span className="block text-xs text-slate-500">When off, inactive admins are only locked out when you click the manual button. The threshold above still applies.</span>
              </span>
            </label>

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={lockoutSaving || !lockoutLoaded}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-60"
              >
                <Save className="w-4 h-4" />
                {lockoutSaving ? 'Saving...' : 'Save Lockout Policy'}
              </button>
            </div>
          </form>
        </div>

        {/* Account info */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
          <h2 className="font-bold text-white mb-4">Account Details</h2>
          <div className="space-y-3 text-sm">
            {[
              ['Admin ID', `#${adminUser?.id}`],
              ['Role', adminUser?.role ?? '—'],
              ['Email', adminUser?.email ?? '—'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="text-slate-400">{k}</span>
                <span className="text-white capitalize">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
