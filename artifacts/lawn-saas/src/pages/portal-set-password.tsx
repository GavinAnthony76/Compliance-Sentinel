import { useState } from 'react';
import { useSearch } from 'wouter';
import { usePortalAuth } from '@/hooks/use-portal-auth';
import { useToast } from '@/hooks/use-toast';
import { Button, Input, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { usePageMeta } from '@/hooks/use-page-meta';
import { Lock, Leaf } from 'lucide-react';

export function PortalSetPasswordPage() {
  usePageMeta({ title: 'Set Password', noIndex: true });
  const search = useSearch();
  const params = new URLSearchParams(search);
  const token = params.get('token') || '';
  const slug = params.get('slug') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login } = usePortalAuth();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast({ title: 'Passwords do not match', variant: 'destructive' });
      return;
    }
    if (password.length < 8) {
      toast({ title: 'Password must be at least 8 characters', variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch('/api/portal/auth/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password, companySlug: slug }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to set password');
      login(data.token, { customer: data.customer, company: data.company });
      toast({ title: 'Password set!', description: 'Welcome to your customer portal.' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  if (!token || !slug) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center text-muted-foreground">
            Invalid or missing invite link. Please request a new one from your service provider.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center items-center p-4 relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/5 rounded-full blur-3xl -z-10" />
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-2 text-primary font-display font-bold text-3xl">
            <Leaf className="w-8 h-8 fill-primary" />
            Customer Portal
          </div>
        </div>
        <Card className="border-border/50 shadow-2xl shadow-black/5 bg-white/80 backdrop-blur-xl">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-2xl">Create your portal password</CardTitle>
            <p className="text-muted-foreground text-sm mt-2">Set a password to access your customer portal. You'll sign in with your phone number.</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1">
                <label className="text-sm font-medium pl-1">New Password</label>
                <Input
                  type="password"
                  placeholder="Min. 8 characters"
                  icon={<Lock className="w-5 h-5" />}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium pl-1">Confirm Password</label>
                <Input
                  type="password"
                  placeholder="Repeat password"
                  icon={<Lock className="w-5 h-5" />}
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full h-12 text-lg" isLoading={isLoading}>
                Set Password & Enter Portal
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
