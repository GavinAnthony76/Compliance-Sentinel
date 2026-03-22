import { Link } from 'wouter';
import { Button } from '@/components/ui';
import { Leaf, CheckCircle2, Calendar, CreditCard, Users, Settings, TrendingUp, RotateCw, Check, MapPin, Navigation, DollarSign, Clock, Phone, Home, Star, ArrowUpRight, Shield } from 'lucide-react';

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
            <div className="bg-background rounded-3xl border border-border/50 overflow-hidden hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 hover:-translate-y-1 group">
              {/* Mini UI Mockup */}
              <div className="bg-gradient-to-br from-emerald-50 to-green-100 p-5 relative overflow-hidden">
                <div className="bg-white rounded-2xl shadow-lg shadow-black/10 p-4 mx-2">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-bold text-sm text-gray-800">Recurring Plans</span>
                    <span className="text-xs text-gray-400">Auto-scheduling</span>
                  </div>
                  {/* Frequency toggle */}
                  <div className="flex items-center justify-between bg-gray-50 rounded-xl p-2.5 mb-3">
                    <span className="text-xs font-medium text-gray-600">Weekly</span>
                    <div className="w-10 h-5 bg-primary rounded-full relative flex items-center px-0.5">
                      <div className="w-4 h-4 bg-white rounded-full shadow ml-auto" />
                    </div>
                    <span className="text-xs text-gray-400">Bi-Weekly</span>
                  </div>
                  {/* Upcoming jobs list */}
                  <div className="space-y-1.5">
                    {['Mon, Jun 16', 'Wed, Jun 18', 'Mon, Jun 23', 'Wed, Jun 25'].map((d, i) => (
                      <div key={i} className="flex items-center gap-2.5 py-1">
                        <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center shrink-0">
                          <Check className="w-3 h-3 text-white" />
                        </div>
                        <span className="text-xs text-gray-700">{d}</span>
                        <span className="ml-auto text-xs text-primary font-medium">Lawn Mowing</span>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Decorative blobs */}
                <div className="absolute -top-6 -right-6 w-24 h-24 bg-primary/10 rounded-full" />
                <div className="absolute -bottom-4 -left-4 w-16 h-16 bg-emerald-200/50 rounded-full" />
              </div>
              {/* Text */}
              <div className="p-7">
                <div className="w-11 h-11 bg-primary/10 rounded-xl flex items-center justify-center mb-4">
                  <RotateCw className="w-5 h-5 text-primary" />
                </div>
                <h3 className="text-xl font-bold mb-2">Recurring Plans</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">Set up weekly or bi-weekly mowing schedules that generate jobs automatically — no manual rescheduling needed.</p>
              </div>
            </div>

            {/* Feature 2: Automated Invoicing */}
            <div className="bg-background rounded-3xl border border-border/50 overflow-hidden hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 hover:-translate-y-1 group">
              {/* Mini UI Mockup */}
              <div className="bg-gradient-to-br from-slate-800 to-slate-900 p-5 relative overflow-hidden">
                <div className="bg-slate-700/50 rounded-2xl p-4 mx-2 border border-slate-600/50">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-slate-300 font-medium">Invoice #1042</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300 font-medium">Unpaid</span>
                  </div>
                  <div className="text-2xl font-bold text-white mb-1">$285.00</div>
                  <div className="text-xs text-slate-400 mb-4">Green Horizons · Due Jun 30</div>
                  {/* Line items */}
                  <div className="space-y-1.5 mb-4 border-t border-slate-600/50 pt-3">
                    {[['Lawn Mowing (2×)', '$160'], ['Edge Trimming', '$65'], ['Fertilization', '$60']].map(([item, price]) => (
                      <div key={item} className="flex justify-between text-xs">
                        <span className="text-slate-300">{item}</span>
                        <span className="text-white font-medium">{price}</span>
                      </div>
                    ))}
                  </div>
                  {/* Pay button */}
                  <button className="w-full py-2.5 bg-primary rounded-xl text-white text-xs font-bold flex items-center justify-center gap-2">
                    <DollarSign className="w-3.5 h-3.5" />Pay Now — One Click
                  </button>
                </div>
                {/* Glow effect */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-40 bg-primary/20 rounded-full blur-3xl" />
              </div>
              {/* Text */}
              <div className="p-7">
                <div className="w-11 h-11 bg-primary/10 rounded-xl flex items-center justify-center mb-4">
                  <CreditCard className="w-5 h-5 text-primary" />
                </div>
                <h3 className="text-xl font-bold mb-2">Automated Invoicing</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">Get paid faster with auto-generated invoices after every job. Customers pay instantly online — no chasing checks.</p>
              </div>
            </div>

            {/* Feature 3: Smart Route Planning */}
            <div className="bg-background rounded-3xl border border-border/50 overflow-hidden hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 hover:-translate-y-1 group">
              {/* Mini UI Mockup */}
              <div className="bg-gradient-to-br from-blue-50 to-indigo-100 p-5 relative overflow-hidden">
                <div className="bg-white rounded-2xl shadow-lg shadow-black/10 p-4 mx-2">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-bold text-sm text-gray-800">Today's Route</span>
                    <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1"><Clock className="w-3 h-3" />Save 28 min</span>
                  </div>
                  {/* Route stops */}
                  <div className="space-y-2 mb-3">
                    {[
                      { name: 'Anderson Property', time: '8:00 AM', color: 'bg-emerald-500' },
                      { name: 'Brooks Residence', time: '9:30 AM', color: 'bg-blue-500' },
                      { name: 'Chen Estate', time: '11:00 AM', color: 'bg-purple-500' },
                      { name: 'Davis Home', time: '1:30 PM', color: 'bg-orange-500' },
                    ].map((stop, i) => (
                      <div key={i} className="flex items-center gap-2.5">
                        <div className={`w-2 h-2 rounded-full ${stop.color} shrink-0`} />
                        <div className="flex-1">
                          <span className="text-xs font-medium text-gray-800">{stop.name}</span>
                        </div>
                        <span className="text-xs text-gray-400">{stop.time}</span>
                      </div>
                    ))}
                  </div>
                  {/* Mini map placeholder */}
                  <div className="rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 h-16 flex items-center justify-center relative overflow-hidden">
                    <div className="absolute inset-0 opacity-20">
                      {/* Grid lines */}
                      {[0,1,2,3,4].map(i => <div key={i} className="absolute border-slate-400" style={{ left: `${i * 25}%`, top: 0, bottom: 0, borderLeftWidth: 1 }} />)}
                      {[0,1,2].map(i => <div key={i} className="absolute border-slate-400" style={{ top: `${i * 50}%`, left: 0, right: 0, borderTopWidth: 1 }} />)}
                    </div>
                    {/* Route dots */}
                    {[{ x: '15%', y: '25%', c: 'bg-emerald-500' }, { x: '35%', y: '55%', c: 'bg-blue-500' }, { x: '62%', y: '30%', c: 'bg-purple-500' }, { x: '82%', y: '65%', c: 'bg-orange-500' }].map((pt, i) => (
                      <div key={i} className={`absolute w-3 h-3 rounded-full ${pt.c} border-2 border-white shadow`} style={{ left: pt.x, top: pt.y }} />
                    ))}
                    {/* Route line */}
                    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 200 80">
                      <polyline points="30,20 70,44 124,24 164,52" fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="4,2" opacity="0.6" />
                    </svg>
                    <Navigation className="w-5 h-5 text-blue-600 relative z-10 opacity-30" />
                  </div>
                </div>
                <div className="absolute -top-4 -right-4 w-20 h-20 bg-blue-200/40 rounded-full" />
              </div>
              {/* Text */}
              <div className="p-7">
                <div className="w-11 h-11 bg-primary/10 rounded-xl flex items-center justify-center mb-4">
                  <MapPin className="w-5 h-5 text-primary" />
                </div>
                <h3 className="text-xl font-bold mb-2">Smart Route Planning</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">Auto-optimize your daily routes to cut drive time and fuel costs. More jobs done, less time in the truck.</p>
              </div>
            </div>

          </div>

          <div className="grid md:grid-cols-3 gap-8 mt-8">

            {/* Feature 4: Customer CRM */}
            <div className="bg-background rounded-3xl border border-border/50 overflow-hidden hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 hover:-translate-y-1">
              <div className="bg-gradient-to-br from-violet-50 to-purple-100 p-5 relative overflow-hidden">
                <div className="bg-white rounded-2xl shadow-lg shadow-black/10 p-4 mx-2">
                  {/* Customer header */}
                  <div className="flex items-center gap-3 mb-3 pb-3 border-b border-gray-100">
                    <div className="w-9 h-9 rounded-full bg-violet-100 flex items-center justify-center shrink-0">
                      <span className="text-sm font-bold text-violet-600">MH</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-gray-800">Margaret Harris</div>
                      <div className="text-xs text-gray-400 flex items-center gap-1"><Phone className="w-3 h-3" />(555) 248-0193</div>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium shrink-0">Active</span>
                  </div>
                  {/* Property details */}
                  <div className="space-y-1.5 mb-3">
                    <div className="flex items-start gap-2">
                      <Home className="w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0" />
                      <span className="text-xs text-gray-600">142 Maple Drive · Gate: <span className="font-semibold text-gray-800">4821</span></span>
                    </div>
                    <div className="flex items-start gap-2">
                      <Star className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                      <span className="text-xs text-gray-600">Morning visits only · Dog in yard</span>
                    </div>
                  </div>
                  {/* Service history */}
                  <div className="bg-gray-50 rounded-xl p-2.5">
                    <div className="text-xs font-semibold text-gray-500 mb-1.5">Service History</div>
                    {[['Lawn Mowing', 'Jun 10', 'text-emerald-600'], ['Fertilization', 'May 28', 'text-blue-600'], ['Edge Trim', 'May 14', 'text-purple-600']].map(([svc, date, color]) => (
                      <div key={svc} className="flex items-center justify-between py-0.5">
                        <span className={`text-xs font-medium ${color}`}>{svc}</span>
                        <span className="text-xs text-gray-400">{date}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="absolute -top-5 -right-5 w-20 h-20 bg-violet-200/40 rounded-full" />
                <div className="absolute -bottom-4 -left-4 w-14 h-14 bg-purple-200/30 rounded-full" />
              </div>
              <div className="p-7">
                <div className="w-11 h-11 bg-primary/10 rounded-xl flex items-center justify-center mb-4">
                  <Users className="w-5 h-5 text-primary" />
                </div>
                <h3 className="text-xl font-bold mb-2">Customer CRM</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">Track every property, gate code, pet, and preference. Full service history always at your fingertips.</p>
              </div>
            </div>

            {/* Feature 5: Growth Analytics */}
            <div className="bg-background rounded-3xl border border-border/50 overflow-hidden hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 hover:-translate-y-1">
              <div className="bg-gradient-to-br from-amber-50 to-orange-100 p-5 relative overflow-hidden">
                <div className="bg-white rounded-2xl shadow-lg shadow-black/10 p-4 mx-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-sm text-gray-800">Revenue</span>
                    <span className="text-xs text-emerald-600 font-semibold flex items-center gap-0.5">
                      <ArrowUpRight className="w-3.5 h-3.5" />+18% this month
                    </span>
                  </div>
                  <div className="text-2xl font-bold text-gray-900 mb-0.5">$12,480</div>
                  <div className="text-xs text-gray-400 mb-3">June 2025</div>
                  {/* Bar chart */}
                  <div className="flex items-end gap-1 h-14 mb-3">
                    {[40, 55, 45, 70, 60, 80, 65, 88, 75, 95, 100, 82].map((h, i) => (
                      <div
                        key={i}
                        className="flex-1 rounded-t"
                        style={{ height: `${h}%`, background: i >= 9 ? '#22c55e' : `rgba(34,197,94,${0.15 + i * 0.055})` }}
                      />
                    ))}
                  </div>
                  {/* Stats row */}
                  <div className="grid grid-cols-3 gap-2">
                    {[['47', 'Jobs Done'], ['$1,840', 'Outstanding'], ['$265', 'Avg Job']].map(([val, label]) => (
                      <div key={label} className="bg-gray-50 rounded-lg p-2 text-center">
                        <div className="text-xs font-bold text-gray-800">{val}</div>
                        <div className="text-xs text-gray-400 leading-tight mt-0.5">{label}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="absolute -top-5 -right-5 w-20 h-20 bg-orange-200/40 rounded-full" />
                <div className="absolute -bottom-4 -left-4 w-14 h-14 bg-amber-200/30 rounded-full" />
              </div>
              <div className="p-7">
                <div className="w-11 h-11 bg-primary/10 rounded-xl flex items-center justify-center mb-4">
                  <TrendingUp className="w-5 h-5 text-primary" />
                </div>
                <h3 className="text-xl font-bold mb-2">Growth Analytics</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">Real-time revenue charts, outstanding balances, and job stats so you always know where your business stands.</p>
              </div>
            </div>

            {/* Feature 6: Team Management */}
            <div className="bg-background rounded-3xl border border-border/50 overflow-hidden hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 hover:-translate-y-1">
              <div className="bg-gradient-to-br from-sky-50 to-cyan-100 p-5 relative overflow-hidden">
                <div className="bg-white rounded-2xl shadow-lg shadow-black/10 p-4 mx-2">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-bold text-sm text-gray-800">Your Team</span>
                    <span className="text-xs text-sky-600 font-semibold">4 active</span>
                  </div>
                  <div className="space-y-2.5">
                    {[
                      { initials: 'AW', name: 'Alex Wilson',  role: 'Owner',     jobs: '8 jobs',  avatarCls: 'bg-sky-100 text-sky-700',     badgeCls: 'bg-sky-100 text-sky-700' },
                      { initials: 'JR', name: 'Jake Rivera',  role: 'Crew Lead',  jobs: '5 jobs',  avatarCls: 'bg-emerald-100 text-emerald-700', badgeCls: 'bg-emerald-100 text-emerald-700' },
                      { initials: 'TM', name: 'Tina Moore',   role: 'Crew',       jobs: '4 jobs',  avatarCls: 'bg-purple-100 text-purple-700',  badgeCls: 'bg-gray-100 text-gray-500' },
                      { initials: 'DS', name: 'Dan Shaw',     role: 'Crew',       jobs: '3 jobs',  avatarCls: 'bg-orange-100 text-orange-700',  badgeCls: 'bg-gray-100 text-gray-500' },
                    ].map((m) => (
                      <div key={m.initials} className="flex items-center gap-2.5">
                        <div className={`w-8 h-8 rounded-full ${m.avatarCls} flex items-center justify-center shrink-0`}>
                          <span className="text-xs font-bold">{m.initials}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold text-gray-800 truncate">{m.name}</div>
                          <div className="text-xs text-gray-400">{m.jobs} today</div>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${m.badgeCls} font-medium shrink-0`}>{m.role}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="absolute -top-5 -right-5 w-20 h-20 bg-sky-200/40 rounded-full" />
                <div className="absolute -bottom-4 -left-4 w-14 h-14 bg-cyan-200/30 rounded-full" />
              </div>
              <div className="p-7">
                <div className="w-11 h-11 bg-primary/10 rounded-xl flex items-center justify-center mb-4">
                  <Shield className="w-5 h-5 text-primary" />
                </div>
                <h3 className="text-xl font-bold mb-2">Team Management</h3>
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
