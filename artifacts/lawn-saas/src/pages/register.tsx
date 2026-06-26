import { useState } from 'react';
import { useRegister, useResendConfirmation } from '@workspace/api-client-react';
import { Button, Input, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { User, Mail, Lock, Building2, Check, ChevronRight, MailCheck, MessageSquare } from 'lucide-react';
import { Logo } from '@/components/logo';
import { Link } from 'wouter';
import { useToast } from '@/hooks/use-toast';
import { usePageMeta } from '@/hooks/use-page-meta';

const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    price: '$49/mo',
    desc: 'For solo operators getting organized',
    features: ['1 user · 50 active customers', '100 appointments/mo · 10 estimates/mo', 'Customer CRM & scheduling', 'Invoicing & online payments', 'Public booking page & customer portal'],
  },
  {
    id: 'growth',
    name: 'Growth',
    price: '$99/mo',
    desc: 'For growing crews',
    popular: true,
    features: ['Up to 5 users · 250 customers', '500 appointments/mo · 100 estimates/mo', 'Team management & route optimization', 'SMS notifications & GPS tracking', 'Recurring plans & review requests'],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$199/mo',
    desc: 'For established outdoor service businesses',
    features: ['Unlimited users, customers & jobs', 'AI Estimate Builder & Lead Scoring', 'Advanced analytics & forecasting', 'Data export, API access & autopay', 'Priority support'],
  },
];

