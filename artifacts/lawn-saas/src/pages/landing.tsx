import { Link } from 'wouter';
import { Button } from '@/components/ui';
import { Leaf, CheckCircle2, Calendar, CreditCard, Users, Settings, TrendingUp, RotateCw } from 'lucide-react';

export function LandingPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col font-sans">
      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 glass-panel border-b-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary font-display font-bold text-2xl tracking-tight">
            <Leaf className="w-8 h-8 fill-primary" />
            GreenSync
          </div>
          <div className="hidden md:flex items-center gap-8 font-medium text-sm text-foreground/80">
            <a href="#features" className="hover:text-primary transition-colors">Features</a>
            <a href="#pricing" className="hover:text-primary transition-colors">Pricing</a>
            <a href="#testimonials" className="hover:text-primary transition-colors">Testimonials</a>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm font-semibold hover:text-primary transition-colors hidden sm:block">Log in</Link>
            <Link href="/register">
              <Button className="rounded-full px-6">Start Free Trial</Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 md:pt-48 md:pb-32 px-4 relative overflow-hidden">
        {/* Decorative background blobs */}
        <div className="absolute top-0 right-0 -translate-y-12 translate-x-1/3 w-[800px] h-[800px] bg-primary/10 rounded-full blur-3xl -z-10" />
        <div className="absolute bottom-0 left-0 translate-y-1/3 -translate-x-1/3 w-[600px] h-[600px] bg-emerald-200/20 rounded-full blur-3xl -z-10" />
        
        <div className="max-w-7xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary font-semibold text-sm mb-8 animate-fade-in-up">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            The #1 Software for Lawn Care Pros
          </div>
          <h1 className="text-5xl md:text-7xl font-display font-extrabold tracking-tight text-foreground max-w-4xl mx-auto leading-tight mb-8">
            Run Your Lawn Care Business <span className="text-gradient">Smarter.</span>
          </h1>
          <p className="text-xl md:text-2xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
            Scheduling, invoicing, route optimization, and customer management—all in one beautiful, easy-to-use platform.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/register">
              <Button size="lg" className="w-full sm:w-auto rounded-full text-lg px-8 h-14">
                Start Your 14-Day Free Trial
              </Button>
            </Link>
            <Button size="lg" variant="outline" className="w-full sm:w-auto rounded-full text-lg px-8 h-14 bg-white">
              View Demo
            </Button>
          </div>
          <p className="mt-6 text-sm text-muted-foreground">No credit card required • Cancel anytime</p>
        </div>

        {/* Hero Image */}
        <div className="max-w-6xl mx-auto mt-20 relative">
          <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent z-10 h-full w-full" />
          {/* landing page hero scenic manicured lawn */}
          <img 
            src={`${import.meta.env.BASE_URL}images/landing-hero.png`}
            alt="Dashboard Preview" 
            className="w-full rounded-2xl md:rounded-[2rem] shadow-2xl shadow-primary/20 border border-white/20 object-cover object-center aspect-[16/9]"
          />
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-24 bg-white relative z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">Everything you need to grow</h2>
            <p className="text-lg text-muted-foreground">Ditch the spreadsheets and disconnected apps. GreenSync brings your entire operation into one place.</p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              { icon: Calendar, title: 'Smart Scheduling', desc: 'Drag-and-drop calendar with auto-routing to minimize drive time.' },
              { icon: CreditCard, title: 'Automated Invoicing', desc: 'Get paid faster with automated invoices and one-click credit card payments.' },
              { icon: RotateCw, title: 'Recurring Plans', desc: 'Set up weekly or bi-weekly mowing schedules that generate jobs automatically.' },
              { icon: Users, title: 'Customer CRM', desc: 'Keep track of properties, gate codes, notes, and service history.' },
              { icon: TrendingUp, title: 'Growth Analytics', desc: 'Real-time dashboard showing revenue, outstanding balances, and job stats.' },
              { icon: Settings, title: 'Team Management', desc: 'Assign jobs to crews, track time, and control access permissions.' }
            ].map((f, i) => (
              <div key={i} className="bg-background rounded-3xl p-8 border border-border/50 hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 hover:-translate-y-1">
                <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
                  <f.icon className="w-7 h-7 text-primary" />
                </div>
                <h3 className="text-xl font-bold mb-3">{f.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">Simple, transparent pricing</h2>
            <p className="text-lg text-muted-foreground">Choose the plan that fits your business size.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {/* Starter */}
            <div className="bg-card rounded-3xl p-8 border border-border shadow-sm">
              <h3 className="text-2xl font-bold mb-2">Starter</h3>
              <p className="text-muted-foreground mb-6">For solo operators</p>
              <div className="mb-8">
                <span className="text-5xl font-display font-bold">$49</span>
                <span className="text-muted-foreground">/mo</span>
              </div>
              <ul className="space-y-4 mb-8">
                {['1 User', 'Unlimited Customers', 'Basic Scheduling', 'Invoicing & Payments'].map((f, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-primary" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link href="/register">
                <Button className="w-full rounded-xl" variant="outline">Start Free Trial</Button>
              </Link>
            </div>

            {/* Growth */}
            <div className="bg-primary text-primary-foreground rounded-3xl p-8 border border-primary shadow-xl shadow-primary/25 relative transform md:-translate-y-4">
              <div className="absolute top-0 right-8 -translate-y-1/2 bg-accent text-primary px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">
                Most Popular
              </div>
              <h3 className="text-2xl font-bold mb-2">Growth</h3>
              <p className="text-primary-foreground/80 mb-6">For growing teams</p>
              <div className="mb-8">
                <span className="text-5xl font-display font-bold">$99</span>
                <span className="text-primary-foreground/80">/mo</span>
              </div>
              <ul className="space-y-4 mb-8">
                {['Up to 5 Users', 'Recurring Plans', 'Route Optimization', 'Estimates', 'SMS Notifications'].map((f, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-accent" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link href="/register">
                <Button className="w-full rounded-xl bg-white text-primary hover:bg-white/90">Start Free Trial</Button>
              </Link>
            </div>

            {/* Pro */}
            <div className="bg-card rounded-3xl p-8 border border-border shadow-sm">
              <h3 className="text-2xl font-bold mb-2">Pro</h3>
              <p className="text-muted-foreground mb-6">For established operations</p>
              <div className="mb-8">
                <span className="text-5xl font-display font-bold">$199</span>
                <span className="text-muted-foreground">/mo</span>
              </div>
              <ul className="space-y-4 mb-8">
                {['Unlimited Users', 'Advanced Automations', 'Review Requests', 'Custom Reporting', 'Priority Support'].map((f, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-primary" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link href="/register">
                <Button className="w-full rounded-xl" variant="outline">Start Free Trial</Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-foreground text-background py-12 text-center">
        <div className="flex items-center justify-center gap-2 font-display font-bold text-2xl mb-6">
          <Leaf className="w-6 h-6 fill-primary text-primary" />
          GreenSync
        </div>
        <p className="text-background/60 text-sm">© 2025 GreenSync SaaS. All rights reserved.</p>
      </footer>
    </div>
  );
}
