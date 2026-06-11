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

export function PrivacyPage() {
  usePageMeta({
    title: 'Privacy Policy — GreenSynk',
    description: "GreenSynk's Privacy Policy explains how we collect, use, and protect your information when you use our outdoor service business management platform.",
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
          <h1 className="text-4xl font-display font-bold mb-3">Privacy Policy</h1>
          <p className="text-muted-foreground text-sm">Last updated: June 1, 2026</p>
        </div>

        <p className="text-muted-foreground leading-relaxed mb-10">
          GreenSynk ("we", "our", or "us") operates the GreenSynk platform at greensynk.com.
          This Privacy Policy explains how we collect, use, and protect information about you
          when you use our services.
        </p>

        <Section title="1. Information We Collect">
          <p>We collect information you provide directly to us, including:</p>
          <ul className="list-disc list-inside space-y-1 mt-2">
            <li>Account registration details (name, email address, business name)</li>
            <li>Billing information processed securely through Stripe</li>
            <li>Business data you enter into the platform (customers, appointments, invoices)</li>
            <li>Communications you send us (support requests, feedback)</li>
          </ul>
          <p className="mt-3">
            We also collect limited technical data automatically, such as IP addresses, browser
            type, referring URLs, and usage patterns through analytics tools, to help us improve
            the service.
          </p>
        </Section>

        <Section title="2. How We Use Your Information">
          <p>We use the information we collect to:</p>
          <ul className="list-disc list-inside space-y-1 mt-2">
            <li>Provide, operate, and improve the GreenSynk platform</li>
            <li>Process payments and manage your subscription</li>
            <li>Send transactional emails (receipts, appointment reminders, password resets)</li>
            <li>Respond to support requests and communicate with you about your account</li>
            <li>Detect and prevent fraud, abuse, or security incidents</li>
            <li>Comply with legal obligations</li>
          </ul>
          <p className="mt-3">
            We do not sell your personal information to third parties for marketing purposes.
          </p>
        </Section>

        <Section title="3. Data Sharing">
          <p>
            We share your information only with trusted service providers who help us operate the
            platform (such as our payment processor, cloud infrastructure provider, and email
            delivery service). These providers are bound by data protection agreements and may
            only use your information to perform services on our behalf.
          </p>
          <p>
            We may also disclose information when required by law or to protect our rights,
            property, or the safety of our users.
          </p>
        </Section>

        <Section title="4. Data Security">
          <p>
            We use industry-standard security measures to protect your data, including encrypted
            connections (HTTPS/TLS), encrypted data storage, and role-based access controls.
            While we take these measures seriously, no system is completely secure, and we
            encourage you to use a strong, unique password for your account.
          </p>
        </Section>

        <Section title="5. Data Retention">
          <p>
            We retain your account and business data for as long as your account is active or
            as needed to provide services. If you cancel your account, we will delete or
            anonymize your data within 90 days, unless we are required by law to retain it
            longer.
          </p>
        </Section>

        <Section title="6. Your Rights">
          <p>
            You have the right to access, correct, or delete the personal information we hold
            about you. You may also request a copy of your data or ask us to restrict certain
            processing activities. To exercise these rights, contact us at{' '}
            <a href="mailto:privacy@greensynk.com" className="text-primary hover:underline">
              privacy@greensynk.com
            </a>.
          </p>
        </Section>

        <Section title="7. Cookies">
          <p>
            We use cookies and similar technologies to maintain your session, remember your
            preferences, and understand how you use the platform. See our{' '}
            <Link href="/cookies" className="text-primary hover:underline">Cookie Policy</Link>{' '}
            for more details.
          </p>
        </Section>

        <Section title="8. Children's Privacy">
          <p>
            GreenSynk is not directed to children under the age of 16. We do not knowingly
            collect personal information from children. If you believe we have inadvertently
            collected information from a child, please contact us immediately.
          </p>
        </Section>

        <Section title="9. SMS, Text Messaging, and Mobile Opt-In">
          <p>
            GreenSynk, and the businesses that use GreenSynk, may send SMS/text messages for
            transactional and service-related purposes — for example, appointment reminders and
            confirmations, scheduling and status updates, invoice and payment notifications,
            estimate updates, customer portal access links, and (where you have opted in) review
            requests.
          </p>
          <p>
            <strong>Consent.</strong> You opt in to text messages by providing your mobile phone
            number and agreeing to be contacted, or by texting us first. Consent to receive text
            messages is not a condition of purchasing any goods or services.
          </p>
          <p>
            <strong>
              No mobile information will be shared with third parties or affiliates for marketing
              or promotional purposes. Text messaging opt-in data and consent will not be shared
              with any third parties.
            </strong>{' '}
            We share mobile numbers only with the messaging service providers (such as Twilio)
            required to deliver the messages on our behalf, and they are contractually prohibited
            from using that information for any other purpose.
          </p>
          <p>
            <strong>Message frequency.</strong> Message frequency varies depending on your
            activity, settings, and interactions with the business — for example, reminders are
            typically sent around your scheduled appointments.
          </p>
          <p>
            <strong>Message and data rates may apply.</strong>
          </p>
          <p>
            <strong>Opt-out and help.</strong> You can opt out at any time by replying STOP to any
            message; you will receive a single confirmation and no further messages. Reply HELP for
            assistance, or contact us at{' '}
            <a href="mailto:privacy@greensynk.com" className="text-primary hover:underline">
              privacy@greensynk.com
            </a>
            . Carriers are not liable for delayed or undelivered messages.
          </p>
        </Section>

        <Section title="10. Changes to This Policy">
          <p>
            We may update this Privacy Policy from time to time. We will notify you of material
            changes by posting the new policy on this page and, where appropriate, by sending
            you an email notification. Your continued use of GreenSynk after any change
            constitutes acceptance of the updated policy.
          </p>
        </Section>

        <Section title="11. Contact Us">
          <p>
            If you have questions or concerns about this Privacy Policy, please contact us at:{' '}
            <a href="mailto:privacy@greensynk.com" className="text-primary hover:underline">
              privacy@greensynk.com
            </a>
          </p>
        </Section>
      </main>

      <footer className="py-8 px-4 border-t border-border text-center text-sm text-muted-foreground">
        <p>© 2026 GreenSynk. All rights reserved. ·{' '}
          <Link href="/terms" className="hover:underline">Terms of Service</Link> ·{' '}
          <Link href="/cookies" className="hover:underline">Cookie Policy</Link>
        </p>
      </footer>
    </div>
  );
}
