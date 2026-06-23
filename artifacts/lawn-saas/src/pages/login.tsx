import { useState, useEffect } from 'react';
import { useLogin, useResendConfirmation } from '@workspace/api-client-react';
import { useAuthState, TOKEN_KEY } from '@/hooks/use-auth-state';
import { Button, Input, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { Mail, Lock, RotateCcw } from 'lucide-react';
import { Logo } from '@/components/logo';
import { Link, useLocation } from 'wouter';
import { useToast } from '@/hooks/use-toast';
import { usePageMeta } from '@/hooks/use-page-meta';

export function LoginPage() {
  usePageMeta({
    title: 'Sign In',
    description: 'Sign in to your GreenSynk account to manage your outdoor service business.',
    noIndex: true,
  });
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [needsVerification, setNeedsVerification] = useState(false);
  const { login, isAuthenticated, isLoading } = useAuthState();
  const { toast } = useToast();
  const loginMutation = useLogin();
  const resendMutation = useResendConfirmation();
  const [, setLocation] = useLocation();

  // If already authenticated, go straight to the dashboard
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      setLocation('/dashboard');
    }
  }, [isAuthenticated, isLoading, setLocation]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNeedsVerification(false);
    try {
      const res = await loginMutation.mutateAsync({ data: { identifier, password } });
      login(res.token);
      toast({ title: "Welcome back!" });
    } catch (err: any) {
      const code = err?.response?.data?.error ?? err?.error;
      if (code === 'EmailNotVerified') {
        setNeedsVerification(true);
        toast({
          title: "Email not verified",
          description: "Please confirm your email to continue. We can resend the link below.",
          variant: "destructive",
        });
        return;
      }
      toast({ 
        title: "Login failed", 
        description: err.message || "Invalid credentials", 
        variant: "destructive" 
      });
    }
  };

  const handleResend = async () => {
    const email = identifier.includes('@') ? identifier.trim() : '';
    if (!email) {
      toast({ title: "Enter your email", description: "Type the email address you signed up with, then resend.", variant: "destructive" });
      return;
    }
    try {
      await resendMutation.mutateAsync({ data: { email } });
      toast({ title: "Confirmation sent", description: "If an account exists, a new verification link is on its way." });
    } catch {
      toast({ title: "Couldn't resend", description: "Please try again in a moment.", variant: "destructive" });
    }
  };

  const clearSession = () => {
    localStorage.removeItem(TOKEN_KEY);
    window.location.reload();
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
            <CardTitle className="text-2xl">Sign in to your account</CardTitle>
            <p className="text-muted-foreground text-sm mt-2">Enter your email or phone and password to access your dashboard</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1">
                <label className="text-sm font-medium pl-1">Email or phone</label>
                <Input 
                  type="text" 
                  placeholder="you@company.com or (555) 123-4567" 
                  icon={<Mail className="w-5 h-5" />}
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                  autoComplete="username"
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between pl-1">
                  <label className="text-sm font-medium">Password</label>
                  <div className="flex items-center gap-3">
                    <Link href="/forgot-username" className="text-xs text-muted-foreground hover:text-primary hover:underline">Forgot username?</Link>
                    <Link href="/forgot-password" className="text-xs text-primary font-medium hover:underline">Forgot password?</Link>
                  </div>
                </div>
                <Input 
                  type="password" 
                  placeholder="••••••••" 
                  icon={<Lock className="w-5 h-5" />}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>
              <Button type="submit" className="w-full h-12 text-lg" isLoading={loginMutation.isPending}>
                Sign In
              </Button>
            </form>

            {needsVerification && (
              <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
                <p className="text-amber-800">Your email isn't verified yet. Check your inbox for the confirmation link, or resend it.</p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-3 w-full"
                  isLoading={resendMutation.isPending}
                  onClick={handleResend}
                >
                  Resend confirmation email
                </Button>
              </div>
            )}
            
            <div className="mt-8 text-center text-sm text-muted-foreground">
              Don't have an account? <Link href="/register" className="text-primary font-semibold hover:underline">Start free trial</Link>
            </div>
            <div className="mt-4 text-center text-xs text-muted-foreground/60">
              <Link href="/portal/login" className="hover:underline">Customer Login</Link>
            </div>
            <div className="mt-4 border-t border-border/40 pt-4 text-center">
              <button
                type="button"
                onClick={clearSession}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
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
