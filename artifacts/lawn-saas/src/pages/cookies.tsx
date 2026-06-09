import { Link } from 'wouter';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-xl font-bold mb-3">{title}</h2>
      <div className="text-muted-foreground leading-relaxed space-y-3">{children}</div>
    </section>
  );
}

export function CookiesPage() {
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
          <h1 className="text-4xl font-display font-bold mb-3">Cookie Policy</h1>
          <p className="text-muted-foreground text-sm">Last updated: June 1, 2026</p>
        </div>

        <p className="text-muted-foreground leading-relaxed mb-10">
          This Cookie Policy explains how GreenSynk uses cookies and similar tracking technologies
          when you visit our website or use our platform. By using GreenSynk, you consent to
          our use of cookies as described in this policy.
        </p>

        <Section title="1. What Are Cookies?">
          <p>
            Cookies are small text files placed on your device by websites you visit. They are
            widely used to make websites work more efficiently and to provide information to the
            site owners. Cookies can be "session" cookies (deleted when you close your browser)
            or "persistent" cookies (remain on your device for a set period or until you delete them).
          </p>
        </Section>

        <Section title="2. Cookies We Use">
          <p><strong className="text-foreground">Essential cookies</strong> are necessary for
          the platform to function. They enable core features like logging in, maintaining your
          session, and remembering your authentication state. You cannot opt out of these
          cookies as the service cannot function without them.</p>

          <p><strong className="text-foreground">Functional cookies</strong> remember your
          preferences and settings (such as your timezone or display preferences) to personalize
          your experience. These help us provide a more consistent and user-friendly interface.</p>

          <p><strong className="text-foreground">Analytics cookies</strong> help us understand
          how users interact with the platform — which features are used most, where users
          encounter difficulties, and how the overall product can be improved. We use aggregated,
          anonymized data from these cookies and do not use them to identify individual users.</p>
        </Section>

        <Section title="3. Third-Party Cookies">
          <p>
            Some third-party services integrated into GreenSynk may also set their own cookies,
            including:
          </p>
          <ul className="list-disc list-inside space-y-1 mt-2">
            <li><strong className="text-foreground">Stripe</strong> — our payment processor uses cookies to prevent fraud and maintain secure payment sessions</li>
            <li><strong className="text-foreground">Analytics providers</strong> — we may use services like Google Analytics or a privacy-focused alternative to measure site traffic</li>
          </ul>
          <p>
            These third parties have their own privacy policies governing how they use cookies,
            which we encourage you to review.
          </p>
        </Section>

        <Section title="4. How to Control Cookies">
          <p>
            You can control and manage cookies through your browser settings. Most browsers
            allow you to refuse cookies, delete existing cookies, or be notified before a
            cookie is stored. Note that disabling essential cookies will prevent you from
            using GreenSynk.
          </p>
          <p>
            Common browser cookie controls:
          </p>
          <ul className="list-disc list-inside space-y-1 mt-2">
            <li><strong className="text-foreground">Chrome:</strong> Settings → Privacy and Security → Cookies</li>
            <li><strong className="text-foreground">Firefox:</strong> Settings → Privacy and Security → Cookies and Site Data</li>
            <li><strong className="text-foreground">Safari:</strong> Preferences → Privacy → Cookies</li>
            <li><strong className="text-foreground">Edge:</strong> Settings → Cookies and Site Permissions</li>
          </ul>
        </Section>

        <Section title="5. Changes to This Policy">
          <p>
            We may update this Cookie Policy from time to time to reflect changes in technology,
            regulation, or our practices. When we make significant changes, we'll notify you by
            posting the updated policy on this page.
          </p>
        </Section>

        <Section title="6. Contact Us">
          <p>
            If you have questions about our use of cookies, please contact us at:{' '}
            <a href="mailto:privacy@greensynk.com" className="text-primary hover:underline">
              privacy@greensynk.com
            </a>
          </p>
        </Section>
      </main>

      <footer className="py-8 px-4 border-t border-border text-center text-sm text-muted-foreground">
        <p>© 2026 GreenSynk. All rights reserved. ·{' '}
          <Link href="/privacy" className="hover:underline">Privacy Policy</Link> ·{' '}
          <Link href="/terms" className="hover:underline">Terms of Service</Link>
        </p>
      </footer>
    </div>
  );
}
