import { useState } from 'react';
import { useSearch, Link } from 'wouter';
import { Button, Input, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { Lock, Leaf } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export function ResetPasswordPage() {
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
      const res = await fetch('/api/auth/reset-password', {
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
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center text-muted-foreground">
            Invalid reset link. <Link href="/forgot-password" className="text-primary hover:underline">Request a new one.</Link>
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
          <Link href="/" className="flex items-center gap-2 text-primary font-display font-bold text-3xl">
            <Leaf className="w-8 h-8 fill-primary" />
            GreenSync
          </Link>
        </div>
        <Card className="border-border/50 shadow-2xl shadow-black/5 bg-white/80 backdrop-blur-xl">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-2xl">Set a new password</CardTitle>
            <p className="text-muted-foreground text-sm mt-2">
              {done ? 'Your password has been updated.' : 'Choose a new password for your account.'}
            </p>
          </CardHeader>
          <CardContent>
            {!done ? (
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
                  Update Password
                </Button>
              </form>
            ) : (
              <div className="text-center py-2">
                <Link href="/login">
                  <Button className="w-full h-12 text-lg">Sign In</Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
