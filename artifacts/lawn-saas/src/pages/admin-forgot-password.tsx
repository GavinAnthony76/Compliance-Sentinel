import { useState } from 'react';
import { Link } from 'wouter';
import { Button, Input, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { Mail, ShieldCheck, ArrowLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export function AdminForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const res = await fetch('/api/admin/auth/forgot-password', {
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
            <CardTitle className="text-2xl text-white">Forgot password?</CardTitle>
            <p className="text-slate-400 text-sm mt-1">
              {submitted ? 'Check your inbox for a reset link.' : "Enter your admin email to receive a reset link."}
            </p>
          </CardHeader>
          <CardContent>
            {!submitted ? (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-1">
                  <label className="text-sm font-medium pl-1 text-slate-300">Admin Email</label>
                  <Input
                    type="email"
                    placeholder="admin@goshen.com"
                    icon={<Mail className="w-5 h-5" />}
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                  />
                </div>
                <Button type="submit" className="w-full h-12 text-lg" isLoading={isLoading}>
                  Send Reset Link
                </Button>
              </form>
            ) : (
              <div className="text-center py-4">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <Mail className="w-7 h-7 text-primary" />
                </div>
                <p className="text-sm text-slate-400">
                  If <span className="font-semibold text-white">{email}</span> is a registered admin, you'll receive a reset link shortly. It expires in 1 hour.
                </p>
              </div>
            )}
            <div className="mt-6 text-center text-sm">
              <Link href="/admin/login" className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-200 transition-colors">
                <ArrowLeft className="w-4 h-4" /> Back to admin login
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
