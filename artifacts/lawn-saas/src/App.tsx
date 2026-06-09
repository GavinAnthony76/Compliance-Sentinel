import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, QueryCache } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuthState, TOKEN_KEY, ADMIN_TOKEN_KEY } from "@/hooks/use-auth-state";
import { Suspense, lazy, useEffect } from "react";

const NOINDEX_PATTERNS: RegExp[] = [
  /^\/login$/,
  /^\/register$/,
  /^\/forgot-password$/,
  /^\/forgot-username$/,
  /^\/reset-password$/,
  /^\/admin(\/.*)?$/,
  /^\/portal\/set-password$/,
  /^\/portal\/[^/]+(\/forgot-password|\/login|\/invoices|\/appointments|\/estimates)?$/,
  /^\/estimates\/[^/]+\/sign$/,
  /^\/(dashboard|calendar|customers|properties|services|appointments|invoices|recurring|routes|reviews|automations|follow-ups|team|reporting|settings|billing|leads|tech)(\/.*)?$/,
];

const CANONICAL_BASE = "https://greensynk.com";

function RobotsManager() {
  const [location] = useLocation();

  useEffect(() => {
    const isNoindex = NOINDEX_PATTERNS.some((re) => re.test(location));
    const content = isNoindex ? "noindex, nofollow" : "index, follow";

    let robotsMeta = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!robotsMeta) {
      robotsMeta = document.createElement("meta");
      robotsMeta.name = "robots";
      document.head.appendChild(robotsMeta);
    }
    robotsMeta.content = content;

    let canonicalLink = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (location === "/") {
      if (!canonicalLink) {
        canonicalLink = document.createElement("link");
        canonicalLink.rel = "canonical";
        document.head.appendChild(canonicalLink);
      }
      canonicalLink.href = `${CANONICAL_BASE}/`;
    } else if (canonicalLink) {
      canonicalLink.remove();
    }
  }, [location]);

  return null;
}

// Public pages — eagerly loaded (SEO-critical entry points)
import { LandingPage } from "@/pages/landing";
import { PublicBookingPage } from "@/pages/public-booking";

// SEO public pages — lazy loaded (crawlable but not hot-path)
const AboutPage = lazy(() => import("@/pages/about").then(m => ({ default: m.AboutPage })));
const ContactPage = lazy(() => import("@/pages/contact").then(m => ({ default: m.ContactPage })));
const PrivacyPage = lazy(() => import("@/pages/privacy").then(m => ({ default: m.PrivacyPage })));
const TermsPage = lazy(() => import("@/pages/terms").then(m => ({ default: m.TermsPage })));
const CookiesPage = lazy(() => import("@/pages/cookies").then(m => ({ default: m.CookiesPage })));

