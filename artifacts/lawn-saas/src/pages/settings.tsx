import { useState, useEffect, useRef } from 'react';
import { useGetSettings, useUpdateSettings } from '@workspace/api-client-react';
import { AppLayout } from '@/components/layout';
import { Card, CardContent, Button, Input } from '@/components/ui';
import { Settings, Globe, Palette, CreditCard, CheckCircle, AlertCircle, ExternalLink } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { getGetSettingsQueryKey } from '@workspace/api-client-react';
import { useLocation } from 'wouter';

const PAYMENT_METHODS = [
  { value: 'cash',          label: 'Cash' },
  { value: 'check',         label: 'Check' },
  { value: 'zelle',         label: 'Zelle' },
  { value: 'venmo',         label: 'Venmo' },
  { value: 'cashapp',       label: 'Cash App' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'card',          label: 'Card (Online)' },
  { value: 'other',         label: 'Other' },
];

function useConnectStatus() {
  const [status, setStatus] = useState<{ connected: boolean; chargesEnabled?: boolean; payoutsEnabled?: boolean; detailsSubmitted?: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    fetch('/api/billing/connect/status')
      .then(r => r.json())
      .then(setStatus)
      .catch(() => setStatus({ connected: false }))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);
  return { status, loading, refresh };
}

