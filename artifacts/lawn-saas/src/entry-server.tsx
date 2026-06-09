import React, { useSyncExternalStore } from 'react';
import { renderToString } from 'react-dom/server';
import { Switch, Route, Router as WouterRouter } from 'wouter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';

import { LandingPage } from './pages/landing';
import { AboutPage } from './pages/about';
import { ContactPage } from './pages/contact';
import { PrivacyPage } from './pages/privacy';
import { TermsPage } from './pages/terms';
import { CookiesPage } from './pages/cookies';
import { PublicBookingPage } from './pages/public-booking';

export interface RenderOptions {
  bookingData?: Record<string, unknown>;
}

/**
 * Create a wouter-compatible location hook that is safe for React 19 SSR.
 *
 * Wouter 3.x memoryLocation passes only 2 arguments to useSyncExternalStore
 * (omitting getServerSnapshot), which React 19 now requires. This custom hook
 * passes the path as both getSnapshot and getServerSnapshot so server rendering
 * works without errors.
 */
function createSSRLocationHook(path: string) {
  const noop = () => () => {};
  const getPath = () => path;
  const getSearch = () => '';

  const useSSRLocation = (): [string, (to: string) => void] => [
    useSyncExternalStore(noop, getPath, getPath),
    () => {},
  ];

  useSSRLocation.searchHook = () =>
    useSyncExternalStore(noop, getSearch, getSearch);

  return useSSRLocation as Parameters<typeof WouterRouter>[0]['hook'];
}

export function render(url: string, options: RenderOptions = {}): string {
  const hook = createSSRLocationHook(url);

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        gcTime: Infinity,
      },
    },
  });

  if (options.bookingData) {
    const slugMatch = url.match(/^\/book\/([^/?#]+)/);
    if (slugMatch) {
      queryClient.setQueryData([`/api/public/book/${slugMatch[1]}`], options.bookingData);
    }
  }

  return renderToString(
    <WouterRouter hook={hook}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Switch>
            <Route path="/" component={LandingPage} />
            <Route path="/about" component={AboutPage} />
            <Route path="/contact" component={ContactPage} />
            <Route path="/privacy" component={PrivacyPage} />
            <Route path="/terms" component={TermsPage} />
            <Route path="/cookies" component={CookiesPage} />
            <Route path="/book/:slug" component={PublicBookingPage} />
          </Switch>
        </TooltipProvider>
      </QueryClientProvider>
    </WouterRouter>
  );
}
