import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, QueryCache } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuthState, TOKEN_KEY, ADMIN_TOKEN_KEY } from "@/hooks/use-auth-state";
import { useEffect } from "react";

// Public pages
import { LandingPage } from "@/pages/landing";
import { LoginPage } from "@/pages/login";
import { RegisterPage } from "@/pages/register";
import { AdminLoginPage } from "@/pages/admin-login";
import { ForgotPasswordPage } from "@/pages/forgot-password";
import { ForgotUsernamePage } from "@/pages/forgot-username";
import { ResetPasswordPage } from "@/pages/reset-password";
import { AdminForgotPasswordPage } from "@/pages/admin-forgot-password";
import { AdminResetPasswordPage } from "@/pages/admin-reset-password";
import { PortalForgotPasswordPage } from "@/pages/portal-forgot-password";
import { PublicBookingPage } from "@/pages/public-booking";
import { PortalLoginPage } from "@/pages/portal-login";
import { PortalSetPasswordPage } from "@/pages/portal-set-password";
import { PortalDashboardPage } from "@/pages/portal-dashboard";
import { PortalInvoicesPage } from "@/pages/portal-invoices";
import { PortalAppointmentsPage } from "@/pages/portal-appointments";
import { PortalEstimatesPage } from "@/pages/portal-estimates";
import { EstimateSignPage } from "@/pages/estimate-sign";
import NotFound from "@/pages/not-found";

// Company dashboard pages
import { DashboardPage } from "@/pages/dashboard";
import { CustomersPage } from "@/pages/customers";
import { CustomerDetailPage } from "@/pages/customer-detail";
import { CalendarPage } from "@/pages/calendar";
import { PropertiesPage } from "@/pages/properties";
import { ServicesPage } from "@/pages/services";
import { AppointmentsPage } from "@/pages/appointments";
import { InvoicesPage } from "@/pages/invoices";
import { RecurringPage } from "@/pages/recurring";
import { EstimatesPage } from "@/pages/estimates";
import { RoutesPage } from "@/pages/routes";
import { LeadsPage } from "@/pages/leads";
import { TechPage } from "@/pages/tech";
import { ReviewsPage } from "@/pages/reviews";
import { AutomationsPage } from "@/pages/automations";
import { TeamPage } from "@/pages/team";
import { ReportingPage } from "@/pages/reporting";
import { SettingsPage } from "@/pages/settings";
import { BillingPage } from "@/pages/billing";

// Admin pages
import { AdminDashboardPage } from "@/pages/admin-dashboard";
import { AdminCompaniesPage, AdminCompanyDetailPage } from "@/pages/admin-companies";
import { AdminActivityPage } from "@/pages/admin-activity";
import { AdminAdminsPage } from "@/pages/admin-admins";
import { AdminBillingPage } from "@/pages/admin-billing";
import { AdminSettingsPage } from "@/pages/admin-settings";

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
        // Reset the auth/me query so useAdminGetMe re-fires → clears React state
        queryClient.resetQueries({ queryKey: ['/api/admin/auth/me'] });
      } else if (url.includes('/api/')) {
        localStorage.removeItem(TOKEN_KEY);
        // Reset the auth/me query so useGetMe re-fires → clears React state
        queryClient.resetQueries({ queryKey: ['/api/auth/me'] });
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
  const { isAuthenticated, isAdminAuthenticated, isLoading } = useAuthState();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading) {
      if (adminOnly && !isAdminAuthenticated) {
        setLocation('/admin/login');
      } else if (!adminOnly && !isAuthenticated) {
        setLocation('/login');
      }
    }
  }, [isAuthenticated, isAdminAuthenticated, isLoading, adminOnly, setLocation]);

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-background"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  }

  return (adminOnly ? isAdminAuthenticated : isAuthenticated) ? <Component /> : null;
}

function Router() {
  return (
    <Switch>
      {/* Public routes */}
      <Route path="/" component={LandingPage} />
      <Route path="/login" component={LoginPage} />
      <Route path="/register" component={RegisterPage} />
      <Route path="/admin/login" component={AdminLoginPage} />
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route path="/forgot-username" component={ForgotUsernamePage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      <Route path="/admin/forgot-password" component={AdminForgotPasswordPage} />
      <Route path="/admin/reset-password" component={AdminResetPasswordPage} />
      <Route path="/book/:slug" component={PublicBookingPage} />

      {/* Customer portal routes */}
      <Route path="/portal/set-password" component={PortalSetPasswordPage} />
      <Route path="/portal/:slug/forgot-password" component={PortalForgotPasswordPage} />
      <Route path="/portal/:slug/login" component={PortalLoginPage} />
      <Route path="/portal/:slug/invoices" component={PortalInvoicesPage} />
      <Route path="/portal/:slug/appointments" component={PortalAppointmentsPage} />
      <Route path="/portal/:slug/estimates" component={PortalEstimatesPage} />
      <Route path="/portal/:slug" component={PortalDashboardPage} />

      {/* Public e-signature */}
      <Route path="/estimates/:token/sign" component={EstimateSignPage} />

      {/* Company dashboard routes */}
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
      <Route path="/team"><ProtectedRoute component={TeamPage} /></Route>
      <Route path="/reporting"><ProtectedRoute component={ReportingPage} /></Route>
      <Route path="/settings"><ProtectedRoute component={SettingsPage} /></Route>
      <Route path="/billing"><ProtectedRoute component={BillingPage} /></Route>

      {/* Admin routes */}
      <Route path="/admin/dashboard"><ProtectedRoute component={AdminDashboardPage} adminOnly /></Route>
      <Route path="/admin/companies/:id"><ProtectedRoute component={AdminCompanyDetailPage} adminOnly /></Route>
      <Route path="/admin/companies"><ProtectedRoute component={AdminCompaniesPage} adminOnly /></Route>
      <Route path="/admin/billing"><ProtectedRoute component={AdminBillingPage} adminOnly /></Route>
      <Route path="/admin/activity"><ProtectedRoute component={AdminActivityPage} adminOnly /></Route>
      <Route path="/admin/admins"><ProtectedRoute component={AdminAdminsPage} adminOnly /></Route>
      <Route path="/admin/settings"><ProtectedRoute component={AdminSettingsPage} adminOnly /></Route>

      <Route component={NotFound} />
    </Switch>
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
