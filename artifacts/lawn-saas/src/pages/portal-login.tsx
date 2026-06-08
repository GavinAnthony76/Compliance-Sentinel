import { useState } from 'react';
import { useParams, Link } from 'wouter';
import { usePortalAuth } from '@/hooks/use-portal-auth';
import { useToast } from '@/hooks/use-toast';
import { Button, Input, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { Phone, Lock, Leaf } from 'lucide-react';

export function PortalLoginPage() {
  const { slug } = useParams<{ slug: string }>();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login } = usePortalAuth();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
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
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1">
                <label className="text-sm font-medium pl-1">Phone Number</label>
                <Input
                  type="tel"
                  placeholder="(555) 000-0000"
                  icon={<Phone className="w-5 h-5" />}
                  value={identifier}
                  onChange={e => setIdentifier(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground pl-1">Use the phone number on file with your service provider</p>
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
            </form>
            <div className="mt-3 text-center text-xs text-muted-foreground">
              Access provided by your service provider. <Link href="/" className="text-primary hover:underline">Goshen Lawn Care Management</Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
