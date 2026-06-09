import { Link } from 'wouter';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui';
import { CheckCircle2, Leaf, Users, TrendingUp, Shield } from 'lucide-react';

export function AboutPage() {
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

      <main>
        <section className="py-20 px-4 bg-gradient-to-b from-emerald-50 to-white text-center">
          <div className="max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-100 text-emerald-700 text-sm font-medium mb-6">
              <Leaf className="w-4 h-4" />
              About GreenSynk
            </div>
            <h1 className="text-4xl md:text-5xl font-display font-bold mb-6">
              Built for the people who keep neighborhoods green
            </h1>
            <p className="text-xl text-muted-foreground leading-relaxed">
              GreenSynk is an all-in-one business management platform designed specifically for
              lawn care professionals — from solo operators to multi-crew companies.
            </p>
          </div>
        </section>

        <section className="py-20 px-4">
          <div className="max-w-4xl mx-auto">
            <div className="grid md:grid-cols-2 gap-16 items-center mb-20">
              <div>
                <h2 className="text-3xl font-display font-bold mb-6">Our mission</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  Running a lawn care business is hard work. Between managing schedules, chasing
                  payments, coordinating crews, and keeping customers happy, there's barely time
                  left to grow. We built GreenSynk to change that.
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  Our platform gives lawn care professionals the same caliber of tools that
                  enterprise businesses use — without the enterprise price tag or learning curve.
                  Schedule smarter, invoice faster, and focus on what you do best: delivering
                  exceptional results for your customers.
                </p>
              </div>
              <div className="bg-emerald-50 rounded-3xl p-8 space-y-4">
                {[
                  { icon: TrendingUp, text: 'Help lawn care businesses grow revenue' },
                  { icon: Users, text: 'Save owners and crews hours every week' },
                  { icon: Shield, text: 'Make professional tools accessible to everyone' },
                  { icon: CheckCircle2, text: 'Deliver a better experience to every customer' },
                ].map(({ icon: Icon, text }) => (
                  <div key={text} className="flex items-start gap-3">
                    <Icon className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                    <span className="text-sm font-medium">{text}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-border pt-16">
              <h2 className="text-3xl font-display font-bold mb-4 text-center">What we offer</h2>
              <p className="text-center text-muted-foreground mb-10 max-w-2xl mx-auto">
                GreenSynk covers every part of your lawn care business — from the first customer
                contact to the final invoice.
              </p>
              <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-6">
                {[
                  { title: 'Smart Scheduling', desc: 'Drag-and-drop calendar, recurring jobs, and automatic customer reminders.' },
                  { title: 'Route Optimization', desc: 'Auto-sequence daily stops to cut drive time and fuel costs.' },
                  { title: 'Invoicing & Payments', desc: 'Send professional invoices and collect payments online or in the field.' },
                  { title: 'Customer CRM', desc: 'Track every customer, property, and job history in one place.' },
                  { title: 'Online Booking', desc: 'Let customers request services 24/7 through your branded booking page.' },
                  { title: 'Team Management', desc: 'Add crew members, assign jobs, and track progress in real time.' },
                ].map(({ title, desc }) => (
                  <div key={title} className="p-6 rounded-2xl border border-border bg-card">
                    <h3 className="font-semibold mb-2">{title}</h3>
                    <p className="text-sm text-muted-foreground">{desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="py-20 px-4 bg-foreground text-background text-center">
          <div className="max-w-2xl mx-auto">
            <h2 className="text-3xl font-display font-bold mb-4">Ready to run your business smarter?</h2>
            <p className="text-background/70 mb-8">
              Join thousands of lawn care professionals who use GreenSynk to save time,
              get paid faster, and grow their business.
            </p>
            <Link href="/register">
              <Button size="lg" className="rounded-xl bg-primary text-white hover:bg-primary/90">
                Start Your Free Trial
              </Button>
            </Link>
          </div>
        </section>
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
