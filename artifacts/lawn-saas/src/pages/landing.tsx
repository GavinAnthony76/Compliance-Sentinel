import { useState, useRef, useEffect } from 'react';
import { Link } from 'wouter';
import { Button } from '@/components/ui';
import { Logo } from '@/components/logo';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useGetPublicPlans } from '@workspace/api-client-react';
import { CheckCircle2, CreditCard, Users, Settings, TrendingUp, RotateCw, Check, MapPin, DollarSign, Phone, Home, Star, ArrowUpRight, Shield, Calendar, Navigation, FileText, Contact, ClipboardList, Zap, Clock, Fuel, Bell, Eye, PenLine, BadgeCheck, RefreshCw, Mail, Repeat, MessageSquare, ChevronRight } from 'lucide-react';

const TAB_DATA = [
  {
    id: 'scheduling',
    label: 'Smart Scheduling',
    icon: Calendar,
    headline: 'Your calendar, finally under control',
    bullets: [
      'Drag-and-drop calendar for easy job management',
      'Assign crew members to jobs instantly',
      'Set recurring appointments in seconds (Growth & Pro)',
      'Automatic email reminders — SMS on Growth & Pro',
    ],
    mockup: (
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
          <span className="font-bold text-gray-900">This Week</span>
          <span className="text-xs px-2.5 py-1 rounded-full border border-emerald-400 text-emerald-600 font-medium">14 Jobs</span>
        </div>
        <div className="grid grid-cols-5 gap-0 text-center border-b border-gray-100">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => (
            <div key={d} className="py-2 text-xs font-semibold text-gray-400 border-r last:border-r-0 border-gray-100">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-5 gap-1.5 p-3">
          <div className="col-span-1 space-y-1.5">
            <div className="rounded-lg bg-emerald-100 border border-emerald-200 px-2 py-1.5 text-xs font-semibold text-emerald-700">Harris · 9am</div>
            <div className="rounded-lg bg-emerald-100 border border-emerald-200 px-2 py-1.5 text-xs font-semibold text-emerald-700">Kim · 2pm</div>
          </div>
          <div className="col-span-1 space-y-1.5">
            <div className="rounded-lg bg-sky-100 border border-sky-200 px-2 py-1.5 text-xs font-semibold text-sky-700">Rivera · 10am</div>
          </div>
          <div className="col-span-1 space-y-1.5">
            <div className="rounded-lg bg-violet-100 border border-violet-200 px-2 py-1.5 text-xs font-semibold text-violet-700">Chen · 8am</div>
            <div className="rounded-lg bg-violet-100 border border-violet-200 px-2 py-1.5 text-xs font-semibold text-violet-700">Wong · 1pm</div>
          </div>
          <div className="col-span-1 space-y-1.5">
            <div className="rounded-lg bg-amber-100 border border-amber-200 px-2 py-1.5 text-xs font-semibold text-amber-700">Lee · 9am</div>
          </div>
          <div className="col-span-1 space-y-1.5">
            <div className="rounded-lg bg-emerald-100 border border-emerald-200 px-2 py-1.5 text-xs font-semibold text-emerald-700">Davis · 11am</div>
            <div className="rounded-lg bg-emerald-100 border border-emerald-200 px-2 py-1.5 text-xs font-semibold text-emerald-700">Park · 3pm</div>
          </div>
        </div>
        <div className="px-4 pb-3">
          <div className="flex items-center gap-2 px-3 py-2.5 bg-emerald-50 border border-emerald-100 rounded-xl">
            <Bell className="w-4 h-4 text-emerald-500 shrink-0" />
            <span className="text-xs text-gray-700">SMS reminder sent to <span className="font-bold">Margaret Harris</span></span>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'routing',
    label: 'Route Optimization',
    icon: Navigation,
    headline: 'Less time driving, more jobs done',
    bullets: [
      'Auto-sequence stops by location for maximum efficiency',
      'Cut fuel costs and drive time significantly',
      '"On My Way" customer notifications at each stop',
      'Live status updates per stop for your whole team',
    ],
    mockup: (
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
          <span className="font-bold text-gray-900">Today's Route</span>
          <span className="text-xs px-2.5 py-1 rounded-full bg-sky-100 text-sky-700 font-semibold border border-sky-200">8 Stops</span>
        </div>
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-xs text-gray-500"><Fuel className="w-3.5 h-3.5 text-emerald-500" /><span className="font-semibold text-emerald-600">Save 38 mi</span></div>
          <div className="flex items-center gap-1.5 text-xs text-gray-500"><Clock className="w-3.5 h-3.5 text-sky-500" /><span className="font-semibold text-sky-600">Save 52 min</span></div>
        </div>
        <div className="px-4 py-2 space-y-1.5">
          {[
            { num: 1, addr: '142 Maple Drive', status: 'Done', sc: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
            { num: 2, addr: '87 Birchwood Ln', status: 'En Route', sc: 'bg-sky-100 text-sky-700 border-sky-200' },
            { num: 3, addr: '304 Cedar Ave', status: 'Pending', sc: 'bg-gray-100 text-gray-500 border-gray-200' },
            { num: 4, addr: '55 Oakwood Blvd', status: 'Pending', sc: 'bg-gray-100 text-gray-500 border-gray-200' },
          ].map(({ num, addr, status, sc }) => (
            <div key={num} className="flex items-center gap-3 px-3 py-2.5 bg-gray-50 border border-gray-100 rounded-xl">
              <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center shrink-0">
                <span className="text-xs font-bold text-white">{num}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-800 truncate">{addr}</div>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold shrink-0 ${sc}`}>{status}</span>
            </div>
          ))}
        </div>
        <div className="h-3" />
      </div>
    ),
  },
  {
    id: 'invoicing',
    label: 'Invoicing & Payments',
    icon: CreditCard,
    headline: 'Get paid faster, automatically',
    bullets: [
      'Auto-generated invoices after every completed job',
      'One-click online payment collection',
      'Card-on-file autopay for Pro accounts',
      'Track outstanding balances at a glance',
    ],
    mockup: (
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
          <span className="font-bold text-gray-900">Invoice #1042</span>
          <span className="text-xs px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 font-semibold border border-amber-200">Unpaid</span>
        </div>
        <div className="px-5 py-3 border-b border-gray-100">
          <div className="text-3xl font-bold text-gray-900">$285.00</div>
          <div className="text-xs text-gray-400 mt-0.5">Green Horizons · Due Jun 30, 2025</div>
        </div>
        <div className="px-4 py-2 space-y-1.5">
          {[['Lawn Mowing (2×)', '$160'], ['Edge Trimming', '$65'], ['Fertilization', '$60']].map(([item, price]) => (
            <div key={item} className="flex items-center justify-between px-3 py-2.5 bg-indigo-50 border border-indigo-100 rounded-xl">
              <span className="text-sm font-medium text-gray-700">{item}</span>
              <span className="text-sm font-bold text-gray-900">{price}</span>
            </div>
          ))}
        </div>
        <div className="px-4 py-3">
          <button className="w-full py-2.5 bg-primary rounded-xl text-white text-sm font-bold flex items-center justify-center gap-2">
            <DollarSign className="w-4 h-4" />Pay Now — One Click
          </button>
        </div>
      </div>
    ),
  },
  {
    id: 'crm',
    label: 'Customer CRM',
    icon: Users,
    headline: 'Every customer detail, always at hand',
    bullets: [
      'Full property and contact history in one place',
      'Store gate codes and special service notes',
      'Complete service history at a glance',
      'Attach photos and documents to any property',
    ],
    mockup: (
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
          <span className="font-bold text-gray-900">Customer Profile</span>
          <span className="text-xs px-2.5 py-1 rounded-full border border-emerald-400 text-emerald-600 font-medium">Active</span>
        </div>
        <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-100">
          <div className="w-10 h-10 rounded-full bg-violet-100 flex items-center justify-center shrink-0">
            <span className="text-sm font-bold text-violet-700">MH</span>
          </div>
          <div>
            <div className="text-sm font-bold text-gray-900">Margaret Harris</div>
            <div className="text-xs text-gray-400 flex items-center gap-1"><Phone className="w-3 h-3" />(555) 248-0193</div>
          </div>
        </div>
        <div className="px-4 py-2 space-y-1.5">
          <div className="flex items-center gap-3 px-3 py-2.5 bg-violet-50 border border-violet-100 rounded-xl">
            <Home className="w-4 h-4 text-violet-500 shrink-0" />
            <span className="text-sm text-gray-700">142 Maple Drive · Gate: <span className="font-bold text-gray-900">4821</span></span>
          </div>
          <div className="flex items-center gap-3 px-3 py-2.5 bg-violet-50 border border-violet-100 rounded-xl">
            <Star className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="text-sm text-gray-700">Morning visits · Dog in backyard</span>
          </div>
          {[['Lawn Mowing', 'Jun 10'], ['Fertilization', 'May 28']].map(([svc, date]) => (
            <div key={svc} className="flex items-center justify-between px-3 py-2.5 bg-violet-50 border border-violet-100 rounded-xl">
              <span className="text-sm font-medium text-gray-800">{svc}</span>
              <span className="text-xs text-gray-400">{date}</span>
            </div>
          ))}
        </div>
        <div className="h-3" />
      </div>
    ),
  },
  {
    id: 'estimates',
    label: 'Estimates',
    icon: ClipboardList,
    headline: 'Win more jobs before you even show up',
    bullets: [
      'Line-item estimates with automatic tax calculation',
      'Digital signature collection from customers',
      'Convert accepted estimates to invoices in one click',
      'Track sent, accepted, and declined estimates',
    ],
    mockup: (
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
          <span className="font-bold text-gray-900">Estimate #E-084</span>
          <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 font-semibold border border-emerald-200">Accepted</span>
        </div>
        <div className="px-5 py-3 border-b border-gray-100">
          <div className="text-3xl font-bold text-gray-900">$420.00</div>
          <div className="text-xs text-gray-400 mt-0.5">Chen Residence · Sent Jun 12, 2025</div>
        </div>
        <div className="px-4 py-2 space-y-1.5">
          {[['Lawn Mowing (4×)', '$220'], ['Hedge Trimming', '$120'], ['Mulch Bed Refresh', '$80']].map(([item, price]) => (
            <div key={item} className="flex items-center justify-between px-3 py-2.5 bg-emerald-50 border border-emerald-100 rounded-xl">
              <span className="text-sm font-medium text-gray-700">{item}</span>
              <span className="text-sm font-bold text-gray-900">{price}</span>
            </div>
          ))}
        </div>
        <div className="px-4 py-3 border-t border-gray-100">
          <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl">
            <PenLine className="w-4 h-4 text-gray-400 shrink-0" />
            <span className="text-xs text-gray-500 italic">Signed by customer · Jun 13, 2025</span>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'automations',
    label: 'Automations',
    icon: Zap,
    headline: 'Set it once, let it run your business',
    bullets: [
      'Auto-send review requests after every completed job (Growth & Pro)',
      'Automated follow-up campaigns for leads & customers (Growth & Pro)',
      'Win-back campaigns for lapsed customers (Pro)',
      'Build custom trigger-and-action rules with the automation engine (Pro)',
    ],
    mockup: (
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
          <span className="font-bold text-gray-900">Automation Rules</span>
          <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 font-semibold border border-emerald-200">3 Active</span>
        </div>
        <div className="px-4 py-2 space-y-2.5 pt-3">
          {[
            { trigger: 'Job Completed', action: 'Send Review Request', icon: Star, color: 'amber' },
            { trigger: 'Invoice Overdue 7d', action: 'Send Payment Reminder', icon: Mail, color: 'red' },
            { trigger: 'No Service 60d', action: 'Send Win-Back Offer', icon: RefreshCw, color: 'sky' },
          ].map(({ trigger, action, icon: Icon, color }) => (
            <div key={trigger} className="rounded-xl border border-gray-100 bg-gray-50 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
                <span className="text-xs text-gray-400 font-medium uppercase tracking-wide">Trigger</span>
                <ChevronRight className="w-3 h-3 text-gray-300" />
                <span className="text-xs font-semibold text-gray-700">{trigger}</span>
              </div>
              <div className={`flex items-center gap-2 px-3 py-2 bg-${color}-50`}>
                <Icon className={`w-3.5 h-3.5 text-${color}-500 shrink-0`} />
                <span className="text-xs font-semibold text-gray-800">{action}</span>
                <span className="ml-auto text-xs px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">ON</span>
              </div>
            </div>
          ))}
        </div>
        <div className="h-3" />
      </div>
    ),
  },
];

interface PricingPlan {
  id: string;
  name: string;
  price: number;
  tagline?: string;
  features: string[];
  isPopular?: boolean;
}

// Fallback shown if the plan catalog API is unavailable. The DB-backed catalog
// (served via GET /api/plans) is the source of truth; keep this in sync only as
// a last-resort default.
const PRICING_FALLBACK: PricingPlan[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: 49,
    tagline: 'For solo operators getting organized',
    isPopular: false,
    features: [
      '1 user',
      '50 active customers',
      '100 appointments/month',
      '10 estimates/month',
      '25 invoices/month',
      'Customer CRM',
      'Scheduling calendar',
      'Invoicing & payments',
      'Public booking page',
      'Email reminders',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    price: 99,
    tagline: 'For growing crews',
    isPopular: true,
    features: [
      'Up to 5 users',
      '250 active customers',
      '500 appointments/month',
      '100 estimates/month',
      '250 invoices/month',
      'Route optimization',
      'Recurring plans',
      'Customer portal',
      'SMS notifications',
      'Review requests',
      'GPS tracking',
      'Before/after photos',
      'Follow-up campaigns',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 199,
    tagline: 'For established outdoor service businesses',
    isPopular: false,
    features: [
      'Unlimited users',
      'Unlimited customers',
      'Unlimited appointments',
      'Unlimited estimates',
      'Unlimited invoices',
      'AI Estimate Builder',
      'Lead Pipeline',
      'Advanced Analytics',
      'Data Export',
      'API Access',
      'Advanced Automations',
      'Autopay',
      'Priority Support',
    ],
  },
];

export function LandingPage() {
  usePageMeta({
    title: 'GreenSynk | Outdoor Service Business Management Software',
    description: 'GreenSynk helps landscaping, lawn care, irrigation, and outdoor service companies manage customers, crews, schedules, routes, estimates, invoices, payments, and growth from one platform.',
  });
  const { data: plansData } = useGetPublicPlans();
  const pricingPlans: PricingPlan[] = plansData?.plans?.length
    ? (plansData.plans as PricingPlan[])
    : PRICING_FALLBACK;
  const [activeTab, setActiveTab] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [showDemo, setShowDemo] = useState(false);
  const [showDemoRequest, setShowDemoRequest] = useState(false);
  const [demoForm, setDemoForm] = useState({ name: '', email: '', phone: '', company: '', message: '' });
  const [demoSubmitting, setDemoSubmitting] = useState(false);
  const [demoSubmitted, setDemoSubmitted] = useState(false);
  const [demoError, setDemoError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const [featuredReviews, setFeaturedReviews] = useState<{ reviewerName: string; rating: number; comment: string | null; companyName: string }[]>([]);

  useEffect(() => {
    fetch('/api/public/reviews-featured?limit=3')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.reviews?.length) setFeaturedReviews(d.reviews); })
      .catch(() => {});
  }, []);

  function initials(name: string) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '★';
  }

  async function handleDemoSubmit(e: React.FormEvent) {
    e.preventDefault();
    setDemoSubmitting(true);
    setDemoError('');
    try {
      const res = await fetch('/api/contact/demo-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(demoForm),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Something went wrong');
      }
      setDemoSubmitted(true);
    } catch (err: any) {
      setDemoError(err.message || 'Could not send request. Please try again.');
    } finally {
      setDemoSubmitting(false);
    }
  }

  function switchTab(index: number) {
    if (index === activeTab) return;
    setAnimating(true);
    setTimeout(() => {
      setActiveTab(index);
      setAnimating(false);
    }, 180);
  }

  const tab = TAB_DATA[activeTab];

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans">
      {/* Demo Request Modal */}
      {showDemoRequest && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => { setShowDemoRequest(false); setDemoSubmitted(false); setDemoError(''); }}>
          <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl p-8" onClick={e => e.stopPropagation()}>
            <button className="absolute top-4 right-4 text-gray-400 hover:text-gray-600" onClick={() => { setShowDemoRequest(false); setDemoSubmitted(false); setDemoError(''); }}>
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            {demoSubmitted ? (
              <div className="text-center py-8">
                <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-2">Request received!</h3>
                <p className="text-gray-500">We'll be in touch within one business day to schedule your demo.</p>
                <button className="mt-6 px-6 py-2 rounded-full bg-primary text-white font-semibold hover:bg-primary/90 transition" onClick={() => { setShowDemoRequest(false); setDemoSubmitted(false); }}>Close</button>
              </div>
            ) : (
              <>
                <h3 className="text-2xl font-bold text-gray-900 mb-1">Schedule a Demo</h3>
                <p className="text-gray-500 mb-6 text-sm">Fill in your details and we'll reach out to set up a personalized walkthrough.</p>
                <form onSubmit={handleDemoSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                      <input required className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" value={demoForm.name} onChange={e => setDemoForm(f => ({ ...f, name: e.target.value }))} placeholder="Jane Smith" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                      <input required type="email" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" value={demoForm.email} onChange={e => setDemoForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@example.com" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                      <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" value={demoForm.phone} onChange={e => setDemoForm(f => ({ ...f, phone: e.target.value }))} placeholder="(555) 000-0000" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Company</label>
                      <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" value={demoForm.company} onChange={e => setDemoForm(f => ({ ...f, company: e.target.value }))} placeholder="Green Lawns Co." />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
                    <textarea rows={3} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" value={demoForm.message} onChange={e => setDemoForm(f => ({ ...f, message: e.target.value }))} placeholder="Tell us a bit about your business..." />
                  </div>
                  {demoError && <p className="text-sm text-red-600">{demoError}</p>}
                  <button type="submit" disabled={demoSubmitting} className="w-full py-3 rounded-full bg-primary text-white font-bold text-sm hover:bg-primary/90 transition disabled:opacity-60">
                    {demoSubmitting ? 'Sending...' : 'Request Demo'}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {/* Demo Video Modal */}
      {showDemo && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => { setShowDemo(false); videoRef.current?.pause(); }}
        >
          <div
            className="relative w-full max-w-4xl max-h-[90vh] rounded-2xl overflow-hidden shadow-2xl bg-black flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="absolute top-3 right-3 z-10 bg-black/50 hover:bg-black/80 text-white rounded-full w-8 h-8 flex items-center justify-center transition-colors"
              onClick={() => { setShowDemo(false); videoRef.current?.pause(); }}
            >
              ✕
            </button>
            <video
              ref={videoRef}
              src={`${import.meta.env.BASE_URL}greensyncad1.mp4`}
              className="w-full h-auto max-h-[90vh] object-contain"
              controls
              autoPlay
              muted
              playsInline
              loop={false}
            />
          </div>
        </div>
      )}
      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 glass-panel border-b-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <Logo className="h-10" />
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
            The Operating System for Outdoor Service Businesses
          </div>
          <h1 className="text-5xl md:text-7xl font-display font-extrabold tracking-tight text-foreground max-w-4xl mx-auto leading-tight mb-8">
            Run Your Outdoor Service Business <span className="text-gradient">Smarter.</span>
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
            <Button size="lg" variant="outline" className="w-full sm:w-auto rounded-full text-lg px-8 h-14 bg-white" onClick={() => setShowDemo(true)}>
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
            src={`${import.meta.env.BASE_URL}images/landing-hero.webp`}
            alt="Landscaped residential lawn in front of a home" 
            className="w-full rounded-2xl md:rounded-[2rem] shadow-2xl shadow-primary/20 border border-white/20 object-cover object-center aspect-[16/9]"
          />
        </div>
      </section>

      {/* Customer Logo Strip */}
      <section className="py-14 bg-white relative z-20 border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-center text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-8">
            Trusted by outdoor service professionals across the country
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 md:gap-4">
            {[
              { name: 'GreenScapes Pro', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
              { name: 'Precision Lawn', color: 'bg-sky-100 text-sky-700 border-sky-200' },
              { name: 'EverGreen Solutions', color: 'bg-green-100 text-green-700 border-green-200' },
              { name: 'TurfMaster Pro', color: 'bg-teal-100 text-teal-700 border-teal-200' },
              { name: 'CutRight Services', color: 'bg-lime-100 text-lime-700 border-lime-200' },
              { name: 'Elite Lawn Systems', color: 'bg-violet-100 text-violet-700 border-violet-200' },
            ].map(({ name, color }) => (
              <span key={name} className={`px-5 py-2.5 rounded-full border font-semibold text-sm tracking-tight ${color}`}>
                {name}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Stats Bar */}
      <section className="py-14 bg-gray-50 border-y border-gray-100 relative z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-center divide-y md:divide-y-0 md:divide-x divide-gray-200">
            {[
              { value: '500+', label: 'Businesses' },
              { value: '50,000', label: 'Jobs Scheduled' },
              { value: '$8M+', label: 'Invoiced' },
            ].map(({ value, label }) => (
              <div key={label} className="flex flex-col items-center py-8 md:py-4 md:px-16 first:pt-0 last:pb-0 md:first:pt-4 md:last:pb-4 first:md:pl-0 last:md:pr-0 w-full md:w-auto">
                <span className="text-5xl md:text-6xl font-display font-extrabold text-primary tracking-tight">{value}</span>
                <span className="mt-2 text-sm font-semibold text-muted-foreground uppercase tracking-widest">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-24 bg-white relative z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">Everything you need to grow</h2>
            <p className="text-lg text-muted-foreground">Ditch the spreadsheets and disconnected apps. GreenSynk brings your entire operation into one place.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">

            {/* Feature 1: Recurring Plans */}
            <div className="bg-gradient-to-br from-emerald-100 via-green-50 to-emerald-100 rounded-3xl border border-emerald-200/60 overflow-hidden hover:shadow-xl hover:shadow-emerald-100 transition-all duration-300 hover:-translate-y-1 relative">
              <div className="absolute top-3 right-3 w-20 h-20 bg-emerald-200/50 rounded-full" />
              <div className="absolute bottom-24 left-2 w-12 h-12 bg-green-200/40 rounded-full" />
              {/* Floating white panel */}
              <div className="mx-5 mt-6 bg-white rounded-2xl shadow-lg overflow-hidden relative z-10">
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
                  <span className="font-bold text-gray-900">Recurring Plans</span>
                  <span className="text-xs px-2.5 py-1 rounded-full border border-emerald-400 text-emerald-600 font-medium">Auto-scheduling</span>
                </div>
                <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100">
                  <div className="flex bg-gray-100 rounded-full p-0.5">
                    <span className="px-4 py-1 bg-primary text-white text-sm font-semibold rounded-full">Weekly</span>
                    <span className="px-4 py-1 text-gray-500 text-sm">Bi-Weekly</span>
                  </div>
                  <div className="ml-auto w-11 h-6 bg-primary rounded-full flex items-center px-0.5">
                    <div className="w-5 h-5 bg-white rounded-full shadow ml-auto" />
                  </div>
                </div>
                <div className="px-4 py-2 space-y-1.5">
                  {['Mowing every Friday', 'Trimming & Edging', 'Fertilization (Seasonal)'].map((item) => (
                    <div key={item} className="flex items-center gap-3 px-3 py-2.5 bg-emerald-50 border border-emerald-100 rounded-xl">
                      <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center shrink-0">
                        <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
                      </div>
                      <span className="text-sm font-medium text-gray-800">{item}</span>
                    </div>
                  ))}
                </div>
                <div className="h-3" />
              </div>
              {/* Text on gradient */}
              <div className="px-6 pt-5 pb-6 relative z-10">
                <div className="w-10 h-10 bg-emerald-200 rounded-xl flex items-center justify-center mb-3">
                  <RotateCw className="w-5 h-5 text-emerald-700" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-1">Recurring Plans</h3>
                <p className="text-gray-600 text-sm leading-relaxed">Set weekly or bi-weekly schedules to generate jobs automatically.</p>
              </div>
            </div>

            {/* Feature 2: Automated Invoicing */}
            <div className="bg-gradient-to-br from-indigo-100 via-blue-50 to-indigo-100 rounded-3xl border border-indigo-200/60 overflow-hidden hover:shadow-xl hover:shadow-indigo-100 transition-all duration-300 hover:-translate-y-1 relative">
              <div className="absolute top-3 right-3 w-20 h-20 bg-indigo-200/50 rounded-full" />
              <div className="absolute bottom-24 left-2 w-12 h-12 bg-blue-200/40 rounded-full" />
              <div className="mx-5 mt-6 bg-white rounded-2xl shadow-lg overflow-hidden relative z-10">
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
                  <span className="font-bold text-gray-900">Invoice #1042</span>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 font-semibold border border-amber-200">Unpaid</span>
                </div>
                <div className="px-5 py-3 border-b border-gray-100">
                  <div className="text-3xl font-bold text-gray-900">$285.00</div>
                  <div className="text-xs text-gray-400 mt-0.5">Green Horizons · Due Jun 30, 2025</div>
                </div>
                <div className="px-4 py-2 space-y-1.5">
                  {[['Lawn Mowing (2×)', '$160'], ['Edge Trimming', '$65'], ['Fertilization', '$60']].map(([item, price]) => (
                    <div key={item} className="flex items-center justify-between px-3 py-2.5 bg-indigo-50 border border-indigo-100 rounded-xl">
                      <span className="text-sm font-medium text-gray-700">{item}</span>
                      <span className="text-sm font-bold text-gray-900">{price}</span>
                    </div>
                  ))}
                </div>
                <div className="px-4 py-3">
                  <button className="w-full py-2.5 bg-primary rounded-xl text-white text-sm font-bold flex items-center justify-center gap-2">
                    <DollarSign className="w-4 h-4" />Pay Now — One Click
                  </button>
                </div>
              </div>
              <div className="px-6 pt-5 pb-6 relative z-10">
                <div className="w-10 h-10 bg-indigo-200 rounded-xl flex items-center justify-center mb-3">
                  <CreditCard className="w-5 h-5 text-indigo-700" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-1">Automated Invoicing</h3>
                <p className="text-gray-600 text-sm leading-relaxed">Auto-generated invoices after every job. Customers pay instantly — no chasing checks.</p>
              </div>
            </div>

            {/* Feature 3: Smart Route Planning */}
            <div className="bg-gradient-to-br from-sky-100 via-blue-50 to-sky-100 rounded-3xl border border-sky-200/60 overflow-hidden hover:shadow-xl hover:shadow-sky-100 transition-all duration-300 hover:-translate-y-1 relative">
              <div className="absolute top-3 right-3 w-20 h-20 bg-sky-200/50 rounded-full" />
              <div className="mx-5 mt-6 bg-white rounded-2xl shadow-lg overflow-hidden relative z-10">
                <img
                  src={`${import.meta.env.BASE_URL}images/smartroute.webp`}
                  alt="Route planning interface showing optimized service stops"
                  loading="lazy"
                  decoding="async"
                  className="w-full object-cover object-center"
                />
              </div>
              <div className="px-6 pt-5 pb-6 relative z-10">
                <div className="w-10 h-10 bg-sky-200 rounded-xl flex items-center justify-center mb-3">
                  <MapPin className="w-5 h-5 text-sky-700" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-1">Smart Route Planning</h3>
                <p className="text-gray-600 text-sm leading-relaxed">Auto-optimize daily routes to cut drive time and fuel costs. More jobs done, less time in the truck.</p>
              </div>
            </div>

          </div>

          <div className="grid md:grid-cols-3 gap-8 mt-8">

            {/* Feature 4: Customer CRM */}
            <div className="bg-gradient-to-br from-violet-100 via-purple-50 to-violet-100 rounded-3xl border border-violet-200/60 overflow-hidden hover:shadow-xl hover:shadow-violet-100 transition-all duration-300 hover:-translate-y-1 relative">
              <div className="absolute top-3 right-3 w-20 h-20 bg-violet-200/50 rounded-full" />
              <div className="absolute bottom-24 left-2 w-12 h-12 bg-purple-200/40 rounded-full" />
              <div className="mx-5 mt-6 bg-white rounded-2xl shadow-lg overflow-hidden relative z-10">
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
                  <span className="font-bold text-gray-900">Customer Profile</span>
                  <span className="text-xs px-2.5 py-1 rounded-full border border-emerald-400 text-emerald-600 font-medium">Active</span>
                </div>
                <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-100">
                  <div className="w-10 h-10 rounded-full bg-violet-100 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-violet-700">MH</span>
                  </div>
                  <div>
                    <div className="text-sm font-bold text-gray-900">Margaret Harris</div>
                    <div className="text-xs text-gray-400 flex items-center gap-1"><Phone className="w-3 h-3" />(555) 248-0193</div>
                  </div>
                </div>
                <div className="px-4 py-2 space-y-1.5">
                  <div className="flex items-center gap-3 px-3 py-2.5 bg-violet-50 border border-violet-100 rounded-xl">
                    <Home className="w-4 h-4 text-violet-500 shrink-0" />
                    <span className="text-sm text-gray-700">142 Maple Drive · Gate: <span className="font-bold text-gray-900">4821</span></span>
                  </div>
                  <div className="flex items-center gap-3 px-3 py-2.5 bg-violet-50 border border-violet-100 rounded-xl">
                    <Star className="w-4 h-4 text-amber-400 shrink-0" />
                    <span className="text-sm text-gray-700">Morning visits · Dog in backyard</span>
                  </div>
                  {[['Lawn Mowing', 'Jun 10'], ['Fertilization', 'May 28']].map(([svc, date]) => (
                    <div key={svc} className="flex items-center justify-between px-3 py-2.5 bg-violet-50 border border-violet-100 rounded-xl">
                      <span className="text-sm font-medium text-gray-800">{svc}</span>
                      <span className="text-xs text-gray-400">{date}</span>
                    </div>
                  ))}
                </div>
                <div className="h-3" />
              </div>
              <div className="px-6 pt-5 pb-6 relative z-10">
                <div className="w-10 h-10 bg-violet-200 rounded-xl flex items-center justify-center mb-3">
                  <Users className="w-5 h-5 text-violet-700" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-1">Customer CRM</h3>
                <p className="text-gray-600 text-sm leading-relaxed">Track every property, gate code, and preference. Full service history always at your fingertips.</p>
              </div>
            </div>

            {/* Feature 5: Growth Analytics */}
            <div className="bg-gradient-to-br from-amber-100 via-orange-50 to-amber-100 rounded-3xl border border-amber-200/60 overflow-hidden hover:shadow-xl hover:shadow-amber-100 transition-all duration-300 hover:-translate-y-1 relative">
              <div className="absolute top-3 right-3 w-20 h-20 bg-amber-200/50 rounded-full" />
              <div className="absolute bottom-24 left-2 w-12 h-12 bg-orange-200/40 rounded-full" />
              <div className="mx-5 mt-6 bg-white rounded-2xl shadow-lg overflow-hidden relative z-10">
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
                  <span className="font-bold text-gray-900">Revenue · Jun 2025</span>
                  <span className="text-xs px-2.5 py-1 rounded-full border border-emerald-400 text-emerald-600 font-medium flex items-center gap-1"><ArrowUpRight className="w-3 h-3" />+18%</span>
                </div>
                <div className="px-5 py-3 border-b border-gray-100">
                  <div className="text-3xl font-bold text-gray-900">$12,480</div>
                  <div className="flex items-end gap-0.5 h-14 mt-3">
                    {[38, 52, 44, 68, 58, 78, 63, 85, 73, 92, 100, 80].map((h, i) => (
                      <div key={i} className="flex-1 rounded-t-sm" style={{ height: `${h}%`, background: i >= 9 ? '#22c55e' : `rgba(34,197,94,${0.12 + i * 0.06})` }} />
                    ))}
                  </div>
                </div>
                <div className="px-4 py-2 space-y-1.5">
                  {[['47 Jobs Done', 'This month'], ['$1,840 Outstanding', 'Awaiting payment'], ['$265 Avg Job', 'Per service']].map(([val, sub]) => (
                    <div key={val} className="flex items-center justify-between px-3 py-2.5 bg-amber-50 border border-amber-100 rounded-xl">
                      <span className="text-sm font-bold text-gray-900">{val}</span>
                      <span className="text-xs text-gray-400">{sub}</span>
                    </div>
                  ))}
                </div>
                <div className="h-3" />
              </div>
              <div className="px-6 pt-5 pb-6 relative z-10">
                <div className="w-10 h-10 bg-amber-200 rounded-xl flex items-center justify-center mb-3">
                  <TrendingUp className="w-5 h-5 text-amber-700" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-1">Growth Analytics</h3>
                <p className="text-gray-600 text-sm leading-relaxed">Revenue charts, outstanding balances, and job stats so you always know where your business stands.</p>
              </div>
            </div>

            {/* Feature 6: Team Management */}
            <div className="bg-gradient-to-br from-sky-100 via-cyan-50 to-sky-100 rounded-3xl border border-sky-200/60 overflow-hidden hover:shadow-xl hover:shadow-sky-100 transition-all duration-300 hover:-translate-y-1 relative">
              <div className="absolute top-3 right-3 w-20 h-20 bg-sky-200/50 rounded-full" />
              <div className="absolute bottom-24 left-2 w-12 h-12 bg-cyan-200/40 rounded-full" />
              <div className="mx-5 mt-6 bg-white rounded-2xl shadow-lg overflow-hidden relative z-10">
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
                  <span className="font-bold text-gray-900">Your Team</span>
                  <span className="text-xs px-2.5 py-1 rounded-full border border-sky-400 text-sky-600 font-medium">4 active</span>
                </div>
                <div className="px-4 py-2 space-y-1.5">
                  {[
                    { initials: 'AW', name: 'Alex Wilson',  role: 'Owner',     jobs: 8,  ic: 'bg-sky-100 text-sky-700',          bc: 'bg-sky-100 text-sky-700 border-sky-200',    rb: 'bg-sky-50 border-sky-100' },
                    { initials: 'JR', name: 'Jake Rivera',  role: 'Crew Lead', jobs: 5,  ic: 'bg-emerald-100 text-emerald-700',   bc: 'bg-emerald-100 text-emerald-700 border-emerald-200', rb: 'bg-sky-50 border-sky-100' },
                    { initials: 'TM', name: 'Tina Moore',   role: 'Crew',      jobs: 4,  ic: 'bg-purple-100 text-purple-700',     bc: 'bg-gray-100 text-gray-500 border-gray-200', rb: 'bg-sky-50 border-sky-100' },
                    { initials: 'DS', name: 'Dan Shaw',     role: 'Crew',      jobs: 3,  ic: 'bg-orange-100 text-orange-700',     bc: 'bg-gray-100 text-gray-500 border-gray-200', rb: 'bg-sky-50 border-sky-100' },
                  ].map((m) => (
                    <div key={m.initials} className={`flex items-center gap-3 px-3 py-2.5 ${m.rb} border rounded-xl`}>
                      <div className={`w-8 h-8 rounded-full ${m.ic} flex items-center justify-center shrink-0`}>
                        <span className="text-xs font-bold">{m.initials}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-gray-800">{m.name}</div>
                        <div className="text-xs text-gray-400">{m.jobs} jobs today</div>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${m.bc} font-semibold shrink-0`}>{m.role}</span>
                    </div>
                  ))}
                </div>
                <div className="h-3" />
              </div>
              <div className="px-6 pt-5 pb-6 relative z-10">
                <div className="w-10 h-10 bg-sky-200 rounded-xl flex items-center justify-center mb-3">
                  <Shield className="w-5 h-5 text-sky-700" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-1">Team Management</h3>
                <p className="text-gray-600 text-sm leading-relaxed">Add crew members, assign jobs, set permissions, and see who's doing what — all from one place.</p>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* Feature Tab Carousel */}
      <section className="py-24 bg-background relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[900px] bg-primary/5 rounded-full blur-3xl -z-0" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">Everything your business needs, in one place</h2>
            <p className="text-lg text-muted-foreground">Go deep on any feature. GreenSynk is built from the ground up for landscaping, lawn care, irrigation, and outdoor service professionals.</p>
          </div>

          {/* Tab Strip */}
          <div className="overflow-x-auto pb-1 mb-10" style={{ WebkitOverflowScrolling: 'touch' }}>
            <div className="flex gap-1 w-max mx-auto">
              {TAB_DATA.map((t, i) => {
                const Icon = t.icon;
                const isActive = i === activeTab;
                return (
                  <button
                    key={t.id}
                    onClick={() => switchTab(i)}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold transition-all duration-200 whitespace-nowrap border ${
                      isActive
                        ? 'bg-primary text-white border-primary shadow-md shadow-primary/25'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-primary/40 hover:text-primary'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tab Content */}
          <div
            className="grid md:grid-cols-2 gap-10 lg:gap-16 items-center transition-opacity duration-200"
            style={{ opacity: animating ? 0 : 1 }}
          >
            {/* Left: Copy */}
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold mb-4">
                {(() => { const Icon = tab.icon; return <Icon className="w-3.5 h-3.5" />; })()}
                {tab.label}
              </div>
              <h3 className="text-2xl md:text-3xl font-display font-bold text-foreground mb-6 leading-tight">{tab.headline}</h3>
              <ul className="space-y-3.5">
                {tab.bullets.map((bullet) => (
                  <li key={bullet} className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center shrink-0 mt-0.5">
                      <Check className="w-3 h-3 text-white" strokeWidth={3} />
                    </div>
                    <span className="text-base text-foreground/80 leading-snug">{bullet}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-8">
                <Link href="/register">
                  <Button className="rounded-full px-6">Try it free</Button>
                </Link>
              </div>
            </div>

            {/* Right: Mockup */}
            <div className="relative">
              <div className="absolute inset-0 -m-4 bg-gradient-to-br from-primary/10 via-emerald-50/40 to-transparent rounded-3xl" />
              <div className="relative z-10 p-4">
                {tab.mockup}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Mid-Page CTA */}
      <section className="py-24 bg-primary relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(255,255,255,0.08)_0%,_transparent_60%)]" />
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <h2 className="text-3xl md:text-4xl font-display font-extrabold text-white tracking-tight mb-4">
            See GreenSynk in action
          </h2>
          <p className="text-lg text-white/80 mb-10 leading-relaxed">
            Join outdoor service businesses saving time, organizing crews, and growing revenue.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/register">
              <Button size="lg" className="w-full sm:w-auto rounded-full text-lg px-8 h-14 bg-white text-primary hover:bg-white/90 font-bold">
                Start Your Free Trial
              </Button>
            </Link>
            <Button size="lg" variant="outline" className="w-full sm:w-auto rounded-full text-lg px-8 h-14 border-white text-white hover:bg-white/10 bg-transparent font-bold" onClick={() => setShowDemoRequest(true)}>
              Schedule a Demo
            </Button>
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
            {pricingPlans.map((plan) => {
              const popular = plan.isPopular === true;
              return (
                <div
                  key={plan.id}
                  className={popular
                    ? 'bg-primary text-primary-foreground rounded-3xl p-8 border border-primary shadow-xl shadow-primary/25 relative transform md:-translate-y-4'
                    : 'bg-card rounded-3xl p-8 border border-border shadow-sm'}
                >
                  {popular && (
                    <div className="absolute top-0 right-8 -translate-y-1/2 bg-accent text-primary px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">
                      Most Popular
                    </div>
                  )}
                  <h3 className="text-2xl font-bold mb-2">{plan.name}</h3>
                  <p className={popular ? 'text-primary-foreground/80 mb-6' : 'text-muted-foreground mb-6'}>{plan.tagline}</p>
                  <div className="mb-8">
                    <span className="text-5xl font-display font-bold">${plan.price}</span>
                    <span className={popular ? 'text-primary-foreground/80' : 'text-muted-foreground'}>/mo</span>
                  </div>
                  <ul className="space-y-4 mb-8">
                    {plan.features.map((f, i) => (
                      <li key={i} className="flex items-center gap-3">
                        <CheckCircle2 className={popular ? 'w-5 h-5 text-accent' : 'w-5 h-5 text-primary'} />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Link href="/register">
                    <Button
                      className={popular ? 'w-full rounded-xl bg-white text-primary hover:bg-white/90' : 'w-full rounded-xl'}
                      variant={popular ? 'default' : 'outline'}
                    >
                      Start Free Trial
                    </Button>
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section id="testimonials" className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">Trusted by outdoor service professionals</h2>
            <p className="text-lg text-muted-foreground">See what business owners are saying about GreenSynk.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {featuredReviews.length > 0 ? featuredReviews.map((rev, idx) => {
              const primary = idx === 1;
              return (
                <div key={idx} className={primary
                  ? "bg-primary text-primary-foreground rounded-3xl p-8 border border-primary shadow-xl shadow-primary/20 flex flex-col"
                  : "bg-background rounded-3xl p-8 border border-border shadow-sm flex flex-col"}>
                  <div className="flex gap-1 mb-4">
                    {[...Array(5)].map((_, s) => (
                      <Star key={s} className={`w-4 h-4 ${s < rev.rating
                        ? (primary ? 'fill-white text-white' : 'fill-amber-400 text-amber-400')
                        : (primary ? 'text-white/30' : 'text-gray-300')}`} />
                    ))}
                  </div>
                  <p className={`leading-relaxed flex-1 ${primary ? 'text-primary-foreground/90' : 'text-muted-foreground'}`}>{rev.comment ? `"${rev.comment}"` : ''}</p>
                  <div className={`flex items-center gap-3 mt-6 pt-6 border-t ${primary ? 'border-primary-foreground/20' : 'border-border'}`}>
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${primary ? 'bg-white/20 text-white' : 'bg-primary/10 text-primary'}`}>{initials(rev.reviewerName)}</div>
                    <div>
                      <div className="font-semibold text-sm">{rev.reviewerName}</div>
                      <div className={`text-xs ${primary ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{rev.companyName}</div>
                    </div>
                  </div>
                </div>
              );
            }) : (<>
            <div className="bg-background rounded-3xl p-8 border border-border shadow-sm flex flex-col">
              <div className="flex gap-1 mb-4">
                {[...Array(5)].map((_, i) => <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />)}
              </div>
              <p className="text-muted-foreground leading-relaxed flex-1">"GreenSynk cut my admin time in half. I used to spend Sunday evenings doing invoices — now they go out automatically the moment I mark a job complete. My customers love how professional it looks."</p>
              <div className="flex items-center gap-3 mt-6 pt-6 border-t border-border">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">TH</div>
                <div>
                  <div className="font-semibold text-sm">Travis Hendricks</div>
                  <div className="text-xs text-muted-foreground">Hendricks Lawn & Landscape · Austin, TX</div>
                </div>
              </div>
            </div>
            <div className="bg-primary text-primary-foreground rounded-3xl p-8 border border-primary shadow-xl shadow-primary/20 flex flex-col">
              <div className="flex gap-1 mb-4">
                {[...Array(5)].map((_, i) => <Star key={i} className="w-4 h-4 fill-white text-white" />)}
              </div>
              <p className="text-primary-foreground/90 leading-relaxed flex-1">"We grew from 40 to 110 customers in one season and GreenSynk scaled right with us. The route planning alone saves my crew 45 minutes a day. Worth every penny of the Pro plan."</p>
              <div className="flex items-center gap-3 mt-6 pt-6 border-t border-primary-foreground/20">
                <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white font-bold text-sm shrink-0">MR</div>
                <div>
                  <div className="font-semibold text-sm">Maria Reyes</div>
                  <div className="text-xs text-primary-foreground/70">GreenEdge Services · Phoenix, AZ</div>
                </div>
              </div>
            </div>
            <div className="bg-background rounded-3xl p-8 border border-border shadow-sm flex flex-col">
              <div className="flex gap-1 mb-4">
                {[...Array(5)].map((_, i) => <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />)}
              </div>
              <p className="text-muted-foreground leading-relaxed flex-1">"The customer portal is a game changer. My clients can log in, see their upcoming appointments, pay invoices, and accept estimates without ever calling me. I actually get weekends back now."</p>
              <div className="flex items-center gap-3 mt-6 pt-6 border-t border-border">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">DK</div>
                <div>
                  <div className="font-semibold text-sm">Derek Kim</div>
                  <div className="text-xs text-muted-foreground">Pristine Yards Co. · Nashville, TN</div>
                </div>
              </div>
            </div>
            </>)}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-foreground text-background pt-16 pb-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-10 mb-12">
            {/* Brand column */}
            <div>
              <Logo variant="white" className="h-9 mb-3" />
              <p className="text-background/60 text-sm leading-relaxed">
                The all-in-one platform built for outdoor service professionals who want to grow smarter.
              </p>
            </div>

            {/* Product column */}
            <div>
              <h4 className="font-semibold text-sm uppercase tracking-widest text-background/40 mb-4">Product</h4>
              <ul className="space-y-2.5">
                {[
                  { label: 'Features', href: '/#features' },
                  { label: 'Pricing', href: '/#pricing' },
                  { label: 'Testimonials', href: '/#testimonials' },
                ].map((item) => (
                  <li key={item.label}>
                    <a href={item.href} className="text-background/70 hover:text-background text-sm transition-colors">{item.label}</a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Company column */}
            <div>
              <h4 className="font-semibold text-sm uppercase tracking-widest text-background/40 mb-4">Company</h4>
              <ul className="space-y-2.5">
                {[
                  { label: 'About', href: '/about' },
                  { label: 'Contact', href: '/contact' },
                ].map((item) => (
                  <li key={item.label}>
                    <Link href={item.href} className="text-background/70 hover:text-background text-sm transition-colors">{item.label}</Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Legal column */}
            <div>
              <h4 className="font-semibold text-sm uppercase tracking-widest text-background/40 mb-4">Legal</h4>
              <ul className="space-y-2.5">
                {[
                  { label: 'Privacy Policy', href: '/privacy' },
                  { label: 'Terms of Service', href: '/terms' },
                  { label: 'Cookie Policy', href: '/cookies' },
                ].map((item) => (
                  <li key={item.label}>
                    <Link href={item.href} className="text-background/70 hover:text-background text-sm transition-colors">{item.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="border-t border-background/10 pt-8 text-center">
            <p className="text-background/40 text-sm">© 2026 GreenSynk. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
