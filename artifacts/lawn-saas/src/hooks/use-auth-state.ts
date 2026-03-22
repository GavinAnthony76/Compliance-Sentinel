import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'wouter';
import { useGetMe, useAdminGetMe } from '@workspace/api-client-react';

export const TOKEN_KEY = 'greensync_token';
export const ADMIN_TOKEN_KEY = 'greensync_admin_token';

export function useAuthState() {
  const [, setLocation] = useLocation();
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [adminToken, setAdminToken] = useState<string | null>(() => localStorage.getItem(ADMIN_TOKEN_KEY));

  // Regular user auth
  const { data: user, isLoading: isLoadingUser, refetch: refetchUser } = useGetMe({
    query: {
      enabled: !!token,
      retry: false,
    }
  });

  // Admin auth
  const { data: adminUser, isLoading: isLoadingAdmin, refetch: refetchAdmin } = useAdminGetMe({
    query: {
      enabled: !!adminToken,
      retry: false,
    }
  });

  const login = useCallback((newToken: string) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
    refetchUser();
    setLocation('/dashboard');
  }, [setLocation, refetchUser]);

  const adminLogin = useCallback((newToken: string) => {
    localStorage.setItem(ADMIN_TOKEN_KEY, newToken);
    setAdminToken(newToken);
    refetchAdmin();
    setLocation('/admin/dashboard');
  }, [setLocation, refetchAdmin]);

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
    isLoading: isLoadingUser || isLoadingAdmin,
    isAuthenticated: !!user,
    isAdminAuthenticated: !!adminUser,
    login,
    adminLogin,
    logout,
    adminLogout,
  };
}
