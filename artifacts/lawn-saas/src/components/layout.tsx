import React from 'react';
import { Link, useLocation } from 'wouter';
import { 
  LayoutDashboard, Users, CalendarDays, MapPin, Wrench, 
  Clock, RotateCw, FileText, CreditCard, Route as RouteIcon, 
  Star, Zap, Users2, Settings, LogOut, Menu, Leaf
} from 'lucide-react';
import { useAuthState } from '@/hooks/use-auth-state';
import { Button } from './ui';
import { cn } from '@/lib/utils';

interface NavItemProps {
  href: string;
  icon: React.ElementType;
  label: string;
  isActive: boolean;
}

function NavItem({ href, icon: Icon, label, isActive }: NavItemProps) {
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
      <Icon className={cn("w-5 h-5", isActive ? "text-primary-foreground" : "text-muted-foreground group-hover:text-primary")} />
      {label}
    </Link>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuthState();
  const [isMobileOpen, setIsMobileOpen] = React.useState(false);

  const navItems = [
    { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { href: '/calendar', icon: CalendarDays, label: 'Calendar' },
    { href: '/customers', icon: Users, label: 'Customers' },
    { href: '/properties', icon: MapPin, label: 'Properties' },
    { href: '/services', icon: Wrench, label: 'Services' },
    { href: '/appointments', icon: Clock, label: 'Appointments' },
    { href: '/invoices', icon: CreditCard, label: 'Invoices' },
    { href: '/recurring', icon: RotateCw, label: 'Recurring Plans' },
    { href: '/estimates', icon: FileText, label: 'Estimates' },
    { href: '/routes', icon: RouteIcon, label: 'Routes' },
    { href: '/team', icon: Users2, label: 'Team' },
    { href: '/settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 bg-card border-b border-border sticky top-0 z-50">
        <div className="flex items-center gap-2 text-primary font-display font-bold text-xl">
          <Leaf className="w-6 h-6 fill-primary" />
          GreenSync
        </div>
        <Button variant="ghost" size="icon" onClick={() => setIsMobileOpen(!isMobileOpen)}>
          <Menu className="w-6 h-6" />
        </Button>
      </div>

      {/* Sidebar */}
      <div className={cn(
        "fixed inset-y-0 left-0 z-40 w-72 bg-card border-r border-border flex flex-col transition-transform duration-300 ease-in-out md:translate-x-0 md:static md:w-72",
        isMobileOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-6 hidden md:flex items-center gap-3 text-primary font-display font-bold text-2xl tracking-tight">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Leaf className="w-6 h-6 fill-primary" />
          </div>
          GreenSync
        </div>

        <div className="px-6 py-2">
          <div className="p-4 rounded-xl bg-accent border border-primary/10 mb-6">
            <p className="text-sm font-semibold text-foreground truncate">{user?.company?.name || 'My Company'}</p>
            <p className="text-xs text-muted-foreground capitalize mt-1 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-primary inline-block"></span>
              {user?.company?.subscriptionPlan || 'Free'} Plan
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1 scrollbar-hide">
          {navItems.map((item) => (
            <NavItem 
              key={item.href} 
              {...item} 
              isActive={location.startsWith(item.href)} 
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
