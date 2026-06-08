import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'wouter';
import { useGetMe, useAdminGetMe, getGetMeQueryKey, getAdminGetMeQueryKey } from '@workspace/api-client-react';

export const TOKEN_KEY = 'greensync_token';
export const ADMIN_TOKEN_KEY = 'greensync_admin_token';

export function useAuthState() {
  const [, setLocation] = useLocation();
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [adminToken, setAdminToken] = useState<string | null>(() => localStorage.getItem(ADMIN_TOKEN_KEY));

  const {
    data: user,
    isLoading: isLoadingUser,
    error: userError,
    refetch: refetchUser,
  } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      enabled: !!token,
      retry: false,
    },
  });

  const {
    data: adminUser,
    isLoading: isLoadingAdmin,
    error: adminError,
    refetch: refetchAdmin,
  } = useAdminGetMe({
    query: {
      queryKey: getAdminGetMeQueryKey(),
      enabled: !!adminToken,
      retry: false,
    },
  });

  // Auto-clear stale / invalid tokens on 401 so the spinner never gets stuck
  useEffect(() => {
    if (userError && (userError as any)?.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      setToken(null);
    }
  }, [userError]);

  useEffect(() => {
    if (adminError && (adminError as any)?.status === 401) {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
      setAdminToken(null);
    }
  }, [adminError]);

  const login = useCallback(
    (newToken: string) => {
      localStorage.setItem(TOKEN_KEY, newToken);
      setToken(newToken);
      refetchUser();
      setLocation('/dashboard');
    },
    [setLocation, refetchUser],
  );

  const adminLogin = useCallback(
    (newToken: string) => {
      localStorage.setItem(ADMIN_TOKEN_KEY, newToken);
      setAdminToken(newToken);
      refetchAdmin();
      setLocation('/admin/dashboard');
    },
    [setLocation, refetchAdmin],
  );

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setLocation('/login');
  }, [setLocation]);

  const adminLogout = useCallback(() => {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    setAdminToken(null);
    setLocation('/admin/login');
  }, [setLocation]);

  return {
    user,
    adminUser,
    // Only show "loading" when there is actually a token being validated.
    // Without this guard, a stale admin token on a user-only route (or vice
    // versa) would keep isLoading true and spin the ProtectedRoute forever.
    isLoading: (!!token && isLoadingUser) || (!!adminToken && isLoadingAdmin),
    isAuthenticated: !!user,
    isAdminAuthenticated: !!adminUser,
    login,
    adminLogin,
    logout,
    adminLogout,
  };
}
