import { Link } from 'wouter';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui';
import { Mail, MessageSquare, BookOpen, Clock } from 'lucide-react';

export function ContactPage() {
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

      <main className="max-w-4xl mx-auto px-4 py-20">
        <div className="text-center mb-16">
          <h1 className="text-4xl font-display font-bold mb-4">Contact Us</h1>
          <p className="text-xl text-muted-foreground">
            We're here to help. Reach out any time and we'll get back to you quickly.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 mb-16">
          <div className="p-8 rounded-3xl border border-border bg-card">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <Mail className="w-6 h-6 text-primary" />
            </div>
            <h2 className="text-xl font-bold mb-2">General Inquiries</h2>
            <p className="text-muted-foreground mb-4 text-sm">
              Questions about GreenSynk, partnerships, or anything else.
            </p>
            <a
              href="mailto:hello@greensynk.com"
              className="text-primary font-medium hover:underline"
            >
              hello@greensynk.com
            </a>
          </div>

          <div className="p-8 rounded-3xl border border-border bg-card">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <MessageSquare className="w-6 h-6 text-primary" />
            </div>
            <h2 className="text-xl font-bold mb-2">Customer Support</h2>
            <p className="text-muted-foreground mb-4 text-sm">
              Already a GreenSynk customer? We're ready to help you get the most out of the platform.
            </p>
            <a
              href="mailto:support@greensynk.com"
              className="text-primary font-medium hover:underline"
            >
              support@greensynk.com
            </a>
          </div>

          <div className="p-8 rounded-3xl border border-border bg-card">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <BookOpen className="w-6 h-6 text-primary" />
            </div>
            <h2 className="text-xl font-bold mb-2">Sales</h2>
            <p className="text-muted-foreground mb-4 text-sm">
              Want a demo or have questions about which plan is right for your business?
            </p>
            <a
              href="mailto:sales@greensynk.com"
              className="text-primary font-medium hover:underline"
            >
              sales@greensynk.com
            </a>
          </div>

          <div className="p-8 rounded-3xl border border-border bg-card">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <Clock className="w-6 h-6 text-primary" />
            </div>
            <h2 className="text-xl font-bold mb-2">Response Times</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              We typically respond to all inquiries within one business day.
              Pro plan customers receive priority support with faster response times.
            </p>
          </div>
        </div>

        <div className="text-center p-10 rounded-3xl bg-emerald-50 border border-emerald-100">
          <h2 className="text-2xl font-bold mb-3">Looking to try GreenSynk?</h2>
          <p className="text-muted-foreground mb-6">
            Start a free trial today — no credit card required. Set up your account in minutes.
          </p>
          <Link href="/register">
            <Button size="lg" className="rounded-xl">Start Free Trial</Button>
          </Link>
        </div>
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