// Auth / misc public pages — lazy loaded
const LoginPage = lazy(() => import("@/pages/login").then(m => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import("@/pages/register").then(m => ({ default: m.RegisterPage })));
const AdminLoginPage = lazy(() => import("@/pages/admin-login").then(m => ({ default: m.AdminLoginPage })));
const ForgotPasswordPage = lazy(() => import("@/pages/forgot-password").then(m => ({ default: m.ForgotPasswordPage })));
const ForgotUsernamePage = lazy(() => import("@/pages/forgot-username").then(m => ({ default: m.ForgotUsernamePage })));
const ResetPasswordPage = lazy(() => import("@/pages/reset-password").then(m => ({ default: m.ResetPasswordPage })));
const AdminForgotPasswordPage = lazy(() => import("@/pages/admin-forgot-password").then(m => ({ default: m.AdminForgotPasswordPage })));
const AdminResetPasswordPage = lazy(() => import("@/pages/admin-reset-password").then(m => ({ default: m.AdminResetPasswordPage })));
const AdminChangePasswordPage = lazy(() => import("@/pages/admin-change-password").then(m => ({ default: m.AdminChangePasswordPage })));
const PortalForgotPasswordPage = lazy(() => import("@/pages/portal-forgot-password").then(m => ({ default: m.PortalForgotPasswordPage })));
const PortalLoginPage = lazy(() => import("@/pages/portal-login").then(m => ({ default: m.PortalLoginPage })));
const PortalSetPasswordPage = lazy(() => import("@/pages/portal-set-password").then(m => ({ default: m.PortalSetPasswordPage })));
const EstimateSignPage = lazy(() => import("@/pages/estimate-sign").then(m => ({ default: m.EstimateSignPage })));
const NotFound = lazy(() => import("@/pages/not-found"));

// Customer portal pages — lazy loaded
const PortalDashboardPage = lazy(() => import("@/pages/portal-dashboard").then(m => ({ default: m.PortalDashboardPage })));
const PortalInvoicesPage = lazy(() => import("@/pages/portal-invoices").then(m => ({ default: m.PortalInvoicesPage })));
const PortalAppointmentsPage = lazy(() => import("@/pages/portal-appointments").then(m => ({ default: m.PortalAppointmentsPage })));
const PortalEstimatesPage = lazy(() => import("@/pages/portal-estimates").then(m => ({ default: m.PortalEstimatesPage })));

// Company dashboard pages — lazy loaded
const DashboardPage = lazy(() => import("@/pages/dashboard").then(m => ({ default: m.DashboardPage })));
const CustomersPage = lazy(() => import("@/pages/customers").then(m => ({ default: m.CustomersPage })));
const CustomerDetailPage = lazy(() => import("@/pages/customer-detail").then(m => ({ default: m.CustomerDetailPage })));
const CalendarPage = lazy(() => import("@/pages/calendar").then(m => ({ default: m.CalendarPage })));
const PropertiesPage = lazy(() => import("@/pages/properties").then(m => ({ default: m.PropertiesPage })));
const ServicesPage = lazy(() => import("@/pages/services").then(m => ({ default: m.ServicesPage })));
const AppointmentsPage = lazy(() => import("@/pages/appointments").then(m => ({ default: m.AppointmentsPage })));
const InvoicesPage = lazy(() => import("@/pages/invoices").then(m => ({ default: m.InvoicesPage })));
const RecurringPage = lazy(() => import("@/pages/recurring").then(m => ({ default: m.RecurringPage })));
const EstimatesPage = lazy(() => import("@/pages/estimates").then(m => ({ default: m.EstimatesPage })));
const RoutesPage = lazy(() => import("@/pages/routes").then(m => ({ default: m.RoutesPage })));
const LeadsPage = lazy(() => import("@/pages/leads").then(m => ({ default: m.LeadsPage })));
const TechPage = lazy(() => import("@/pages/tech").then(m => ({ default: m.TechPage })));
const FollowUpsPage = lazy(() => import("@/pages/follow-ups").then(m => ({ default: m.FollowUpsPage })));
const ReviewsPage = lazy(() => import("@/pages/reviews").then(m => ({ default: m.ReviewsPage })));
const AutomationsPage = lazy(() => import("@/pages/automations").then(m => ({ default: m.AutomationsPage })));
const TeamPage = lazy(() => import("@/pages/team").then(m => ({ default: m.TeamPage })));
const ReportingPage = lazy(() => import("@/pages/reporting").then(m => ({ default: m.ReportingPage })));
const SettingsPage = lazy(() => import("@/pages/settings").then(m => ({ default: m.SettingsPage })));
const BillingPage = lazy(() => import("@/pages/billing").then(m => ({ default: m.BillingPage })));

// Admin pages — lazy loaded
const AdminDashboardPage = lazy(() => import("@/pages/admin-dashboard").then(m => ({ default: m.AdminDashboardPage })));
const AdminCompaniesPage = lazy(() => import("@/pages/admin-companies").then(m => ({ default: m.AdminCompaniesPage })));
const AdminCompanyDetailPage = lazy(() => import("@/pages/admin-companies").then(m => ({ default: m.AdminCompanyDetailPage })));
const AdminActivityPage = lazy(() => import("@/pages/admin-activity").then(m => ({ default: m.AdminActivityPage })));
const AdminBetaReadinessPage = lazy(() => import("@/pages/admin-beta-readiness").then(m => ({ default: m.AdminBetaReadinessPage })));
const AdminAdminsPage = lazy(() => import("@/pages/admin-admins").then(m => ({ default: m.AdminAdminsPage })));
const AdminBillingPage = lazy(() => import("@/pages/admin-billing").then(m => ({ default: m.AdminBillingPage })));
const AdminSettingsPage = lazy(() => import("@/pages/admin-settings").then(m => ({ default: m.AdminSettingsPage })));

// Monkey-patch fetch to automatically add Authorization headers
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  const [resource, config] = args;
  const url = typeof resource === 'string' ? resource : (resource instanceof Request ? resource.url : '');
  
  if (url.startsWith('/api')) {
    const isAdminRoute = url.startsWith('/api/admin');
    const token = localStorage.getItem(isAdminRoute ? ADMIN_TOKEN_KEY : TOKEN_KEY);
    
    if (token) {
      // Properly convert Headers instance to a plain object so existing
      // headers (e.g. Content-Type) are preserved when spreading
      const existingHeaders = config?.headers instanceof Headers
        ? Object.fromEntries((config.headers as Headers).entries())
        : (config?.headers ?? {});
      // Caller-supplied Authorization takes precedence — never overwrite it.
      // This matters for portal pages: the portal token is passed explicitly,
      // and the company token must not clobber it (same-browser testing).
      if (existingHeaders['authorization'] || existingHeaders['Authorization']) {
        return originalFetch(resource, config);
      }
      const newConfig = {
        ...config,
        headers: {
          ...existingHeaders,
          Authorization: `Bearer ${token}`,
        },
      };
      return originalFetch(resource, newConfig);
    }
  }
  return originalFetch(resource, config);
};

