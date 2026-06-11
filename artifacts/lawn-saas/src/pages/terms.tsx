import { Link } from 'wouter';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui';
import { usePageMeta } from '@/hooks/use-page-meta';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-xl font-bold mb-3">{title}</h2>
      <div className="text-muted-foreground leading-relaxed space-y-3">{children}</div>
    </section>
  );
}

export function TermsPage() {
  usePageMeta({
    title: 'Terms of Service — GreenSynk',
    description: 'Read the GreenSynk Terms of Service governing your use of our outdoor service business management platform.',
  });
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link href="/">
            <Logo className="h-8 cursor-pointer" />
          </Link>
          <nav className="flex items-center gap-4">
            <Link href="/login">
              <Button variant="ghost" size="sm">Sign In</Button>
            </Link>
            <Link href="/register">
              <Button size="sm">Start Free Trial</Button>
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-16">
        <div className="mb-12">
          <h1 className="text-4xl font-display font-bold mb-3">Terms of Service</h1>
          <p className="text-muted-foreground text-sm">Last updated: June 1, 2026</p>
        </div>

        <p className="text-muted-foreground leading-relaxed mb-10">
          These Terms of Service ("Terms") govern your access to and use of GreenSynk, a lawn
          care business management platform operated by GreenSynk, Inc. ("GreenSynk", "we",
          "our", or "us"). By creating an account or using the platform, you agree to be bound
          by these Terms.
        </p>

        <Section title="1. Acceptance of Terms">
          <p>
            By accessing or using GreenSynk, you confirm that you are at least 18 years old,
            have the legal authority to enter into this agreement, and agree to comply with
            these Terms and our Privacy Policy.
          </p>
        </Section>

        <Section title="2. Description of Service">
          <p>
            GreenSynk provides a cloud-based software platform for outdoor service businesses,
            including scheduling, customer management, invoicing, payment processing, route
            optimization, team management, and related features. The specific features available
            depend on your subscription plan.
          </p>
        </Section>

        <Section title="3. Account Registration">
          <p>
            You must register for an account to use most features of GreenSynk. You agree to
            provide accurate and complete information, keep your credentials confidential, and
            notify us immediately of any unauthorized use of your account. You are responsible
            for all activity that occurs under your account.
          </p>
        </Section>

        <Section title="4. Subscription and Billing">
          <p>
            GreenSynk offers paid subscription plans billed on a monthly basis. All fees are
            stated in US dollars. By providing payment information, you authorize us to charge
            you for the selected plan and any applicable taxes.
          </p>
          <p>
            Subscriptions automatically renew each billing period unless you cancel before the
            renewal date. We may change subscription fees upon reasonable notice. Refunds are
            not provided for partial billing periods, except where required by law.
          </p>
          <p>
            Free trials, where offered, are limited to one per business. We reserve the right to
            end a free trial at any time and to charge your payment method at the conclusion of
            the trial period.
          </p>
        </Section>

        <Section title="5. Acceptable Use">
          <p>You agree not to:</p>
          <ul className="list-disc list-inside space-y-1 mt-2">
            <li>Use GreenSynk for any unlawful purpose or in violation of any regulations</li>
            <li>Upload or transmit malicious code, viruses, or harmful data</li>
            <li>Attempt to gain unauthorized access to our systems or other users' accounts</li>
            <li>Resell or sublicense access to GreenSynk without our written consent</li>
            <li>Use the platform in a way that disrupts or degrades our services for other users</li>
          </ul>
        </Section>

        <Section title="6. Your Data">
          <p>
            You retain ownership of all data you enter into GreenSynk, including customer
            records, appointment history, and business information. You grant GreenSynk a
            limited license to store and process that data solely to provide and improve the
            service.
          </p>
          <p>
            You are responsible for the accuracy and legality of data you upload, including
            ensuring you have appropriate consent to store your customers' personal information
            in accordance with applicable privacy laws.
          </p>
        </Section>

        <Section title="7. Intellectual Property">
          <p>
            GreenSynk and its content, features, and functionality are owned by GreenSynk, Inc.
            and are protected by copyright, trademark, and other laws. Nothing in these Terms
            grants you any right to use our trademarks, logos, or other proprietary content
            without our prior written consent.
          </p>
        </Section>

        <Section title="8. Limitation of Liability">
          <p>
            To the maximum extent permitted by law, GreenSynk will not be liable for any
            indirect, incidental, special, consequential, or punitive damages arising from your
            use of the platform, even if we have been advised of the possibility of such damages.
            Our total liability for any claim arising from these Terms will not exceed the amount
            you paid us in the three months preceding the claim.
          </p>
        </Section>

        <Section title="9. Disclaimer of Warranties">
          <p>
            GreenSynk is provided "as is" and "as available" without warranties of any kind,
            either express or implied. We do not warrant that the platform will be uninterrupted,
            error-free, or completely secure. We may perform scheduled maintenance that
            temporarily affects availability.
          </p>
        </Section>

        <Section title="10. Termination">
          <p>
            You may cancel your account at any time from within the platform or by contacting us.
            We may suspend or terminate your account if you violate these Terms or for any other
            reason at our discretion. Upon termination, your right to access the platform ceases
            immediately.
          </p>
        </Section>

        <Section title="11. SMS and Text Messaging Program">
          <p>
            By providing your mobile phone number and opting in, you agree to receive recurring
            automated text messages from GreenSynk and/or the business you interact with through
            GreenSynk. Messages may include appointment reminders and confirmations, scheduling and
            status updates, invoice and payment notifications, estimate updates, customer portal
            access links, and review requests.
          </p>
          <p>Program details:</p>
          <ul className="list-disc list-inside space-y-1 mt-2">
            <li>Message frequency varies based on your activity and account settings.</li>
            <li>Message and data rates may apply.</li>
            <li>Reply STOP to cancel at any time. Reply HELP for help.</li>
            <li>Consent to receive messages is not a condition of any purchase.</li>
            <li>
              No mobile information or opt-in consent will be shared with third parties for
              marketing purposes; numbers are shared only with our messaging provider solely to
              deliver messages.
            </li>
            <li>
              Wireless carriers are not liable for delayed or undelivered messages, and message
              delivery is subject to your carrier's transmission.
            </li>
          </ul>
          <p>
            If you change or deactivate your mobile number, you agree to update your account or
            notify the business so that messages are not sent to someone who later acquires your
            former number. For full details on how we handle mobile information, see our{' '}
            <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>.
          </p>
        </Section>

        <Section title="12. Changes to Terms">
          <p>
            We may update these Terms from time to time. We will notify you of material changes
            by posting the updated Terms on this page and, where appropriate, by sending an email
            to the address associated with your account. Continued use of the platform after any
            change constitutes acceptance of the updated Terms.
          </p>
        </Section>

        <Section title="13. Governing Law">
          <p>
            These Terms are governed by and construed in accordance with the laws of the State
            of Delaware, without regard to its conflict of law provisions. Any disputes arising
            from these Terms shall be subject to the exclusive jurisdiction of courts in Delaware.
          </p>
        </Section>

        <Section title="14. Contact Us">
          <p>
            If you have questions about these Terms, please contact us at:{' '}
            <a href="mailto:legal@greensynk.com" className="text-primary hover:underline">
              legal@greensynk.com
            </a>
          </p>
        </Section>
      </main>

      <footer className="py-8 px-4 border-t border-border text-center text-sm text-muted-foreground">
        <p>© 2026 GreenSynk. All rights reserved. ·{' '}
          <Link href="/privacy" className="hover:underline">Privacy Policy</Link> ·{' '}
          <Link href="/cookies" className="hover:underline">Cookie Policy</Link>
        </p>
      </footer>
    </div>
  );
}
