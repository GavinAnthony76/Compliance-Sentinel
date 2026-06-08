import { useState, useEffect } from 'react';
import { useParams, Link } from 'wouter';
import { usePortalAuth } from '@/hooks/use-portal-auth';
import { useToast } from '@/hooks/use-toast';
import { Button, Input, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { Mail, Phone, Lock, Leaf, Loader2 } from 'lucide-react';

type Mode = 'link' | 'password';

export function PortalLoginPage() {
  const { slug } = useParams<{ slug: string }>();
  const [mode, setMode] = useState<Mode>('link');
  const [email, setEmail] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const { login } = usePortalAuth();
  const { toast } = useToast();

  // If the customer arrived from an emailed magic link (?token=...), sign them in automatically.
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token || !slug) return;
    setVerifying(true);
    (async () => {
      try {
        const res = await fetch('/api/portal/auth/verify-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, companySlug: slug }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'This login link is invalid or expired');
        login(data.token, { customer: data.customer, company: data.company });
        toast({ title: `Welcome${data.customer.firstName ? `, ${data.customer.firstName}` : ''}!` });
      } catch (err: any) {
        toast({ title: 'Could not sign you in', description: err.message, variant: 'destructive' });
        setVerifying(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const handleRequestLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const res = await fetch('/api/portal/auth/request-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, companySlug: slug }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Could not send login link');
      setLinkSent(true);
    } catch (err: any) {
      toast({ title: 'Something went wrong', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const res = await fetch('/api/portal/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password, companySlug: slug }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Login failed');
      login(data.token, { customer: data.customer, company: data.company });
      toast({ title: `Welcome${data.customer.firstName ? `, ${data.customer.firstName}` : ''}!` });
    } catch (err: any) {
      toast({ title: 'Login failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  if (verifying) {
    return (
      <div className="min-h-screen bg-background flex flex-col justify-center items-center p-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">Signing you in…</p>
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
            <CardTitle className="text-2xl">Sign in to your portal</CardTitle>
            <p className="text-muted-foreground text-sm mt-2">View your appointments, invoices, and service history</p>
          </CardHeader>
          <CardContent>
            {mode === 'link' ? (
              linkSent ? (
                <div className="text-center py-6 space-y-3">
                  <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <Mail className="w-6 h-6 text-primary" />
                  </div>
                  <p className="font-medium">Check your email</p>
                  <p className="text-sm text-muted-foreground">
                    If <span className="font-medium">{email}</span> has portal access, we've sent a secure login link.
                    It expires in 1 hour.
                  </p>
                  <Button variant="ghost" className="mt-2" onClick={() => setLinkSent(false)}>
                    Use a different email
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleRequestLink} className="space-y-5">
                  <div className="space-y-1">
                    <label className="text-sm font-medium pl-1">Email Address</label>
                    <Input
                      type="email"
                      placeholder="you@example.com"
                      icon={<Mail className="w-5 h-5" />}
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      required
                    />
                    <p className="text-xs text-muted-foreground pl-1">Use the email on file with your service provider — no password needed</p>
                  </div>
                  <Button type="submit" className="w-full h-12 text-lg" isLoading={isLoading}>
                    Email me a login link
                  </Button>
                  <button type="button" onClick={() => setMode('password')} className="w-full text-sm text-primary hover:underline">
                    Sign in with a password instead
                  </button>
                </form>
              )
            ) : (
              <form onSubmit={handlePasswordLogin} className="space-y-5">
                <div className="space-y-1">
                  <label className="text-sm font-medium pl-1">Email or Phone</label>
                  <Input
                    type="text"
                    placeholder="you@example.com"
                    icon={<Phone className="w-5 h-5" />}
                    value={identifier}
                    onChange={e => setIdentifier(e.target.value)}
                    required
                  />
                  <p className="text-xs text-muted-foreground pl-1">Use the email or phone number on file with your service provider</p>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium pl-1">Password</label>
                  <Input
                    type="password"
                    placeholder="••••••••"
                    icon={<Lock className="w-5 h-5" />}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full h-12 text-lg" isLoading={isLoading}>
                  Sign In
                </Button>
                <div className="flex items-center justify-between text-sm">
                  <button type="button" onClick={() => setMode('link')} className="text-primary hover:underline">
                    Email me a login link
                  </button>
                  <Link href={`/portal/${slug}/forgot-password`} className="text-muted-foreground hover:underline">
                    Forgot password?
                  </Link>
                </div>
              </form>
            )}
            <div className="mt-4 text-center text-xs text-muted-foreground">
              Access provided by your service provider. <Link href="/" className="text-primary hover:underline">GreenSynk</Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
