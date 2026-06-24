import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'wouter';
import { hexToHsl } from '@/lib/utils';

export const PORTAL_TOKEN_KEY = 'greensync_portal_token';

interface PortalCustomer {
  id: number;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
}

interface PortalCompany {
  id: number;
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string | null;
}

interface PortalSession {
  customer: PortalCustomer;
  company: PortalCompany;
}

export function usePortalAuth() {
  const [, setLocation] = useLocation();
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(PORTAL_TOKEN_KEY));
  const [session, setSession] = useState<PortalSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setIsLoading(false);
      return;
    }
    fetch('/api/portal/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) setSession(data);
        else {
          localStorage.removeItem(PORTAL_TOKEN_KEY);
          setToken(null);
        }
      })
      .catch(() => {
        localStorage.removeItem(PORTAL_TOKEN_KEY);
        setToken(null);
      })
      .finally(() => setIsLoading(false));
  }, [token]);

  // Inject the company's brand color as --primary so all Tailwind classes
  // (text-primary, bg-primary, etc.) pick it up on every portal page.
  useEffect(() => {
    const color = session?.company.primaryColor;
    if (!color) return;
    const hsl = hexToHsl(color);
    if (!hsl) return;
    const root = document.documentElement;
    const original = root.style.getPropertyValue('--primary');
    root.style.setProperty('--primary', hsl);
    return () => { root.style.setProperty('--primary', original); };
  }, [session?.company.primaryColor]);

  const login = useCallback((newToken: string, newSession: PortalSession) => {
    localStorage.setItem(PORTAL_TOKEN_KEY, newToken);
    setToken(newToken);
    setSession(newSession);
    setLocation(`/portal/${newSession.company.slug}`);
  }, [setLocation]);

  const logout = useCallback((slug?: string) => {
    localStorage.removeItem(PORTAL_TOKEN_KEY);
    setToken(null);
    setSession(null);
    setLocation(slug ? `/portal/${slug}/login` : '/');
  }, [setLocation]);

  function portalFetch(url: string, options: RequestInit = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(url, { ...options, headers: { ...headers, ...(options.headers as any) } });
  }

  return { session, token, isLoading, isAuthenticated: !!session, login, logout, portalFetch };
}
