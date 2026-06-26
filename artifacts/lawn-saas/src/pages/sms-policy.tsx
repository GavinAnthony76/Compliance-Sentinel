import { Link } from 'wouter';
import { usePageMeta } from '@/hooks/use-page-meta';

export function SmsPolicyPage() {
  usePageMeta({
    title: 'SMS Policy — GreenSynk',
    description: 'GreenSynk SMS text messaging policy: consent, message types, frequency, opt-out instructions, and data handling.',
  });

  const effectiveDate = 'June 25, 2026';

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-12">
        <h1 className="text-2xl font-bold mb-2">SMS Policy</h1>
        <p className="text-sm text-muted-foreground mb-8">Effective date: {effectiveDate}</p>

        <div className="prose prose-sm max-w-none text-muted-foreground space-y-6">
          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">1. Program Description</h2>
            <p>
              GreenSynk ("we," "us," or "our") operates an SMS alert program on behalf of lawn care
              businesses ("Providers") that use the GreenSynk platform. When you opt in, we send
              transactional text messages to your mobile phone number on behalf of your Provider.
              Messages include appointment reminders, estimate notifications, invoice notifications,
              and service updates.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">2. Consent</h2>
            <p>
              SMS alerts are strictly opt-in. You provide consent by checking the SMS Alerts
              checkbox when booking a service or creating an account. Consent is not a condition
              of purchasing any service or goods. You must be the account holder or authorized
              user of the mobile number you provide.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">3. Message Types & Frequency</h2>
            <p>
              You may receive approximately 1–8 messages per month, depending on your service
              activity. Message types include:
            </p>
            <ul className="list-disc ml-5 mt-2 space-y-1">
              <li>Appointment reminders, confirmations, and status updates</li>
              <li>Estimate ready notifications</li>
              <li>Invoice delivery and payment reminders</li>
              <li>General service communications (e.g., portal access, route updates)</li>
            </ul>
            <p className="mt-2">We do not send promotional or marketing messages.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">4. Carrier Charges</h2>
            <p>
              Message and data rates may apply based on your mobile carrier's plan. GreenSynk
              is not responsible for any charges you incur from your carrier. Contact your carrier
              for information about your text messaging plan.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">5. How to Opt Out</h2>
            <p>
              You can opt out at any time using any of the following methods:
            </p>
            <ul className="list-disc ml-5 mt-2 space-y-1">
              <li>
                Reply <strong className="text-foreground">STOP</strong> to any text message from
                us. You will receive one final confirmation message and no further SMS messages.
                To resubscribe, reply <strong className="text-foreground">START</strong>.
              </li>
              <li>
                Log in to your customer portal and navigate to <strong className="text-foreground">SMS Preferences</strong> to
                disable all alerts or individual message categories.
              </li>
            </ul>
            <p className="mt-2">
              The following keywords are recognized and processed automatically:
            </p>
            <div className="rounded-lg border border-border bg-muted/30 p-3 mt-2 font-mono text-xs space-y-1 text-foreground">
              <p><strong>STOP / STOPALL / UNSUBSCRIBE / CANCEL / END / QUIT</strong> — Opt out of all SMS messages</p>
              <p><strong>START / YES / UNSTOP</strong> — Re-subscribe to SMS messages</p>
              <p><strong>HELP / INFO</strong> — Receive program information and contact details</p>
            </div>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">6. Help</h2>
            <p>
              Reply <strong className="text-foreground">HELP</strong> to any text message to receive
              program information. You may also contact us at{' '}
              <a href="mailto:support@greensynk.com" className="underline text-foreground">
                support@greensynk.com
              </a>{' '}
              for assistance.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">7. Privacy & Data Use</h2>
            <p>
              Your mobile phone number is used solely to deliver the SMS alerts described in this
              policy. We do not sell, share, or transfer your phone number to third parties for
              their marketing purposes. Phone numbers are stored securely and associated with your
              customer account. For full details on how we handle your personal data, please
              review our{' '}
              <Link href="/privacy" className="underline text-foreground">Privacy Policy</Link>.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">8. Supported Carriers</h2>
            <p>
              GreenSynk SMS alerts are available to US mobile subscribers. Supported carriers
              include (but are not limited to) AT&amp;T, T-Mobile, Verizon, Sprint, Boost Mobile,
              Cricket Wireless, US Cellular, and regional carriers. Carrier availability may vary.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">9. Changes to This Policy</h2>
            <p>
              We may update this SMS Policy from time to time. When we do, we will update the
              effective date at the top of this page. Continued use of our SMS program after
              changes are posted constitutes acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">10. Contact Us</h2>
            <p>
              GreenSynk, Inc.<br />
              Email:{' '}
              <a href="mailto:support@greensynk.com" className="underline text-foreground">
                support@greensynk.com
              </a>
            </p>
          </section>
        </div>

        <div className="mt-8 pt-6 border-t border-border text-xs text-muted-foreground flex flex-wrap gap-3">
          <Link href="/sms" className="underline">SMS Alerts</Link>
          <Link href="/privacy" className="underline">Privacy Policy</Link>
          <Link href="/terms" className="underline">Terms of Service</Link>
        </div>
      </div>
    </div>
  );
}
