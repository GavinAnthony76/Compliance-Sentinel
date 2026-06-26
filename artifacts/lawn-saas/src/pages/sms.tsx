import { Link } from 'wouter';
import { MessageSquare, Bell, FileText, CreditCard, Wrench, ShieldCheck } from 'lucide-react';
import { usePageMeta } from '@/hooks/use-page-meta';

export function SmsPage() {
  usePageMeta({
    title: 'SMS Alerts — GreenSynk',
    description: 'Learn about GreenSynk SMS text message alerts: message types, frequency, how to opt out, and how to get help.',
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <MessageSquare className="w-5 h-5 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">GreenSynk SMS Alerts</h1>
        </div>

        <p className="text-muted-foreground mb-8 leading-relaxed">
          GreenSynk sends automated text message alerts on behalf of your lawn care provider to keep
          you informed about your service. Below you'll find details about the types of messages we
          send, how often, and how to manage or stop them.
        </p>

        {/* Message types */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-4">Message Types</h2>
          <div className="space-y-3">
            {[
              {
                icon: Bell,
                label: 'Appointment Reminders',
                desc: 'Upcoming appointment reminders, booking confirmations, status updates (e.g. "on my way"), and rescheduling notices.',
              },
              {
                icon: FileText,
                label: 'Estimate Notifications',
                desc: 'Notifications when a new estimate is ready for your review and signature.',
              },
              {
                icon: CreditCard,
                label: 'Invoice Notifications',
                desc: 'Invoice delivery and payment reminders for completed services.',
              },
              {
                icon: Wrench,
                label: 'Service Updates',
                desc: 'General service communications from your lawn care provider, including portal access links.',
              },
            ].map(({ icon: Icon, label, desc }) => (
              <div key={label} className="flex items-start gap-3 rounded-xl border border-border p-4">
                <Icon className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-sm">{label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Frequency */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">Message Frequency</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Message frequency varies based on your account activity and scheduled services. You may
            receive approximately 1–4 messages per month per active service, plus transactional
            messages tied to specific appointments or invoices. We do not send promotional or
            marketing messages.
          </p>
        </section>

        {/* How to manage */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">Managing Your Preferences</h2>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              You can control which types of messages you receive by logging into your customer
              portal and visiting <strong>SMS Preferences</strong>. From there you can enable or
              disable all SMS alerts, or toggle individual message categories.
            </p>
            <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
              <p>
                <strong className="text-foreground">To stop all messages:</strong> Reply{' '}
                <strong>STOP</strong> to any text message from us. You will receive one
                confirmation and no further messages.
              </p>
              <p>
                <strong className="text-foreground">To restart messages:</strong> Reply{' '}
                <strong>START</strong> to re-subscribe at any time.
              </p>
              <p>
                <strong className="text-foreground">For help:</strong> Reply <strong>HELP</strong>{' '}
                to receive a description of this service and contact information.
              </p>
            </div>
          </div>
        </section>

        {/* Carrier disclaimer */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">Carrier Information</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Message and data rates may apply. GreenSynk is not responsible for charges imposed by
            your mobile carrier. Carriers are not liable for delayed or undelivered messages. SMS
            alerts are available to customers with a US mobile number. Supported carriers include
            AT&T, T-Mobile, Verizon, Sprint, Boost, Cricket, US Cellular, and others.
          </p>
        </section>

        {/* Consent */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">Your Consent</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            SMS alerts are opt-in only. You provide consent when you check the SMS Alerts checkbox
            during booking or account registration. You can withdraw consent at any time by
            replying STOP or updating your preferences in the customer portal. Consent to receive
            SMS messages is never required to purchase services.
          </p>
        </section>

        {/* Privacy + Policy links */}
        <div className="rounded-xl border border-border bg-muted/30 p-5 flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-primary mt-0.5 shrink-0" />
          <div className="text-sm space-y-1.5">
            <p className="font-semibold text-foreground">Privacy & Compliance</p>
            <p className="text-muted-foreground">
              Your phone number is never shared with third parties for marketing. Learn more in our{' '}
              <Link href="/sms-policy" className="underline text-foreground">SMS Policy</Link>{' '}
              and{' '}
              <Link href="/privacy" className="underline text-foreground">Privacy Policy</Link>.
            </p>
            <p className="text-muted-foreground text-xs mt-2">
              GreenSynk · support@greensynk.com
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
