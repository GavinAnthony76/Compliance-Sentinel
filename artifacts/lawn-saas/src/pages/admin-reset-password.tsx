import { useState } from 'react';
import { useSearch, Link } from 'wouter';
import { Button, Input, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { Lock, ShieldCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export function AdminResetPasswordPage() {
  const search = useSearch();
  const token = new URLSearchParams(search).get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [done, setDone] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast({ title: 'Passwords do not match', variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch('/api/admin/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Reset failed');
      setDone(true);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-slate-800 bg-slate-900/80">
          <CardContent className="pt-6 text-center text-slate-400">
            Invalid reset link. <Link href="/admin/forgot-password" className="text-primary hover:underline">Request a new one.</Link>
          </CardContent>
        </Card>
      </div>
    );
  }

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
              <div className="font-display font-bold text-2xl">GreenSynk</div>
              <div className="text-xs text-slate-400 font-medium tracking-wider uppercase">Platform Admin</div>
            </div>
          </div>
        </div>

        <Card className="border-slate-800 bg-slate-900/80 backdrop-blur-xl shadow-2xl">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-2xl text-white">Set a new password</CardTitle>
            <p className="text-slate-400 text-sm mt-1">
              {done ? 'Your password has been updated.' : 'Choose a new password for your admin account.'}
            </p>
          </CardHeader>
          <CardContent>
            {!done ? (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-1">
                  <label className="text-sm font-medium pl-1 text-slate-300">New Password</label>
                  <Input
                    type="password"
                    placeholder="Min. 8 characters"
                    icon={<Lock className="w-5 h-5" />}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    minLength={8}
                    className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium pl-1 text-slate-300">Confirm Password</label>
                  <Input
                    type="password"
                    placeholder="Repeat password"
                    icon={<Lock className="w-5 h-5" />}
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    required
                    className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                  />
                </div>
                <Button type="submit" className="w-full h-12 text-lg" isLoading={isLoading}>
                  Update Password
                </Button>
              </form>
            ) : (
              <div className="text-center py-2">
                <Link href="/admin/login">
                  <Button className="w-full h-12 text-lg">Back to Admin Login</Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