export function RegisterPage() {
  usePageMeta({
    title: 'Start Free Trial',
    description: 'Create your GreenSynk account and start managing your outdoor service business smarter.',
  });
  const [step, setStep] = useState(1);
  const [selectedPlan, setSelectedPlan] = useState('growth');
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    companyName: '',
    phone: '',
  });
  const [registered, setRegistered] = useState(false);
  const [smsConsent, setSmsConsent] = useState(false);
  const { toast } = useToast();
  const registerMutation = useRegister();
  const resendMutation = useResendConfirmation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step < 3) { setStep(s => s + 1); return; }
    try {
      await registerMutation.mutateAsync({ data: { ...form, selectedPlan: selectedPlan as any, smsConsent } });
      setRegistered(true);
    } catch (err: any) {
      toast({ title: 'Registration failed', description: err.message || 'Please try again', variant: 'destructive' });
    }
  };

  const handleResend = async () => {
    try {
      await resendMutation.mutateAsync({ data: { email: form.email } });
      toast({ title: 'Confirmation sent', description: 'We sent another verification link to your email.' });
    } catch {
      toast({ title: "Couldn't resend", description: 'Please try again in a moment.', variant: 'destructive' });
    }
  };

  const steps = ['Account Info', 'Choose Plan', 'Business Details'];

  if (registered) {
    return (
      <div className="min-h-screen bg-background flex flex-col justify-center items-center p-4 relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] bg-primary/5 rounded-full blur-3xl -z-10" />
        <div className="w-full max-w-md">
          <div className="flex justify-center mb-8">
            <Link href="/"><Logo className="h-12" /></Link>
          </div>
          <Card className="border-border/50 shadow-2xl shadow-black/5 text-center">
            <CardHeader className="pb-2">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                <MailCheck className="h-8 w-8 text-primary" />
              </div>
              <CardTitle className="text-2xl">Check your email</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground text-sm">
                We sent a confirmation link to <span className="font-semibold text-foreground">{form.email}</span>.
                Click it to verify your account, then sign in.
              </p>
              <Button variant="outline" className="w-full" isLoading={resendMutation.isPending} onClick={handleResend}>
                Resend confirmation email
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                Already verified? <Link href="/login" className="text-primary font-semibold hover:underline">Sign in</Link>
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center items-center p-4 relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] bg-primary/5 rounded-full blur-3xl -z-10" />

      <div className="w-full max-w-2xl">
        <div className="flex justify-center mb-8">
          <Link href="/">
            <Logo className="h-12" />
          </Link>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center mb-8 gap-2">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                i + 1 < step ? 'bg-primary text-white' : i + 1 === step ? 'bg-primary text-white ring-4 ring-primary/20' : 'bg-accent text-muted-foreground'
              }`}>
                {i + 1 < step ? <Check className="w-4 h-4" /> : i + 1}
              </div>
              <span className={`text-sm font-medium hidden sm:inline ${i + 1 === step ? 'text-foreground' : 'text-muted-foreground'}`}>{s}</span>
              {i < steps.length - 1 && <div className={`w-8 sm:w-16 h-0.5 ${i + 1 < step ? 'bg-primary' : 'bg-border'}`} />}
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          {step === 1 && (
            <Card className="border-border/50 shadow-2xl shadow-black/5">
              <CardHeader className="text-center pb-2">
                <CardTitle className="text-2xl">Create your account</CardTitle>
                <p className="text-muted-foreground text-sm">14-day free trial, no credit card required</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-sm font-medium pl-1">First Name</label>
                    <Input icon={<User className="w-4 h-4" />} placeholder="John" value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} required />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium pl-1">Last Name</label>
                    <Input placeholder="Smith" value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} required />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium pl-1">Company Name</label>
                  <Input icon={<Building2 className="w-4 h-4" />} placeholder="Smith's Lawn Care" value={form.companyName} onChange={e => setForm(f => ({ ...f, companyName: e.target.value }))} required />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium pl-1">Work Email</label>
                  <Input type="email" icon={<Mail className="w-4 h-4" />} placeholder="john@smithslawn.com" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium pl-1">Password</label>
                  <Input type="password" icon={<Lock className="w-4 h-4" />} placeholder="Min 8 characters" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required minLength={8} />
                </div>
                <Button type="submit" className="w-full h-12">Continue <ChevronRight className="ml-2 w-4 h-4" /></Button>
                <p className="text-center text-sm text-muted-foreground">Already have an account? <Link href="/login" className="text-primary font-semibold hover:underline">Sign in</Link></p>
              </CardContent>
            </Card>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="text-center mb-6">
                <h2 className="text-2xl font-bold">Choose your plan</h2>
                <p className="text-muted-foreground mt-1">Start with 14 days free, then choose what fits.</p>
              </div>
              <div className="grid sm:grid-cols-3 gap-4">
                {PLANS.map(plan => (
                  <div
                    key={plan.id}
                    onClick={() => setSelectedPlan(plan.id)}
                    className={`relative rounded-2xl border-2 p-6 cursor-pointer transition-all ${
                      selectedPlan === plan.id ? 'border-primary bg-primary/5 shadow-lg shadow-primary/10' : 'border-border bg-card hover:border-primary/50'
                    }`}
                  >
                    {plan.popular && <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-primary text-primary-foreground text-xs font-bold rounded-full">Most Popular</div>}
                    <div className="mb-4">
                      <h3 className="font-bold text-lg">{plan.name}</h3>
                      <div className="text-2xl font-bold text-primary">{plan.price}</div>
                      <p className="text-xs text-muted-foreground mt-1">{plan.desc}</p>
                    </div>
                    <ul className="space-y-2">
                      {plan.features.map((f, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                          {f}
                        </li>
                      ))}
                    </ul>
                    {selectedPlan === plan.id && <div className="mt-4 text-center text-xs font-semibold text-primary">Selected ✓</div>}
                  </div>
                ))}
              </div>
              <Button type="submit" className="w-full h-12">Continue <ChevronRight className="ml-2 w-4 h-4" /></Button>
              <button type="button" onClick={() => setStep(1)} className="w-full text-center text-sm text-muted-foreground hover:text-foreground">← Back</button>
            </div>
          )}

          {step === 3 && (
            <Card className="border-border/50 shadow-2xl shadow-black/5">
              <CardHeader className="text-center pb-2">
                <CardTitle className="text-2xl">Business details</CardTitle>
                <p className="text-muted-foreground text-sm">Optional — you can add these later in Settings</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium pl-1">Business Phone</label>
                  <Input type="tel" placeholder="(555) 000-0000" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                </div>

                {/* SMS consent — required for A2P 10DLC; checkbox must be unchecked by default */}
                <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <input
                      id="sms-consent-reg"
                      type="checkbox"
                      checked={smsConsent}
                      onChange={e => setSmsConsent(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                    />
                    <label htmlFor="sms-consent-reg" className="text-xs text-muted-foreground leading-relaxed cursor-pointer">
                      <span className="flex items-center gap-1 font-semibold text-foreground text-sm mb-1">
                        <MessageSquare className="w-3.5 h-3.5" /> SMS Alerts (optional)
                      </span>
                      By checking this box, I agree to receive text messages from GreenSynk at the business phone number provided above. Messages may include account alerts, platform updates, and service notifications. Message & data rates may apply. Message frequency varies. Reply <strong>STOP</strong> to cancel, <strong>HELP</strong> for help. See our{' '}
                      <a href="/sms-policy" target="_blank" rel="noopener noreferrer" className="underline text-primary">SMS Policy</a> and{' '}
                      <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline text-primary">Privacy Policy</a>.
                    </label>
                  </div>
                </div>

                <Button type="submit" className="w-full h-12" isLoading={registerMutation.isPending}>
                  Create Account & Start Free Trial
                </Button>
                <p className="text-center text-xs text-muted-foreground">No credit card required for 14-day trial</p>
                <button type="button" onClick={() => setStep(2)} className="w-full text-center text-sm text-muted-foreground hover:text-foreground">← Back</button>
              </CardContent>
            </Card>
          )}
        </form>
      </div>
    </div>
  );
}
