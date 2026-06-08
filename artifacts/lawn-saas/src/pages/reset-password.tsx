import { useState } from 'react';
import { useSearch, Link } from 'wouter';
import { Button, Input, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { Lock, Leaf, Check, X, ShieldCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

function PasswordStrengthChecker({ password }: { password: string }) {
  const rules = [
    { label: 'At least 8 characters', met: password.length >= 8 },
    { label: 'One uppercase letter (A–Z)', met: /[A-Z]/.test(password) },
    { label: 'One lowercase letter (a–z)', met: /[a-z]/.test(password) },
    { label: 'One number (0–9)', met: /\d/.test(password) },
    { label: 'One special character (!@#$%^&*…)', met: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password) },
  ];

  const metCount = rules.filter(r => r.met).length;
  const allMet = metCount === rules.length;

  if (!password) return null;

  return (
    <div className="mt-2 p-3 rounded-xl bg-muted/40 border border-border/50 space-y-1.5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-muted-foreground">Password requirements</span>
        {allMet && (
          <span className="text-xs font-semibold text-green-600 flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5" />Strong
          </span>
        )}
      </div>
      {rules.map(rule => (
        <div key={rule.label} className="flex items-center gap-2">
          <span className={`flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center ${rule.met ? 'bg-green-100 text-green-600' : 'bg-muted text-muted-foreground/40'}`}>
            {rule.met ? <Check className="w-2.5 h-2.5" strokeWidth={3} /> : <X className="w-2.5 h-2.5" strokeWidth={3} />}
          </span>
          <span className={`text-xs ${rule.met ? 'text-green-700' : 'text-muted-foreground'}`}>{rule.label}</span>
        </div>
      ))}
    </div>
  );
}

export function ResetPasswordPage() {
  const search = useSearch();
  const token = new URLSearchParams(search).get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [done, setDone] = useState(false);
  const { toast } = useToast();

  const passwordMeetsRequirements = (pw: string) =>
    pw.length >= 8 &&
    /[A-Z]/.test(pw) &&
    /[a-z]/.test(pw) &&
    /\d/.test(pw) &&
    /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pw);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordMeetsRequirements(password)) {
      toast({ title: 'Password does not meet requirements', description: 'Please check the requirements below and try again.', variant: 'destructive' });
      return;
    }
    if (password !== confirm) {
      toast({ title: 'Passwords do not match', description: 'Please make sure both passwords are identical.', variant: 'destructive' });
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
      toast({ title: 'Could not reset password', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <Card className="w-full max-w-md border-border/50 shadow-2xl shadow-black/5 bg-white/80 backdrop-blur-xl">
          <CardContent className="pt-8 pb-6 text-center space-y-3">
            <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
              <X className="w-7 h-7 text-destructive" />
            </div>
            <h2 className="font-semibold text-lg">Invalid reset link</h2>
            <p className="text-muted-foreground text-sm">This reset link is missing or malformed.</p>
            <Link href="/forgot-password">
              <Button className="mt-2">Request a new reset link</Button>
            </Link>
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
            <CardTitle className="text-2xl">
              {done ? 'Password updated!' : 'Set a new password'}
            </CardTitle>
            <p className="text-muted-foreground text-sm mt-2">
              {done
                ? 'A confirmation email has been sent to your address.'
                : 'Choose a strong password that meets all the requirements below.'}
            </p>
          </CardHeader>
          <CardContent>
            {!done ? (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium pl-1">New Password</label>
                  <Input
                    type="password"
                    placeholder="Create a strong password"
                    icon={<Lock className="w-5 h-5" />}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                  />
                  <PasswordStrengthChecker password={password} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium pl-1">Confirm New Password</label>
                  <Input
                    type="password"
                    placeholder="Repeat your password"
                    icon={<Lock className="w-5 h-5" />}
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    required
                    autoComplete="new-password"
                  />
                  {confirm && password !== confirm && (
                    <p className="text-xs text-destructive pl-1 pt-0.5 flex items-center gap-1">
                      <X className="w-3 h-3" />Passwords do not match
                    </p>
                  )}
                  {confirm && password === confirm && passwordMeetsRequirements(password) && (
                    <p className="text-xs text-green-600 pl-1 pt-0.5 flex items-center gap-1">
                      <Check className="w-3 h-3" />Passwords match
                    </p>
                  )}
                </div>
                <Button
                  type="submit"
                  className="w-full h-12 text-lg mt-2"
                  isLoading={isLoading}
                  disabled={!passwordMeetsRequirements(password) || password !== confirm}
                >
                  Update Password
                </Button>
              </form>
            ) : (
              <div className="text-center py-4 space-y-4">
                <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
                  <ShieldCheck className="w-8 h-8 text-green-600" />
                </div>
                <p className="text-sm text-muted-foreground">
                  Your password has been updated. A security confirmation email has been sent to your registered address. If you did not make this change, please contact us immediately.
                </p>
                <Link href="/login">
                  <Button className="w-full h-12 text-lg">Sign In</Button>
                </Link>
                <Link href="/forgot-password" className="block text-xs text-muted-foreground hover:text-primary">
                  Need to reset again?
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
