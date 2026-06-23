import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Button, Input, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { Mail, Leaf } from 'lucide-react';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useToast } from '@/hooks/use-toast';

interface Portal {
  slug: string;
  name: string;
  logoUrl?: string | null;
}

export function PortalFindPage() {
  usePageMeta({
    title: 'Customer Login',
    description: 'Sign in to your customer portal.',
    noIndex: true,
  });
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [portals, setPortals] = useState<Portal[] | null>(null);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setPortals(null);
    try {
      const res = await fetch('/api/portal/auth/find-portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Something went wrong');
      const found: Portal[] = data.portals;
      if (found.length === 1) {
        setLocation(`/portal/${found[0].slug}/login`);
        return;
      }
      setPortals(found);
    } catch (err: any) {
      toast({ title: 'Something went wrong', description: err.message, variant: 'destructive' });
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
            <CardTitle className="text-2xl">Customer sign in</CardTitle>
            <p className="text-muted-foreground text-sm mt-2">
              Enter the email address on file with your service provider
            </p>
          </CardHeader>
          <CardContent>
            {portals !== null && portals.length === 0 ? (
              <div className="text-center py-6 space-y-3">
                <p className="text-sm text-muted-foreground">
                  We couldn't find a customer portal linked to{' '}
                  <span className="font-medium">{email}</span>.
                </p>
                <p className="text-xs text-muted-foreground">
                  Please contact your service provider, or check that you used the email they have on file.
                </p>
                <Button variant="outline" className="mt-2" onClick={() => setPortals(null)}>
                  Try a different email
                </Button>
              </div>
            ) : portals !== null && portals.length > 1 ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  We found multiple portals linked to{' '}
                  <span className="font-medium">{email}</span>. Choose yours:
                </p>
                {portals.map((p) => (
                  <Link key={p.slug} href={`/portal/${p.slug}/login`}>
                    <button className="w-full text-left px-4 py-3 rounded-lg border border-border hover:border-primary hover:bg-primary/5 transition-colors">
                      <span className="font-medium">{p.name}</span>
                    </button>
                  </Link>
                ))}
                <button
                  type="button"
                  onClick={() => setPortals(null)}
                  className="w-full text-sm text-primary hover:underline pt-1"
                >
                  Try a different email
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-1">
                  <label className="text-sm font-medium pl-1">Email address</label>
                  <Input
                    type="email"
                    placeholder="you@example.com"
                    icon={<Mail className="w-5 h-5" />}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full h-12 text-lg" isLoading={isLoading}>
                  Find my portal
                </Button>
              </form>
            )}

            <div className="mt-6 pt-4 border-t border-border/40 text-center text-xs text-muted-foreground/60">
              <Link href="/login" className="hover:underline">← Back to company login</Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
