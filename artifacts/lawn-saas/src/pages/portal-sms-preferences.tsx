import { useEffect, useState } from 'react';
import { useParams, Link } from 'wouter';
import { usePortalAuth } from '@/hooks/use-portal-auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { MessageSquare, ArrowLeft, Bell, FileText, CreditCard, Wrench, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface SmsPrefs {
  smsEnabled: boolean;
  categories: {
    appointments: boolean;
    estimates: boolean;
    invoices: boolean;
    serviceUpdates: boolean;
  };
}

function Toggle({ enabled, onChange, disabled }: { enabled: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${enabled ? 'bg-primary' : 'bg-gray-200'} ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

export function PortalSmsPreferencesPage() {
  const { slug } = useParams<{ slug: string }>();
  const { session, isLoading, isAuthenticated, portalFetch } = usePortalAuth();
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<SmsPrefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || isLoading) return;
    portalFetch('/api/sms-consent/portal/preferences')
      .then((r: any) => r.json())
      .then((data: SmsPrefs) => setPrefs(data))
      .catch(() => toast({ title: 'Could not load preferences', variant: 'destructive' }))
      .finally(() => setLoading(false));
  }, [isAuthenticated, isLoading]);

  async function toggleMaster(enabled: boolean) {
    if (!prefs) return;
    setSaving(true);
    try {
      const endpoint = enabled ? '/api/sms-consent/portal/opt-in' : '/api/sms-consent/portal/opt-out';
      await portalFetch(endpoint, { method: 'POST' });
      setPrefs(p => p ? { ...p, smsEnabled: enabled } : p);
      toast({ title: enabled ? 'SMS alerts enabled' : 'SMS alerts disabled' });
    } catch {
      toast({ title: 'Could not update preference', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function updateCategory(key: keyof SmsPrefs['categories'], value: boolean) {
    if (!prefs) return;
    const prev = prefs;
    setPrefs(p => p ? { ...p, categories: { ...p.categories, [key]: value } } : p);
    setSaving(true);
    try {
      const body: Record<string, boolean> = {};
      if (key === 'appointments') body.appointments = value;
      if (key === 'estimates') body.estimates = value;
      if (key === 'invoices') body.invoices = value;
      if (key === 'serviceUpdates') body.serviceUpdates = value;
      await portalFetch('/api/sms-consent/portal/preferences', {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
    } catch {
      setPrefs(prev);
      toast({ title: 'Could not save preference', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  if (isLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  const companyName = session?.company.name ?? 'Your provider';

  const categories = [
    { key: 'appointments' as const, label: 'Appointment Reminders', description: 'Upcoming appointment reminders, confirmations, and status updates.', icon: Bell },
    { key: 'estimates' as const, label: 'Estimate Notifications', description: 'When a new estimate is ready for your review and signature.', icon: FileText },
    { key: 'invoices' as const, label: 'Invoice Notifications', description: 'Invoice delivery and payment reminders.', icon: CreditCard },
    { key: 'serviceUpdates' as const, label: 'Service Updates', description: '"On my way" notifications and general service communications.', icon: Wrench },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-xl mx-auto px-4 py-8">
        <Link href={`/portal/${slug}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft className="w-4 h-4" /> Back to Dashboard
        </Link>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <MessageSquare className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">SMS Preferences</h1>
            <p className="text-sm text-muted-foreground">Manage text message alerts from {companyName}</p>
          </div>
        </div>

        {!prefs ? (
          <p className="text-muted-foreground text-sm">Could not load preferences.</p>
        ) : (
          <div className="space-y-4">
            {/* Master toggle */}
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-semibold text-sm">Receive SMS Alerts</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Master switch — disabling this stops all text messages.</p>
                  </div>
                  <Toggle enabled={prefs.smsEnabled} onChange={toggleMaster} disabled={saving} />
                </div>
                {!prefs.smsEnabled && (
                  <p className="mt-3 text-xs text-muted-foreground border-t pt-3">
                    SMS alerts are currently off. You can re-enable them at any time by toggling this switch, or by texting <strong>START</strong> to our number.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Per-category toggles */}
            <Card className={!prefs.smsEnabled ? 'opacity-50 pointer-events-none' : ''}>
              <CardHeader className="pb-2 pt-5 px-5">
                <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Message Types</CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5 space-y-4">
                {categories.map(({ key, label, description, icon: Icon }) => (
                  <div key={key} className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <Icon className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                      <div>
                        <p className="text-sm font-medium">{label}</p>
                        <p className="text-xs text-muted-foreground">{description}</p>
                      </div>
                    </div>
                    <Toggle
                      enabled={prefs.categories[key]}
                      onChange={v => updateCategory(key, v)}
                      disabled={saving || !prefs.smsEnabled}
                    />
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Compliance notice */}
            <div className="rounded-lg border border-border bg-muted/30 p-4 text-xs text-muted-foreground space-y-1.5">
              <p>Message & data rates may apply. Message frequency varies by account activity.</p>
              <p>To stop all messages, reply <strong>STOP</strong> to any text from us, or disable SMS alerts above.</p>
              <p>Reply <strong>HELP</strong> for help. View our{' '}
                <a href="/sms-policy" className="underline text-foreground">SMS Policy</a> and{' '}
                <a href="/privacy" className="underline text-foreground">Privacy Policy</a>.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
