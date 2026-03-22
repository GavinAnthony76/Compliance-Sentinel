import { Link } from 'wouter';
import { Button } from '@/components/ui';
import { Leaf, CheckCircle2, CreditCard, Users, Settings, TrendingUp, RotateCw, Check, MapPin, DollarSign, Phone, Home, Star, ArrowUpRight, Shield } from 'lucide-react';

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

          <div className="grid md:grid-cols-3 gap-8">

            {/* Feature 1: Recurring Plans */}
            <div className="bg-white rounded-3xl border border-border/50 overflow-hidden hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 hover:-translate-y-1">
              <div className="bg-gradient-to-b from-emerald-300 via-green-200 to-emerald-50 px-6 pt-6 pb-4">
                <div className="text-center mb-4">
                  <h3 className="text-xl font-bold text-gray-900">Recurring Plans</h3>
                  <p className="text-sm text-gray-600 mt-0.5">Auto-scheduling</p>
                </div>
                <div className="bg-white rounded-2xl shadow-md overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                    <span className="text-sm font-semibold text-gray-700">Weekly</span>
                    <div className="w-12 h-6 bg-primary rounded-full relative flex items-center px-0.5 cursor-pointer">
                      <div className="w-5 h-5 bg-white rounded-full shadow-sm ml-auto" />
                    </div>
                    <span className="text-sm text-gray-400">Bi-Weekly</span>
                  </div>
                  <div className="px-5 py-1">
                    {[['Mon, Jun 16', 'Lawn Mowing'], ['Wed, Jun 18', 'Lawn Mowing'], ['Mon, Jun 23', 'Lawn Mowing'], ['Wed, Jun 25', 'Lawn Mowing']].map(([date, svc]) => (
                      <div key={date} className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
                        <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center shrink-0">
                          <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
                        </div>
                        <span className="text-sm font-medium text-gray-800 flex-1">{date}</span>
                        <span className="text-sm text-gray-400">- {svc}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="px-6 py-5">
                <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center mb-3">
                  <RotateCw className="w-5 h-5 text-primary" />
                </div>
                <h3 className="text-lg font-bold mb-1">Recurring Plans</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">Set up weekly or bi-weekly mowing schedules that generate jobs automatically — no manual rescheduling needed.</p>
              </div>
            </div>

            {/* Feature 2: Automated Invoicing */}
            <div className="bg-white rounded-3xl border border-border/50 overflow-hidden hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 hover:-translate-y-1">
              <div className="bg-gradient-to-b from-slate-700 via-slate-800 to-slate-900 px-6 pt-6 pb-4">
                <div className="text-center mb-4">
                  <h3 className="text-xl font-bold text-white">Automated Invoicing</h3>
                  <p className="text-sm text-slate-400 mt-0.5">Get paid faster</p>
                </div>
                <div className="bg-white rounded-2xl shadow-md overflow-hidden">
                  <div className="px-5 pt-4 pb-3 border-b border-gray-100">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-gray-500 font-medium">Invoice #1042 · Green Horizons</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">Unpaid</span>
                    </div>
                    <div className="text-3xl font-bold text-gray-900">$285.00</div>
                    <div className="text-xs text-gray-400 mt-0.5">Due Jun 30, 2025</div>
                  </div>
                  <div className="px-5 py-3 space-y-2 border-b border-gray-100">
                    {[['Lawn Mowing (2×)', '$160'], ['Edge Trimming', '$65'], ['Fertilization', '$60']].map(([item, price]) => (
                      <div key={item} className="flex justify-between text-sm">
                        <span className="text-gray-600">{item}</span>
                        <span className="font-semibold text-gray-900">{price}</span>
                      </div>
                    ))}
                  </div>
                  <div className="px-5 py-3">
                    <button className="w-full py-2.5 bg-primary rounded-xl text-white text-sm font-bold flex items-center justify-center gap-2">
                      <DollarSign className="w-4 h-4" />Pay Now — One Click
                    </button>
                  </div>
                </div>
              </div>
              <div className="px-6 py-5">
                <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center mb-3">
                  <CreditCard className="w-5 h-5 text-primary" />
                </div>
                <h3 className="text-lg font-bold mb-1">Automated Invoicing</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">Get paid faster with auto-generated invoices after every job. Customers pay instantly online — no chasing checks.</p>
              </div>
            </div>

            {/* Feature 3: Smart Route Planning */}
            <div className="bg-white rounded-3xl border border-border/50 overflow-hidden hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 hover:-translate-y-1">
              <div className="bg-gradient-to-b from-sky-200 via-blue-100 to-sky-50 relative overflow-hidden">
                <img
                  src={`${import.meta.env.BASE_URL}images/smartroute.png`}
                  alt="Smart Route Planning"
                  className="w-full object-cover object-center"
                />
              </div>
              <div className="px-6 py-5">
                <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center mb-3">
                  <MapPin className="w-5 h-5 text-primary" />
                </div>
                <h3 className="text-lg font-bold mb-1">Smart Route Planning</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">Auto-optimize your daily routes to cut drive time and fuel costs. More jobs done, less time in the truck.</p>
              </div>
            </div>

          </div>

          <div className="grid md:grid-cols-3 gap-8 mt-8">

            {/* Feature 4: Customer CRM */}
            <div className="bg-white rounded-3xl border border-border/50 overflow-hidden hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 hover:-translate-y-1">
              <div className="bg-gradient-to-b from-violet-300 via-purple-200 to-violet-50 px-6 pt-6 pb-4">
                <div className="text-center mb-4">
                  <h3 className="text-xl font-bold text-gray-900">Customer CRM</h3>
                  <p className="text-sm text-gray-600 mt-0.5">Every detail, one place</p>
                </div>
                <div className="bg-white rounded-2xl shadow-md overflow-hidden">
                  <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-100">
                    <div className="w-10 h-10 rounded-full bg-violet-100 flex items-center justify-center shrink-0">
                      <span className="text-sm font-bold text-violet-600">MH</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-gray-800">Margaret Harris</div>
                      <div className="text-xs text-gray-400 flex items-center gap-1"><Phone className="w-3 h-3" />(555) 248-0193</div>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">Active</span>
                  </div>
                  <div className="px-5 py-3 space-y-2 border-b border-gray-100">
                    <div className="flex items-center gap-2.5 text-sm">
                      <Home className="w-4 h-4 text-gray-400 shrink-0" />
                      <span className="text-gray-600">142 Maple Drive · Gate: <span className="font-bold text-gray-900">4821</span></span>
                    </div>
                    <div className="flex items-center gap-2.5 text-sm">
                      <Star className="w-4 h-4 text-amber-400 shrink-0" />
                      <span className="text-gray-600">Morning visits · Dog in backyard</span>
                    </div>
                  </div>
                  <div className="px-5 py-3">
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Service History</div>
                    {[['Lawn Mowing', 'Jun 10', 'text-emerald-600'], ['Fertilization', 'May 28', 'text-blue-600'], ['Edge Trim', 'May 14', 'text-purple-600']].map(([svc, date, cls]) => (
                      <div key={svc} className="flex justify-between py-1 text-sm">
                        <span className={`font-medium ${cls}`}>{svc}</span>
                        <span className="text-gray-400">{date}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="px-6 py-5">
                <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center mb-3">
                  <Users className="w-5 h-5 text-primary" />
                </div>
                <h3 className="text-lg font-bold mb-1">Customer CRM</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">Track every property, gate code, pet, and preference. Full service history always at your fingertips.</p>
              </div>
            </div>

            {/* Feature 5: Growth Analytics */}
            <div className="bg-white rounded-3xl border border-border/50 overflow-hidden hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 hover:-translate-y-1">
              <div className="bg-gradient-to-b from-amber-300 via-orange-200 to-amber-50 px-6 pt-6 pb-4">
                <div className="text-center mb-4">
                  <h3 className="text-xl font-bold text-gray-900">Growth Analytics</h3>
                  <p className="text-sm text-gray-600 mt-0.5">Real-time business insights</p>
                </div>
                <div className="bg-white rounded-2xl shadow-md overflow-hidden">
                  <div className="px-5 pt-4 pb-3 border-b border-gray-100">
                    <div className="flex items-end justify-between">
                      <div>
                        <div className="text-3xl font-bold text-gray-900">$12,480</div>
                        <div className="text-xs text-gray-400 mt-0.5">Revenue · June 2025</div>
                      </div>
                      <span className="text-sm font-bold text-emerald-600 flex items-center gap-0.5 mb-1">
                        <ArrowUpRight className="w-4 h-4" />+18%
                      </span>
                    </div>
                  </div>
                  <div className="px-5 py-3 border-b border-gray-100">
                    <div className="flex items-end gap-1 h-16">
                      {[38, 52, 44, 68, 58, 78, 63, 85, 73, 92, 100, 80].map((h, i) => (
                        <div key={i} className="flex-1 rounded-t-sm" style={{ height: `${h}%`, background: i >= 9 ? '#22c55e' : `rgba(34,197,94,${0.12 + i * 0.06})` }} />
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 divide-x divide-gray-100">
                    {[['47', 'Jobs Done'], ['$1,840', 'Outstanding'], ['$265', 'Avg Job']].map(([val, label]) => (
                      <div key={label} className="py-3 text-center">
                        <div className="text-base font-bold text-gray-900">{val}</div>
                        <div className="text-xs text-gray-400 mt-0.5">{label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="px-6 py-5">
                <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center mb-3">
                  <TrendingUp className="w-5 h-5 text-primary" />
                </div>
                <h3 className="text-lg font-bold mb-1">Growth Analytics</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">Real-time revenue charts, outstanding balances, and job stats so you always know where your business stands.</p>
              </div>
            </div>

            {/* Feature 6: Team Management */}
            <div className="bg-white rounded-3xl border border-border/50 overflow-hidden hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 hover:-translate-y-1">
              <div className="bg-gradient-to-b from-sky-300 via-cyan-200 to-sky-50 px-6 pt-6 pb-4">
                <div className="text-center mb-4">
                  <h3 className="text-xl font-bold text-gray-900">Team Management</h3>
                  <p className="text-sm text-gray-600 mt-0.5">4 members · All active</p>
                </div>
                <div className="bg-white rounded-2xl shadow-md overflow-hidden">
                  {[
                    { initials: 'AW', name: 'Alex Wilson',  role: 'Owner',     jobs: 8,  avatarCls: 'bg-sky-100 text-sky-700',          badgeCls: 'bg-sky-100 text-sky-700' },
                    { initials: 'JR', name: 'Jake Rivera',  role: 'Crew Lead', jobs: 5,  avatarCls: 'bg-emerald-100 text-emerald-700',   badgeCls: 'bg-emerald-100 text-emerald-700' },
                    { initials: 'TM', name: 'Tina Moore',   role: 'Crew',      jobs: 4,  avatarCls: 'bg-purple-100 text-purple-700',     badgeCls: 'bg-gray-100 text-gray-500' },
                    { initials: 'DS', name: 'Dan Shaw',     role: 'Crew',      jobs: 3,  avatarCls: 'bg-orange-100 text-orange-700',     badgeCls: 'bg-gray-100 text-gray-500' },
                  ].map((m, i, arr) => (
                    <div key={m.initials} className={`flex items-center gap-3 px-5 py-3 ${i < arr.length - 1 ? 'border-b border-gray-100' : ''}`}>
                      <div className={`w-10 h-10 rounded-full ${m.avatarCls} flex items-center justify-center shrink-0`}>
                        <span className="text-sm font-bold">{m.initials}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-gray-800">{m.name}</div>
                        <div className="text-xs text-gray-400">{m.jobs} jobs today</div>
                      </div>
                      <span className={`text-xs px-2.5 py-1 rounded-full ${m.badgeCls} font-semibold shrink-0`}>{m.role}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="px-6 py-5">
                <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center mb-3">
                  <Shield className="w-5 h-5 text-primary" />
                </div>
                <h3 className="text-lg font-bold mb-1">Team Management</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">Add crew members, assign jobs, set permissions, and see who's doing what — all from one place.</p>
              </div>
            </div>

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