// Global 401 handler: clear the matching token so useAuthState
// picks it up and ProtectedRoute redirects to the login page.
// queryClient is referenced lazily (closure) — it is defined by the time
// any onError fires.
const queryCache = new QueryCache({
  onError: (error: any) => {
    if (error?.status === 401) {
      const url: string = error?.url ?? '';
      if (url.includes('/api/admin')) {
        localStorage.removeItem(ADMIN_TOKEN_KEY);
        queryClient.resetQueries({ queryKey: ['/api/admin/auth/me'] });
      } else if (url.includes('/api/')) {
        localStorage.removeItem(TOKEN_KEY);
        queryClient.resetQueries({ queryKey: ['/api/auth/me'] });
      }
    }
    if (error?.status === 402) {
      // Trial expired or subscription required — redirect to billing
      if (typeof window !== 'undefined' && !window.location.pathname.includes('/billing')) {
        window.location.href = '/billing';
      }
    }
  },
});

const queryClient = new QueryClient({
  queryCache,
  defaultOptions: {
    queries: {
      // Never retry auth/permission errors — they will not succeed on retry.
      retry: (failureCount, error: any) => {
        if (error?.status === 401 || error?.status === 403) return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
    },
  },
});

function ProtectedRoute({ component: Component, adminOnly = false }: { component: any, adminOnly?: boolean }) {
  const { isAuthenticated, isAdminAuthenticated, isLoading, adminUser } = useAuthState();
  const [, setLocation] = useLocation();
  const adminMustChangePassword = adminOnly && !!(adminUser as any)?.mustChangePassword;

  useEffect(() => {
    if (!isLoading) {
      if (adminOnly && !isAdminAuthenticated) {
        setLocation('/admin/login');
      } else if (adminMustChangePassword) {
        setLocation('/admin/change-password');
      } else if (!adminOnly && !isAuthenticated) {
        setLocation('/login');
      }
    }
  }, [isAuthenticated, isAdminAuthenticated, isLoading, adminOnly, adminMustChangePassword, setLocation]);

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-background"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  }

  return (adminOnly ? isAdminAuthenticated : isAuthenticated) ? <Component /> : null;
}

const PageFallback = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
  </div>
);