export function SettingsPage() {
  const { data: company, isLoading } = useGetSettings();
  const { toast } = useToast();
  const qc = useQueryClient();
  const updateMut = useUpdateSettings();
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<'business' | 'branding' | 'payments'>('business');
  const { status: connectStatus, loading: connectLoading, refresh: refreshConnect } = useConnectStatus();
  const [connectWorking, setConnectWorking] = useState(false);

  const [businessForm, setBusinessForm] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    website: '',
    timezone: '',
  });
  const [brandingForm, setBrandingForm] = useState({
    primaryColor: '',
    reviewUrl: '',
    logoUrl: '',
  });
  const [paymentForm, setPaymentForm] = useState({
    acceptedPaymentMethods: ['cash', 'check'] as string[],
    paymentInstructions: '',
    zelleInfo: '',
    venmoHandle: '',
    cashAppTag: '',
    checkPayableTo: '',
  });
  const [paymentLoading, setPaymentLoading] = useState(false);

  const initialized = useRef(false);
  useEffect(() => {
    if (company && !initialized.current) {
      initialized.current = true;
      setBusinessForm({
        name: company.name ?? '',
        phone: company.phone ?? '',
        email: company.email ?? '',
        address: company.address ?? '',
        city: company.city ?? '',
        state: company.state ?? '',
        zip: company.zip ?? '',
        website: company.website ?? '',
        timezone: company.timezone ?? 'America/New_York',
      });
      setBrandingForm({
        primaryColor: company.primaryColor ?? '#22c55e',
        reviewUrl: company.reviewUrl ?? '',
        logoUrl: company.logoUrl ?? '',
      });
    }
  }, [company]);

  // Handle connect return/refresh from Stripe
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connect = params.get('connect');
    if (connect === 'success') {
      setTab('payments');
      refreshConnect();
      toast({ title: 'Stripe account connected!', description: 'Your customers can now pay invoices online.' });
      setLocation('/settings', { replace: true });
    } else if (connect === 'refresh') {
      setTab('payments');
      toast({ title: 'Stripe setup incomplete', description: 'Please finish connecting your Stripe account.', variant: 'destructive' });
      setLocation('/settings', { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnectOnboard = async () => {
    setConnectWorking(true);
    try {
      const res = await fetch('/api/billing/connect/onboard', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Error');
      window.location.href = data.url;
    } catch (err: any) {
      toast({ title: 'Could not start Stripe setup', description: err.message, variant: 'destructive' });
      setConnectWorking(false);
    }
  };

  const handleConnectDashboard = async () => {
    setConnectWorking(true);
    try {
      const res = await fetch('/api/billing/connect/dashboard', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Error');
      window.open(data.url, '_blank');
    } catch (err: any) {
      toast({ title: 'Could not open Stripe dashboard', description: err.message, variant: 'destructive' });
    } finally {
      setConnectWorking(false);
    }
  };

  // Load payment config separately
  useEffect(() => {
    if (tab !== 'payments') return;
    const token = localStorage.getItem('greensync_token');
    fetch('/api/settings/payment-config', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => {
        if (d && !d.error) {
          setPaymentForm({
            acceptedPaymentMethods: d.acceptedPaymentMethods ?? ['cash', 'check'],
            paymentInstructions: d.paymentInstructions ?? '',
            zelleInfo: d.zelleInfo ?? '',
            venmoHandle: d.venmoHandle ?? '',
            cashAppTag: d.cashAppTag ?? '',
            checkPayableTo: d.checkPayableTo ?? '',
          });
        }
      })
      .catch(() => {});
  }, [tab]);

  const handleSaveBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateMut.mutateAsync({ data: businessForm });
      qc.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      toast({ title: 'Settings saved' });
    } catch {
      toast({ title: 'Error saving settings', variant: 'destructive' });
    }
  };

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateMut.mutateAsync({ data: brandingForm });
      qc.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      toast({ title: 'Branding saved' });
    } catch {
      toast({ title: 'Error saving branding', variant: 'destructive' });
    }
  };

  const handleSavePayments = async (e: React.FormEvent) => {
    e.preventDefault();
    setPaymentLoading(true);
    try {
      const token = localStorage.getItem('greensync_token');
      const res = await fetch('/api/settings/payment-config', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(paymentForm),
      });
      if (!res.ok) throw new Error('Save failed');
      toast({ title: 'Payment settings saved' });
    } catch {
      toast({ title: 'Error saving payment settings', variant: 'destructive' });
    } finally {
      setPaymentLoading(false);
    }
  };

  const toggleMethod = (method: string) => {
    setPaymentForm(f => ({
      ...f,
      acceptedPaymentMethods: f.acceptedPaymentMethods.includes(method)
        ? f.acceptedPaymentMethods.filter(m => m !== method)
        : [...f.acceptedPaymentMethods, method],
    }));
  };

  return (
    <AppLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-display font-bold">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your business profile and preferences</p>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap">
        {([
          ['business', 'Business Info', Settings],
          ['branding', 'Branding', Palette],
          ['payments', 'Payments', CreditCard],
        ] as const).map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id as any)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${tab === id ? 'bg-primary text-primary-foreground shadow-md' : 'bg-card border border-border hover:border-primary/50 text-muted-foreground'}`}>
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
      ) : tab === 'business' ? (
        <Card className="border-border/50">
          <CardContent className="p-6">
            <form onSubmit={handleSaveBusiness} className="space-y-5 max-w-2xl">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Company Name</label>
                  <Input value={businessForm.name} onChange={e => setBusinessForm(f => ({ ...f, name: e.target.value }))} placeholder="Your Company" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Phone</label>
                  <Input value={businessForm.phone} onChange={e => setBusinessForm(f => ({ ...f, phone: e.target.value }))} placeholder="(555) 000-0000" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Business Email</label>
                  <Input type="email" value={businessForm.email} onChange={e => setBusinessForm(f => ({ ...f, email: e.target.value }))} placeholder="info@yourcompany.com" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Website</label>
                  <Input value={businessForm.website} onChange={e => setBusinessForm(f => ({ ...f, website: e.target.value }))} placeholder="https://yoursite.com" icon={<Globe className="w-4 h-4" />} />
                </div>
                <div className="sm:col-span-2 space-y-1">
                  <label className="text-sm font-medium">Street Address</label>
                  <Input value={businessForm.address} onChange={e => setBusinessForm(f => ({ ...f, address: e.target.value }))} placeholder="123 Main St" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">City</label>
                  <Input value={businessForm.city} onChange={e => setBusinessForm(f => ({ ...f, city: e.target.value }))} placeholder="Austin" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">State</label>
                    <Input value={businessForm.state} onChange={e => setBusinessForm(f => ({ ...f, state: e.target.value }))} placeholder="TX" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">ZIP</label>
                    <Input value={businessForm.zip} onChange={e => setBusinessForm(f => ({ ...f, zip: e.target.value }))} placeholder="78701" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Timezone</label>
                  <select className="w-full h-11 px-3 rounded-xl border border-input bg-background text-sm" value={businessForm.timezone} onChange={e => setBusinessForm(f => ({ ...f, timezone: e.target.value }))}>
                    <option value="America/New_York">Eastern Time</option>
                    <option value="America/Chicago">Central Time</option>
                    <option value="America/Denver">Mountain Time</option>
                    <option value="America/Los_Angeles">Pacific Time</option>
                    <option value="America/Phoenix">Arizona Time</option>
                    <option value="Pacific/Honolulu">Hawaii Time</option>
                  </select>
                </div>
              </div>
              <Button type="submit" isLoading={updateMut.isPending}>Save Changes</Button>
            </form>
          </CardContent>
        </Card>
      ) : tab === 'branding' ? (
        <Card className="border-border/50">
          <CardContent className="p-6">
            <form onSubmit={handleSaveBranding} className="space-y-5 max-w-2xl">
              <div className="space-y-1">
                <label className="text-sm font-medium">Logo URL</label>
                <Input value={brandingForm.logoUrl} onChange={e => setBrandingForm(f => ({ ...f, logoUrl: e.target.value }))} placeholder="https://yoursite.com/logo.png" />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Primary Brand Color</label>
                <div className="flex items-center gap-3">
                  <Input type="color" value={brandingForm.primaryColor} onChange={e => setBrandingForm(f => ({ ...f, primaryColor: e.target.value }))} className="w-16 h-11 px-1 py-1 cursor-pointer" />
                  <Input value={brandingForm.primaryColor} onChange={e => setBrandingForm(f => ({ ...f, primaryColor: e.target.value }))} placeholder="#22c55e" className="flex-1" />
                </div>
                <p className="text-xs text-muted-foreground">Used on your public booking page</p>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Review Page URL</label>
                <Input value={brandingForm.reviewUrl} onChange={e => setBrandingForm(f => ({ ...f, reviewUrl: e.target.value }))} placeholder="https://g.page/review/your-business" />
                <p className="text-xs text-muted-foreground">Where customers are directed for reviews (Google, Yelp, etc.)</p>
              </div>
              <Button type="submit" isLoading={updateMut.isPending}>Save Branding</Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/50">
          <CardContent className="p-6 space-y-8 max-w-2xl">

            {/* ── Stripe Connect Section ─────────────────────────── */}
            <div>
              <h3 className="text-base font-semibold mb-1 flex items-center gap-2"><CreditCard className="w-4 h-4" /> Stripe Payments (Online Card Processing)</h3>
              <p className="text-xs text-muted-foreground mb-4">Connect your Stripe account so customers can pay invoices online by card. Payments go directly to your Stripe account — GreenSynk never holds your funds.</p>

              {connectLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" /> Checking connection…</div>
              ) : connectStatus?.connected ? (
                <div className="rounded-xl border p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    {connectStatus.chargesEnabled
                      ? <CheckCircle className="w-5 h-5 text-green-500" />
                      : <AlertCircle className="w-5 h-5 text-amber-500" />}
                    <span className="text-sm font-medium">
                      {connectStatus.chargesEnabled ? 'Stripe account connected and active' : 'Stripe account connected — setup incomplete'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <span>Charges enabled: <strong className={connectStatus.chargesEnabled ? 'text-green-600' : 'text-amber-600'}>{connectStatus.chargesEnabled ? 'Yes' : 'No'}</strong></span>
                    <span>Payouts enabled: <strong className={connectStatus.payoutsEnabled ? 'text-green-600' : 'text-amber-600'}>{connectStatus.payoutsEnabled ? 'Yes' : 'No'}</strong></span>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {!connectStatus.detailsSubmitted && (
                      <Button type="button" size="sm" onClick={handleConnectOnboard} isLoading={connectWorking}>
                        Complete Setup
                      </Button>
                    )}
                    <Button type="button" size="sm" variant="outline" onClick={handleConnectDashboard} isLoading={connectWorking} className="flex items-center gap-1">
                      <ExternalLink className="w-3 h-3" /> Open Stripe Dashboard
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={refreshConnect} disabled={connectLoading} className="text-muted-foreground">
                      Refresh Status
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed p-4 space-y-3">
                  <p className="text-sm text-muted-foreground">No Stripe account connected. Connect Stripe to enable the "Pay Online" button on customer invoices.</p>
                  <Button type="button" onClick={handleConnectOnboard} isLoading={connectWorking}>
                    Connect Stripe Account
                  </Button>
                </div>
              )}
            </div>

            <div className="border-t border-border" />

            <form onSubmit={handleSavePayments} className="space-y-6">
              <div>
                <label className="text-sm font-semibold block mb-3">Accepted Payment Methods</label>
                <p className="text-xs text-muted-foreground mb-3">Choose which payment options your customers can use. These are displayed on their invoices and in the customer portal.</p>
                <div className="mb-3 p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-800">
                  <strong>Note:</strong> Card (Online) enables a Stripe-hosted payment link in the customer portal for Growth and Pro plans. All other methods (Cash, Check, Zelle, Venmo, Cash App) are collected and reconciled outside this app — GreenSynk does not process or hold funds directly.
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {PAYMENT_METHODS.map(m => (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => toggleMethod(m.value)}
                      className={`px-3 py-2 rounded-xl border text-sm font-medium transition-all text-left ${paymentForm.acceptedPaymentMethods.includes(m.value) ? 'bg-primary text-primary-foreground border-primary shadow-md' : 'border-border hover:border-primary/50 text-muted-foreground bg-card'}`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Payment Instructions</label>
                <textarea
                  className="w-full px-3 py-2 rounded-xl border border-input bg-background text-sm min-h-[80px] resize-none"
                  value={paymentForm.paymentInstructions}
                  onChange={e => setPaymentForm(f => ({ ...f, paymentInstructions: e.target.value }))}
                  placeholder="e.g. Please pay within 14 days of service. Cash or check preferred."
                />
                <p className="text-xs text-muted-foreground">Shown at the top of each invoice and on the customer portal payment page.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className={`space-y-1 transition-opacity ${paymentForm.acceptedPaymentMethods.includes('zelle') ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                  <label className="text-sm font-medium">Zelle — Phone / Email</label>
                  <Input value={paymentForm.zelleInfo} onChange={e => setPaymentForm(f => ({ ...f, zelleInfo: e.target.value }))} placeholder="(555) 000-0000 or zelle@email.com" disabled={!paymentForm.acceptedPaymentMethods.includes('zelle')} />
                </div>
                <div className={`space-y-1 transition-opacity ${paymentForm.acceptedPaymentMethods.includes('venmo') ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                  <label className="text-sm font-medium">Venmo Handle</label>
                  <Input value={paymentForm.venmoHandle} onChange={e => setPaymentForm(f => ({ ...f, venmoHandle: e.target.value }))} placeholder="@YourBusiness" disabled={!paymentForm.acceptedPaymentMethods.includes('venmo')} />
                </div>
                <div className={`space-y-1 transition-opacity ${paymentForm.acceptedPaymentMethods.includes('cashapp') ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                  <label className="text-sm font-medium">Cash App $Cashtag</label>
                  <Input value={paymentForm.cashAppTag} onChange={e => setPaymentForm(f => ({ ...f, cashAppTag: e.target.value }))} placeholder="$YourCashtag" disabled={!paymentForm.acceptedPaymentMethods.includes('cashapp')} />
                </div>
                <div className={`space-y-1 transition-opacity ${paymentForm.acceptedPaymentMethods.includes('check') ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                  <label className="text-sm font-medium">Check Payable To</label>
                  <Input value={paymentForm.checkPayableTo} onChange={e => setPaymentForm(f => ({ ...f, checkPayableTo: e.target.value }))} placeholder="Greenscapes LLC" disabled={!paymentForm.acceptedPaymentMethods.includes('check')} />
                </div>
              </div>

              <Button type="submit" isLoading={paymentLoading}>Save Payment Settings</Button>
            </form>
          </CardContent>
        </Card>
      )}
    </AppLayout>
  );
}
