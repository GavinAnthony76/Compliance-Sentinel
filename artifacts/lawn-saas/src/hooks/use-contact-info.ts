import { useQuery } from '@tanstack/react-query';

export interface ContactInfo {
  generalEmail: string;
  supportEmail: string;
  salesEmail: string;
  privacyEmail: string;
  legalEmail: string;
}

/**
 * Loads the platform's public contact addresses from the API. These live in the
 * DB (platform_settings) so they are never hardcoded in page components.
 */
export function useContactInfo() {
  return useQuery<ContactInfo>({
    queryKey: ['platform', 'contact-info'],
    queryFn: async () => {
      const res = await fetch('/api/platform/contact-info');
      if (!res.ok) throw new Error('Failed to load contact info');
      return res.json();
    },
    staleTime: 1000 * 60 * 60,
  });
}