function Router() {
  return (
    <>
      <RobotsManager />
      <Suspense fallback={<PageFallback />}>
        <Switch>
          {/* Public routes — landing and booking are eagerly loaded for SEO */}
          <Route path="/" component={LandingPage} />
          <Route path="/book/:slug" component={PublicBookingPage} />

          {/* SEO public pages — lazy loaded */}
          <Route path="/about" component={AboutPage} />
          <Route path="/contact" component={ContactPage} />
          <Route path="/privacy" component={PrivacyPage} />
          <Route path="/terms" component={TermsPage} />
          <Route path="/cookies" component={CookiesPage} />

          {/* Auth routes — lazy loaded */}
          <Route path="/login" component={LoginPage} />
          <Route path="/register" component={RegisterPage} />
          <Route path="/admin/login" component={AdminLoginPage} />
          <Route path="/forgot-password" component={ForgotPasswordPage} />
          <Route path="/forgot-username" component={ForgotUsernamePage} />
          <Route path="/reset-password" component={ResetPasswordPage} />
          <Route path="/admin/forgot-password" component={AdminForgotPasswordPage} />
          <Route path="/admin/reset-password" component={AdminResetPasswordPage} />
          <Route path="/admin/change-password" component={AdminChangePasswordPage} />

          {/* Customer portal routes — lazy loaded */}
          <Route path="/portal/set-password" component={PortalSetPasswordPage} />
          <Route path="/portal/:slug/forgot-password" component={PortalForgotPasswordPage} />
          <Route path="/portal/:slug/login" component={PortalLoginPage} />
          <Route path="/portal/:slug/invoices" component={PortalInvoicesPage} />
          <Route path="/portal/:slug/appointments" component={PortalAppointmentsPage} />
          <Route path="/portal/:slug/estimates" component={PortalEstimatesPage} />
          <Route path="/portal/:slug" component={PortalDashboardPage} />

          {/* Public e-signature — lazy loaded */}
          <Route path="/estimates/:token/sign" component={EstimateSignPage} />

          {/* Company dashboard routes — lazy loaded */}
          <Route path="/dashboard"><ProtectedRoute component={DashboardPage} /></Route>
          <Route path="/calendar"><ProtectedRoute component={CalendarPage} /></Route>
          <Route path="/leads"><ProtectedRoute component={LeadsPage} /></Route>
          <Route path="/tech"><ProtectedRoute component={TechPage} /></Route>
          <Route path="/customers"><ProtectedRoute component={CustomersPage} /></Route>
          <Route path="/customers/:id"><ProtectedRoute component={CustomerDetailPage} /></Route>
          <Route path="/properties"><ProtectedRoute component={PropertiesPage} /></Route>
          <Route path="/services"><ProtectedRoute component={ServicesPage} /></Route>
          <Route path="/appointments"><ProtectedRoute component={AppointmentsPage} /></Route>
          <Route path="/invoices"><ProtectedRoute component={InvoicesPage} /></Route>
          <Route path="/recurring"><ProtectedRoute component={RecurringPage} /></Route>
          <Route path="/estimates"><ProtectedRoute component={EstimatesPage} /></Route>
          <Route path="/routes"><ProtectedRoute component={RoutesPage} /></Route>
          <Route path="/reviews"><ProtectedRoute component={ReviewsPage} /></Route>
          <Route path="/automations"><ProtectedRoute component={AutomationsPage} /></Route>
          <Route path="/follow-ups"><ProtectedRoute component={FollowUpsPage} /></Route>
          <Route path="/team"><ProtectedRoute component={TeamPage} /></Route>
          <Route path="/reporting"><ProtectedRoute component={ReportingPage} /></Route>
          <Route path="/settings"><ProtectedRoute component={SettingsPage} /></Route>
          <Route path="/billing"><ProtectedRoute component={BillingPage} /></Route>

          {/* Admin routes — lazy loaded */}
          <Route path="/admin/dashboard"><ProtectedRoute component={AdminDashboardPage} adminOnly /></Route>
          <Route path="/admin/companies/:id"><ProtectedRoute component={AdminCompanyDetailPage} adminOnly /></Route>
          <Route path="/admin/companies"><ProtectedRoute component={AdminCompaniesPage} adminOnly /></Route>
          <Route path="/admin/billing"><ProtectedRoute component={AdminBillingPage} adminOnly /></Route>
          <Route path="/admin/activity"><ProtectedRoute component={AdminActivityPage} adminOnly /></Route>
          <Route path="/admin/beta-readiness"><ProtectedRoute component={AdminBetaReadinessPage} adminOnly /></Route>
          <Route path="/admin/admins"><ProtectedRoute component={AdminAdminsPage} adminOnly /></Route>
          <Route path="/admin/settings"><ProtectedRoute component={AdminSettingsPage} adminOnly /></Route>

          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
