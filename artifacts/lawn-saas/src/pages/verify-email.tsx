import { useEffect, useRef, useState } from 'react';
import { useSearch, Link, useLocation } from 'wouter';
import { useVerifyEmail, useResendConfirmation } from '@workspace/api-client-react';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { CheckCircle2, XCircle, Loader2, MailCheck } from 'lucide-react';
import { Logo } from '@/components/logo';
import { useToast } from '@/hooks/use-toast';
import { usePageMeta } from '@/hooks/use-page-meta';

export function VerifyEmailPage() {
  usePageMeta({
    title: 'Verify Email',
    description: 'Confirm your GreenSynk email address.',
    noIndex: true,
  });

  const search = useSearch();
  const token = new URLSearchParams(search).get('token') || '';
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>(token ? 'verifying' : 'error');
  const [resendEmail, setResendEmail] = useState('');
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const verifyMutation = useVerifyEmail();
  const resendMutation = useResendConfirmation();
  const attempted = useRef(false);

  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;
    (async () => {
      try {
        await verifyMutation.mutateAsync({ data: { token } });
        setStatus('success');
        toast({ title: 'Email verified!', description: 'You can now sign in.' });
        setTimeout(() => setLocation('/login'), 1500);
      } catch {
        setStatus('error');
      }
    })();
  }, [token]);

  const handleResend = async () => {
    if (!resendEmail.trim()) {
      toast({ title: 'Enter your email', description: 'Type the email you signed up with.', variant: 'destructive' });
      return;
    }
    try {
      await resendMutation.mutateAsync({ data: { email: resendEmail.trim() } });
      toast({ title: 'Confirmation sent', description: 'If an account exists, a new link is on its way.' });
    } catch {
      toast({ title: "Couldn't resend", description: 'Please try again in a moment.', variant: 'destructive' });
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center items-center p-4 relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/5 rounded-full blur-3xl -z-10" />
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Link href="/"><Logo className="h-12" /></Link>
        </div>

        <Card className="border-border/50 shadow-2xl shadow-black/5 bg-white/80 backdrop-blur-xl text-center">
          {status === 'verifying' && (
            <CardContent className="pt-10 pb-8 space-y-4">
              <Loader2 className="w-12 h-12 text-primary mx-auto animate-spin" />
              <p className="text-muted-foreground">Verifying your email…</p>
            </CardContent>
          )}

          {status === 'success' && (
            <CardContent className="pt-10 pb-8 space-y-4">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8 text-green-600" />
              </div>
              <CardTitle className="text-2xl">Email verified!</CardTitle>
              <p className="text-muted-foreground text-sm">Taking you to sign in…</p>
              <Link href="/login"><Button className="w-full h-12">Go to Sign In</Button></Link>
            </CardContent>
          )}

          {status === 'error' && (
            <>
              <CardHeader className="pb-2">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
                  <XCircle className="h-8 w-8 text-destructive" />
                </div>
                <CardTitle className="text-2xl">Verification link invalid</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-muted-foreground text-sm">
                  This link is missing, expired, or already used. Enter your email below and we'll send a fresh confirmation link.
                </p>
                <div className="flex flex-col gap-2 text-left">
                  <label className="text-sm font-medium pl-1">Email</label>
                  <input
                    type="email"
                    value={resendEmail}
                    onChange={(e) => setResendEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="h-11 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <Button className="mt-1 w-full" isLoading={resendMutation.isPending} onClick={handleResend}>
                    <MailCheck className="mr-2 h-4 w-4" /> Resend confirmation email
                  </Button>
                </div>
                <p className="text-center text-sm text-muted-foreground">
                  <Link href="/login" className="text-primary font-semibold hover:underline">Back to sign in</Link>
                </p>
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
