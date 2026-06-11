import React from 'react';
import { Link, useLocation } from 'wouter';
import { 
  LayoutDashboard, Users, CalendarDays, MapPin, Wrench, 
  Clock, RotateCw, FileText, CreditCard, Route as RouteIcon, 
  Zap, Users2, Settings, LogOut, Menu, Lock, Star, BarChart3, Filter, Megaphone, Bell
} from 'lucide-react';
import { useAuthState } from '@/hooks/use-auth-state';
import { Button } from './ui';
import { Logo } from './logo';
import { cn } from '@/lib/utils';
import { TrialBanner } from './trial-banner';

const PLAN_ORDER: Record<string, number> = { starter: 0, growth: 1, pro: 2 };

function timeAgo(iso: string): string {
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return '';
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

function formatAction(action: string): string {
  return action.replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

interface ActivityLog {
  id: number;
  action: string;
  entityType: string | null;
  userName: string | null;
  metadataJson: { actor?: string } | null;
  createdAt: string;
}

function actorLabel(log: ActivityLog): string | null {
  if (log.userName) return log.userName;
  if (log.metadataJson?.actor) return log.metadataJson.actor;
  return null;
}

function useActivityUnread() {
  const [unread, setUnread] = React.useState(0);

  const loadCount = React.useCallback(() => {
    fetch('/api/activity/unread-count')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d && typeof d.unread === 'number') setUnread(d.unread); })
      .catch(() => {});
  }, []);

  React.useEffect(() => {
    loadCount();
    const id = setInterval(loadCount, 60000);
    return () => clearInterval(id);
  }, [loadCount]);

  return { unread, setUnread };
}

function ActivityBell({ unread, onSeen }: { unread: number; onSeen: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [logs, setLogs] = React.useState<ActivityLog[]>([]);
  const [loading, setLoading] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      setLoading(true);
      try {
        const r = await fetch('/api/activity?limit=10');
        const d = r.ok ? await r.json() : null;
        if (d?.logs) setLogs(d.logs);
        await fetch('/api/activity/mark-seen', { method: 'POST' });
        onSeen();
      } catch {
        // ignore — bell is non-critical
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={toggle}
        className="relative p-2 rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        aria-label="Activity"
      >
        <Bell className="w-5 h-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-bold text-white bg-destructive rounded-full">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <span className="font-semibold text-sm">Activity</span>
            <Link href="/activity" onClick={() => setOpen(false)} className="text-xs text-primary hover:underline">View all</Link>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-8"><div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full" /></div>
            ) : logs.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No recent activity</p>
            ) : (
              logs.map(log => {
                const actor = actorLabel(log);
                return (
                  <div key={log.id} className="px-4 py-3 border-b border-border last:border-0 hover:bg-accent/50">
                    <p className="text-sm text-foreground">{formatAction(log.action)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {actor ? `${actor} · ` : ''}{timeAgo(log.createdAt)}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

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
  const role = (user as any)?.role as string | undefined;
  const isManager = role === 'owner' || role === 'admin';
  const { unread, setUnread } = useActivityUnread();

  const displayName =
    [(user as any)?.firstName, (user as any)?.lastName].filter(Boolean).join(' ') ||
    (user as any)?.email ||
    'User';
  const initials =
    displayName
      .split(' ')
      .map((s: string) => s[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'U';
  const roleLabel = role === 'owner' ? 'Owner' : role === 'admin' ? 'Admin' : role === 'staff' ? 'Staff' : role;

  const allNavItems: { href: string; icon: React.ElementType; label: string; requiredPlan?: 'growth' | 'pro' | null; managerOnly?: boolean }[] = [
    { href: '/dashboard',    icon: LayoutDashboard, label: 'Dashboard' },
    { href: '/calendar',     icon: CalendarDays,    label: 'Calendar' },
    { href: '/leads',        icon: Filter,           label: 'Leads',           requiredPlan: 'pro' },
    { href: '/customers',    icon: Users,            label: 'Customers' },
    { href: '/properties',   icon: MapPin,           label: 'Properties' },
    { href: '/services',     icon: Wrench,           label: 'Services' },
    { href: '/appointments', icon: Clock,            label: 'Appointments' },
    { href: '/invoices',     icon: CreditCard,       label: 'Invoices',                                managerOnly: true },
    { href: '/recurring',    icon: RotateCw,         label: 'Recurring Plans', requiredPlan: 'growth', managerOnly: true },
    { href: '/estimates',    icon: FileText,         label: 'Estimates' },
    { href: '/routes',       icon: RouteIcon,        label: 'Routes',          requiredPlan: 'growth', managerOnly: true },
    { href: '/reviews',      icon: Star,             label: 'Reviews',         requiredPlan: 'growth', managerOnly: true },
    { href: '/team',         icon: Users2,           label: 'Team',            requiredPlan: 'growth', managerOnly: true },
    { href: '/reporting',    icon: BarChart3,        label: 'Reporting',       requiredPlan: 'growth', managerOnly: true },
    { href: '/automations',  icon: Zap,              label: 'Automations',     requiredPlan: 'growth', managerOnly: true },
    { href: '/follow-ups',   icon: Megaphone,        label: 'Follow-Ups',      requiredPlan: 'growth', managerOnly: true },
    { href: '/settings',     icon: Settings,         label: 'Settings' },
  ];
  const navItems = allNavItems.filter(item => isManager || !item.managerOnly);

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 bg-card border-b border-border sticky top-0 z-50">
        <Logo className="h-8" />
        <div className="flex items-center gap-1">
          <ActivityBell unread={unread} onSeen={() => setUnread(0)} />
          <Button variant="ghost" size="icon" onClick={() => setIsMobileOpen(!isMobileOpen)}>
            <Menu className="w-6 h-6" />
          </Button>
        </div>
      </div>

      {/* Sidebar */}
      <div className={cn(
        "fixed inset-y-0 left-0 z-40 w-72 bg-card border-r border-border flex flex-col transition-transform duration-300 ease-in-out md:translate-x-0 md:static md:w-72",
        isMobileOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-6 hidden md:flex items-center justify-between">
          <Logo className="h-10" />
          <ActivityBell unread={unread} onSeen={() => setUnread(0)} />
        </div>

        <div className="px-4 py-2">
          <div className="p-4 rounded-xl bg-accent border border-primary/10 mb-4">
            <p className="text-[11px] font-medium text-muted-foreground truncate">{user?.company?.name || 'My Company'}</p>
            <div className="flex items-center gap-2 mt-1.5">
              <div className="w-8 h-8 shrink-0 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold">
                {initials}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{displayName}</p>
                {roleLabel && <p className="text-[11px] text-muted-foreground leading-tight">{roleLabel}</p>}
              </div>
            </div>
            <div className="flex items-center justify-between mt-2.5">
              <p className="text-xs text-muted-foreground capitalize flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-primary inline-block"></span>
                {plan || 'Free'} Plan
              </p>
              {isManager && (
                <Link href="/billing" className="text-[10px] font-semibold text-primary hover:underline">{plan === 'pro' ? 'Manage plan' : 'Upgrade'}</Link>
              )}
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
