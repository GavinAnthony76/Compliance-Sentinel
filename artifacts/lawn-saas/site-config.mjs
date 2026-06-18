/**
 * Shared site config for the Node-side SEO builders (prerender.mjs and
 * ssr-server.mjs). The platform contact email lives in the DB; these scripts
 * fetch it from the API and fall back to the default below when the API is not
 * reachable (e.g. during a production build where the server is not yet up).
 *
 * This default mirrors the DB column default in platform_settings so the two
 * never drift.
 */
export const DEFAULT_CONTACT_EMAIL = 'hello@greensynk.com';

/**
 * Fetch the platform's general contact email from the API, falling back to the
 * default on any failure so the build/SSR path is never broken by a DB or
 * network issue.
 */
export async function getOrgContactEmail(apiUrl) {
  try {
    const res = await fetch(`${apiUrl}/api/platform/contact-info`);
    if (!res.ok) return DEFAULT_CONTACT_EMAIL;
    const data = await res.json();
    return data.generalEmail || DEFAULT_CONTACT_EMAIL;
  } catch {
    return DEFAULT_CONTACT_EMAIL;
  }
}
