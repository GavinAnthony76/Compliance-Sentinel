import { Link } from 'wouter';
import { MessageSquare, Check, ShieldCheck } from 'lucide-react';
import { usePageMeta } from '@/hooks/use-page-meta';

export function SmsOptInPage() {
  usePageMeta({
    title: 'SMS Alerts Opt-In — GreenSynk',
    description: 'How to opt in to GreenSynk SMS alerts: explicit consent checkbox, message types, frequency, rates, and opt-out instructions.',
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <MessageSquare className="w-5 h-5 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">SMS Alerts Opt-In</h1>
        </div>

        <p className="text-muted-foreground mb-8 leading-relaxed">
          GreenSynk sends transactional SMS text messages to people who explicitly opt in. Opt-in is
          collected through a clearly labeled, unchecked-by-default consent checkbox. Consent is{' '}
          <strong className="text-foreground">never a condition of purchase</strong>. Below is the exact
          opt-in language and checkbox shown to users when they sign up for a GreenSynk account or book
          a service.
        </p>

        {/* Where opt-in happens */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">Where you opt in</h2>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <span>When creating a GreenSynk account at <span className="font-mono text-foreground">greensynk.com/register</span> (account &amp; service alerts for business owners).</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <span>When booking a service on a provider's public booking page (appointment reminders for customers).</span>
            </li>
          </ul>
        </section>

        {/* Exact opt-in CTA replica */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">The opt-in checkbox</h2>
          <p className="text-sm text-muted-foreground mb-4">
            This is the exact consent checkbox and disclosure presented at sign-up. It is unchecked by
            default and is optional.
          </p>
          <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                disabled
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary"
                aria-label="SMS Alerts opt-in (sample)"
              />
              <span className="text-xs text-muted-foreground leading-relaxed">
                <span className="flex items-center gap-1 font-semibold text-foreground text-sm mb-1">
                  <MessageSquare className="w-3.5 h-3.5" /> SMS Alerts (optional)
                </span>
                By checking this box, I agree to receive text messages from GreenSynk at the phone
                number provided. Messages may include account alerts, appointment reminders, estimate
                and invoice notifications, and service updates. Message &amp; data rates may apply.
                Message frequency varies (approximately 1–8 messages per month). Reply{' '}
                <strong className="text-foreground">STOP</strong> to cancel,{' '}
                <strong className="text-foreground">HELP</strong> for help. Consent is not a condition
                of purchase. See our{' '}
                <Link href="/sms-policy" className="underline text-primary">SMS Policy</Link>,{' '}
                <Link href="/privacy" className="underline text-primary">Privacy Policy</Link>, and{' '}
                <Link href="/terms" className="underline text-primary">Terms of Service</Link>.
              </span>
            </div>
          </div>
        </section>

        {/* Required disclosures summary */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">What you're agreeing to</h2>
          <div className="space-y-3">
            {[
              ['Program', 'GreenSynk transactional SMS alerts, sent on behalf of your lawn care provider.'],
              ['Message types', 'Account alerts, appointment reminders & confirmations, estimate and invoice notifications, and service updates. No promotional or marketing messages.'],
              ['Frequency', 'Message frequency varies — approximately 1–8 messages per month based on account activity.'],
              ['Cost', 'Message and data rates may apply, depending on your mobile carrier plan.'],
              ['Opt-out', 'Reply STOP at any time to unsubscribe; reply HELP for help. You can also manage alerts in your customer portal under SMS Preferences.'],
              ['Privacy', 'Your phone number is used only to deliver these alerts. We never sell or share it with third parties for marketing.'],
            ].map(([label, desc]) => (
              <div key={label} className="flex items-start gap-3 rounded-xl border border-border p-4">
                <ShieldCheck className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-sm">{label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm text-muted-foreground">
          <strong className="text-foreground">Consent is not required to purchase.</strong> You can use
          GreenSynk and book services without opting in to SMS. SMS alerts are an optional convenience.
        </div>

        <div className="mt-8 pt-6 border-t border-border text-xs text-muted-foreground flex flex-wrap gap-3">
          <Link href="/sms" className="underline">SMS Alerts</Link>
          <Link href="/sms-policy" className="underline">SMS Policy</Link>
          <Link href="/privacy" className="underline">Privacy Policy</Link>
          <Link href="/terms" className="underline">Terms of Service</Link>
          <Link href="/register" className="underline">Create an account</Link>
        </div>
      </div>
    </div>
  );
}
