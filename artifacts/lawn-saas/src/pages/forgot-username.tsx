import { useState } from 'react';
import { Link } from 'wouter';
import { Button, Input, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { Mail, ArrowLeft, User } from 'lucide-react';
import { Logo } from '@/components/logo';
import { useToast } from '@/hooks/use-toast';

export function ForgotUsernamePage() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Request failed');
      setSubmitted(true);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center items-center p-4 relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/5 rounded-full blur-3xl -z-10" />
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Link href="/">
            <Logo className="h-12" />
          </Link>
        </div>

        <Card className="border-border/50 shadow-2xl shadow-black/5 bg-white/80 backdrop-blur-xl">
          <CardHeader className="text-center pb-2">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
              <User className="w-7 h-7 text-primary" />
            </div>
            <CardTitle className="text-2xl">Forgot your username?</CardTitle>
            <p className="text-muted-foreground text-sm mt-2">
              {submitted
                ? "Check your inbox for your account details."
                : "Enter your registered email address and we'll send your login details."}
            </p>
          </CardHeader>
          <CardContent>
            {!submitted ? (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-1">
                  <label className="text-sm font-medium pl-1">Registered Email Address</label>
                  <Input
                    type="email"
                    placeholder="you@company.com"
                    icon={<Mail className="w-5 h-5" />}
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                  />
                  <p className="text-xs text-muted-foreground pl-1 pt-0.5">
                    We'll send your username (login email) to this address if it's registered.
                  </p>
                </div>
                <Button type="submit" className="w-full h-12 text-lg" isLoading={isLoading}>
                  Send My Username
                </Button>
              </form>
            ) : (
              <div className="text-center py-4 space-y-3">
                <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto">
                  <Mail className="w-7 h-7 text-green-600" />
                </div>
                <p className="text-sm text-muted-foreground">
                  If <span className="font-semibold text-foreground">{email}</span> is registered with GreenSynk, your login details have been sent to that address. Please check your inbox.
                </p>
                <p className="text-xs text-muted-foreground">
                  Didn't receive it? Check your spam folder, or{' '}
                  <button
                    type="button"
                    onClick={() => setSubmitted(false)}
                    className="text-primary font-medium hover:underline"
                  >
                    try again
                  </button>.
                </p>
              </div>
            )}

            <div className="mt-6 pt-5 border-t border-border/40 space-y-2 text-center text-sm">
              <div>
                <Link href="/login" className="inline-flex items-center gap-1 text-primary font-medium hover:underline">
                  <ArrowLeft className="w-4 h-4" /> Back to sign in
                </Link>
              </div>
              <div className="text-muted-foreground">
                Forgot your password?{' '}
                <Link href="/forgot-password" className="text-primary font-medium hover:underline">
                  Reset it here
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
