import { useState, useEffect } from 'react';
import { useAdminLogin } from '@workspace/api-client-react';
import { useAuthState, ADMIN_TOKEN_KEY } from '@/hooks/use-auth-state';
import { Button, Input, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { Mail, Lock, ShieldCheck, RotateCcw } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useToast } from '@/hooks/use-toast';

export function AdminLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { adminLogin, isAdminAuthenticated, isLoading } = useAuthState();
  const { toast } = useToast();
  const loginMutation = useAdminLogin();
  const [, setLocation] = useLocation();

  // If already authenticated, go straight to the dashboard
  useEffect(() => {
    if (!isLoading && isAdminAuthenticated) {
      setLocation('/admin/dashboard');
    }
  }, [isAdminAuthenticated, isLoading, setLocation]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await loginMutation.mutateAsync({ data: { email, password } });
      adminLogin(res.token);
      toast({ title: 'Welcome, Admin!' });
    } catch {
      toast({ title: 'Login failed', description: 'Invalid credentials. Please check your email and password.', variant: 'destructive' });
    }
  };

  const clearSession = () => {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    window.location.reload();
  };

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
            <CardTitle className="text-2xl text-white">Admin Sign In</CardTitle>
            <p className="text-slate-400 text-sm">Restricted access — authorized personnel only</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1">
                <label className="text-sm font-medium pl-1 text-slate-300">Email</label>
                <Input
                  type="email"
                  placeholder="admin@goshen.com"
                  icon={<Mail className="w-5 h-5" />}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="username"
                  className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium pl-1 text-slate-300">Password</label>
                <Input
                  type="password"
                  placeholder="••••••••"
                  icon={<Lock className="w-5 h-5" />}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                />
              </div>
              <Button type="submit" className="w-full h-12 text-lg" isLoading={loginMutation.isPending}>
                Sign In to Admin Panel
              </Button>
            </form>
            <div className="mt-4 text-center text-xs text-slate-500">
              <Link href="/admin/forgot-password" className="hover:text-slate-300 transition-colors">Forgot password?</Link>
            </div>
            <div className="mt-3 text-center text-xs text-slate-500">
              <Link href="/login" className="hover:text-slate-300 transition-colors">← Back to company login</Link>
            </div>
            <div className="mt-4 border-t border-slate-800 pt-4 text-center">
              <button
                type="button"
                onClick={clearSession}
                className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-400 transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                Clear session data
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
