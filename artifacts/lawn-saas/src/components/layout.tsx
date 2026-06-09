import React from 'react';
import { Link, useLocation } from 'wouter';
import { 
  LayoutDashboard, Users, CalendarDays, MapPin, Wrench, 
  Clock, RotateCw, FileText, CreditCard, Route as RouteIcon, 
  Zap, Users2, Settings, LogOut, Menu, Lock, Star, BarChart3, Filter, Megaphone
} from 'lucide-react';
import { useAuthState } from '@/hooks/use-auth-state';
import { Button } from './ui';
import { Logo } from './logo';
import { cn } from '@/lib/utils';
import { TrialBanner } from './trial-banner';

const PLAN_ORDER: Record<string, number> = { starter: 0, growth: 1, pro: 2 };

function planHasFeature(currentPlan: string | null | undefined, requiredPlan: 'growth' | 'pro' | null): boolean {
  if (!requiredPlan) return true;
  if (!currentPlan) return false;
  return (PLAN_ORDER[currentPlan] ?? -1) >= (PLAN_ORDER[requiredPlan] ?? 99);
}

interface NavItemProps {
  href: string;
  icon: React.ElementType;
  label: string;
  isActive: boolean;
  requiredPlan?: 'growth' | 'pro' | null;
  currentPlan?: string | null;
}

function NavItem({ href, icon: Icon, label, isActive, requiredPlan, currentPlan }: NavItemProps) {
  const locked = requiredPlan && !planHasFeature(currentPlan, requiredPlan);
  const badgeColors = requiredPlan === 'pro'
    ? 'bg-violet-100 text-violet-700'
    : 'bg-emerald-100 text-emerald-700';

  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 font-medium group",
        isActive
          ? "bg-primary text-primary-foreground shadow-md shadow-primary/25"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      <Icon className={cn("w-5 h-5 shrink-0", isActive ? "text-primary-foreground" : "text-muted-foreground group-hover:text-primary")} />
      <span className="flex-1 truncate">{label}</span>
      {locked && requiredPlan && (
        <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 capitalize", badgeColors)}>
          {requiredPlan === 'pro' ? 'Pro' : 'Growth'}
        </span>
      )}
      {locked && (
        <Lock className="w-3.5 h-3.5 shrink-0 text-muted-foreground/50" />
      )}
    </Link>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuthState();
  const [isMobileOpen, setIsMobileOpen] = React.useState(false);
  const plan = user?.company?.subscriptionPlan;

  const navItems: { href: string; icon: React.ElementType; label: string; requiredPlan?: 'growth' | 'pro' | null }[] = [
    { href: '/dashboard',    icon: LayoutDashboard, label: 'Dashboard' },
    { href: '/calendar',     icon: CalendarDays,    label: 'Calendar' },
    { href: '/leads',        icon: Filter,           label: 'Leads',           requiredPlan: 'pro' },
    { href: '/customers',    icon: Users,            label: 'Customers' },
    { href: '/properties',   icon: MapPin,           label: 'Properties' },
    { href: '/services',     icon: Wrench,           label: 'Services' },
    { href: '/appointments', icon: Clock,            label: 'Appointments' },
    { href: '/invoices',     icon: CreditCard,       label: 'Invoices' },
    { href: '/recurring',    icon: RotateCw,         label: 'Recurring Plans', requiredPlan: 'growth' },
    { href: '/estimates',    icon: FileText,         label: 'Estimates' },
    { href: '/routes',       icon: RouteIcon,        label: 'Routes',          requiredPlan: 'growth' },
    { href: '/reviews',      icon: Star,             label: 'Reviews',         requiredPlan: 'growth' },
    { href: '/team',         icon: Users2,           label: 'Team',            requiredPlan: 'growth' },
    { href: '/reporting',    icon: BarChart3,        label: 'Reporting',       requiredPlan: 'growth' },
    { href: '/automations',  icon: Zap,              label: 'Automations',     requiredPlan: 'growth' },
    { href: '/follow-ups',   icon: Megaphone,        label: 'Follow-Ups',      requiredPlan: 'growth' },
    { href: '/settings',     icon: Settings,         label: 'Settings' },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 bg-card border-b border-border sticky top-0 z-50">
        <Logo className="h-8" />
        <Button variant="ghost" size="icon" onClick={() => setIsMobileOpen(!isMobileOpen)}>
          <Menu className="w-6 h-6" />
        </Button>
      </div>

      {/* Sidebar */}
      <div className={cn(
        "fixed inset-y-0 left-0 z-40 w-72 bg-card border-r border-border flex flex-col transition-transform duration-300 ease-in-out md:translate-x-0 md:static md:w-72",
        isMobileOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-6 hidden md:flex items-center">
          <Logo className="h-10" />
        </div>

        <div className="px-4 py-2">
          <div className="p-4 rounded-xl bg-accent border border-primary/10 mb-4">
            <p className="text-sm font-semibold text-foreground truncate">{user?.company?.name || 'My Company'}</p>
            <div className="flex items-center justify-between mt-1">
              <p className="text-xs text-muted-foreground capitalize flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-primary inline-block"></span>
                {plan || 'Free'} Plan
              </p>
              <Link href="/billing" className="text-[10px] font-semibold text-primary hover:underline">Upgrade</Link>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-1 space-y-0.5 scrollbar-hide">
          {navItems.map((item) => (
            <NavItem
              key={item.href}
              {...item}
              isActive={location.startsWith(item.href)}
              currentPlan={plan}
            />
          ))}
        </div>

        <div className="p-4 mt-auto border-t border-border">
          <button
            onClick={logout}
            className="flex items-center gap-3 px-4 py-3 w-full rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors font-medium"
          >
            <LogOut className="w-5 h-5" />
            Sign Out
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 max-h-screen overflow-y-auto">
        <TrialBanner />
        <main className="flex-1 p-4 md:p-8 lg:p-10">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </main>
      </div>

      {/* Mobile Overlay */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-30 md:hidden"
          onClick={() => setIsMobileOpen(false)}
        />
      )}
    </div>
  );
}
