import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { Lock, ShieldCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuthState, ADMIN_TOKEN_KEY } from '@/hooks/use-auth-state';

export function AdminChangePasswordPage() {
  const { adminUser, adminLogout } = useAuthState();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Require an admin session to reach this screen.
  useEffect(() => {
    if (!localStorage.getItem(ADMIN_TOKEN_KEY)) {
      setLocation('/admin/login');
    }
  }, [setLocation]);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirm) {
      toast({ title: 'Passwords do not match', variant: 'destructive' });
      return;
    }
    if (newPassword.length < 8) {
      toast({ title: 'Password too short', description: 'Use at least 8 characters.', variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch('/api/admin/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem(ADMIN_TOKEN_KEY)}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Could not update password');

      // Refresh admin profile so mustChangePassword flips to false, then proceed.
      await queryClient.invalidateQueries({ queryKey: ['/api/admin/auth/me'] });
      toast({ title: 'Password updated', description: 'Your new password is now active.' });
      setLocation('/admin/dashboard');
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const forced = !!(adminUser as any)?.mustChangePassword;

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900 to-slate-950" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/10 rounded-full blur-3xl -z-10" />

      <div className="w-full max-w-md relative">
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-3 text-white">
            <div className="w-12 h-12 rounded-2xl bg-primary/20 border border-primary/30 flex items-center justify-center">
              <ShieldCheck className="w-6 h-6 text-primary" />
            </div>
            <div>
              <div className="font-display font-bold text-2xl">Goshen</div>
              <div className="text-xs text-slate-400 font-medium tracking-wider uppercase">Platform Admin</div>
            </div>
          </div>
        </div>

        <Card className="border-slate-800 bg-slate-900/80 backdrop-blur-xl shadow-2xl">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-2xl text-white">Change your password</CardTitle>
            <p className="text-slate-400 text-sm mt-1">
              {forced
                ? 'For security, set a new password before continuing.'
                : 'Choose a new password for your admin account.'}
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1">
                <label className="text-sm font-medium pl-1 text-slate-300">Current Password</label>
                <Input
                  type="password"
                  placeholder="Your current password"
                  icon={<Lock className="w-5 h-5" />}
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium pl-1 text-slate-300">New Password</label>
                <Input
                  type="password"
                  placeholder="Min. 8 characters"
                  icon={<Lock className="w-5 h-5" />}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium pl-1 text-slate-300">Confirm New Password</label>
                <Input
                  type="password"
                  placeholder="Repeat new password"
                  icon={<Lock className="w-5 h-5" />}
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  required
                  autoComplete="new-password"
                  className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                />
              </div>
              <Button type="submit" className="w-full h-12 text-lg" isLoading={isLoading}>
                Update Password
              </Button>
            </form>
            <div className="mt-4 text-center text-xs text-slate-500">
              <button type="button" onClick={adminLogout} className="hover:text-slate-300 transition-colors">
                Sign out
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
