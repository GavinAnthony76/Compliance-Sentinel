/**
 * GreenSynk SSR meta-injection server.
 *
 * Serves the Vite-built SPA with route-specific HTML body and head tags
 * injected before the response reaches the browser. This gives crawlers and
 * social-preview bots server-visible content and metadata even for React routes.
 *
 * Response strategy per route:
 *   Prerendered static routes  — serve dist/prerendered/<file>.html directly
 *   /book/:slug                — runtime SSR using dist/server/entry-server.js
 *                                with booking data pre-fetched from the API,
 *                                with full metadata + canonical injected
 *   /estimates/:token/sign     — SPA shell with injected meta tags
 *   All other routes           — SPA shell (dist/public/index.html)
 *
 * Crawl governance:
 *   Indexable routes (allowlist) receive "index, follow" + a canonical tag.
 *   Everything else receives "noindex, nofollow" and no canonical tag.
 *   Invalid /book/:slug returns HTTP 404; expired/rejected /estimates/:token/sign returns HTTP 410.
 *
 * Falls back gracefully when the SSR bundle or prerendered files are absent
 * (i.e. before a production build has been run).
 */

import { createServer } from 'node:http';
import { createReadStream, readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT           = Number(process.env.PORT ?? 3000);
const API_URL        = process.env.API_INTERNAL_URL ?? `http://localhost:${process.env.API_PORT ?? 8080}`;
const DIST_DIR       = join(__dirname, 'dist', 'public');
const DIST_PRERENDERED = join(__dirname, 'dist', 'prerendered');
const DIST_SERVER    = join(__dirname, 'dist', 'server');
const CANONICAL_BASE = 'https://greensynk.com';

// ---------------------------------------------------------------------------
// Load the client-build template (required at startup)
// ---------------------------------------------------------------------------
let template;
try {
  template = readFileSync(join(DIST_DIR, 'index.html'), 'utf-8');
} catch {
  console.error('Could not read dist/public/index.html — run "pnpm build" first.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Load prerendered HTML for static routes (optional — built by prerender.mjs)
// ---------------------------------------------------------------------------
const STATIC_PRERENDER_MAP = {
  '/':        'index.html',
  '/about':   'about.html',
  '/contact': 'contact.html',
  '/privacy': 'privacy.html',
  '/terms':   'terms.html',
  '/cookies': 'cookies.html',
};

const prerenderedPages = {};
for (const [route, file] of Object.entries(STATIC_PRERENDER_MAP)) {
  const filePath = join(DIST_PRERENDERED, file);
  if (existsSync(filePath)) {
    prerenderedPages[route] = readFileSync(filePath, 'utf-8');
  }
}
const prerenderedCount = Object.keys(prerenderedPages).length;
if (prerenderedCount > 0) {
  console.log(`Loaded ${prerenderedCount} prerendered pages.`);
} else {
  console.warn('No prerendered pages found — run "pnpm build" to generate them.');
}

// ---------------------------------------------------------------------------
// Load the SSR bundle for runtime rendering of /book/:slug (optional)
// ---------------------------------------------------------------------------
let renderSSR = null;
const ssrBundlePath = join(DIST_SERVER, 'entry-server.js');
if (existsSync(ssrBundlePath)) {
  try {
    const ssrModule = await import(ssrBundlePath);
    renderSSR = ssrModule.render;
    console.log('SSR bundle loaded for runtime rendering.');
  } catch (err) {
    console.warn('Failed to load SSR bundle:', err.message);
  }
} else {
  console.warn('SSR bundle not found — run "pnpm build" to enable runtime SSR.');
}

// ---------------------------------------------------------------------------
// MIME types
// ---------------------------------------------------------------------------
const MIME = {
  '.html':  'text/html; charset=utf-8',
  '.js':    'text/javascript',
  '.mjs':   'text/javascript',
  '.css':   'text/css',
  '.json':  'application/json',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.jpeg':  'image/jpeg',
  '.webp':  'image/webp',
  '.svg':   'image/svg+xml',
  '.ico':   'image/x-icon',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':   'font/ttf',
  '.txt':   'text/plain',
  '.xml':   'application/xml',
  '.mp4':   'video/mp4',
};

// ---------------------------------------------------------------------------
// HTML escaping + meta injection helpers
// ---------------------------------------------------------------------------
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const SITE = 'GreenSynk';

// ---------------------------------------------------------------------------
// JSON-LD helpers
// ---------------------------------------------------------------------------

/**
 * Replace the single <script type="application/ld+json"> block in an HTML
 * string with the provided JSON-LD object (serialised to JSON).
 */
function injectJsonLd(html, ldObject) {
  const jsonStr = JSON.stringify(ldObject, null, 2);
  return html.replace(
    /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
    `<script type="application/ld+json">\n    ${jsonStr}\n    </script>`,
  );
}

/**
 * Minimal site-level JSON-LD for informational pages (about, contact, etc.).
 * Only Organisation + WebSite — no SoftwareApplication product schema.
 */
const SITE_JSONLD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${CANONICAL_BASE}/#organization`,
      name: SITE,
      url: CANONICAL_BASE,
      logo: { '@type': 'ImageObject', url: `${CANONICAL_BASE}/favicon.svg` },
      contactPoint: { '@type': 'ContactPoint', email: 'hello@greensynk.com', contactType: 'customer support' },
      sameAs: [],
    },
    {
      '@type': 'WebSite',
      '@id': `${CANONICAL_BASE}/#website`,
      url: CANONICAL_BASE,
      name: SITE,
      publisher: { '@id': `${CANONICAL_BASE}/#organization` },
    },
  ],
};

/**
 * Build a LocalBusiness JSON-LD object from booking API data.
 * Returns null when bookingData is falsy.
 */
function buildBookingJsonLd(bookingData, slug) {
  if (!bookingData) return null;
  const services = bookingData.services ?? [];
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': `${CANONICAL_BASE}/book/${slug}`,
    name: bookingData.companyName,
    ...(bookingData.phone    && { telephone: bookingData.phone }),
    ...(bookingData.email    && { email: bookingData.email }),
    ...(bookingData.website  && { url: bookingData.website }),
    ...(bookingData.address || bookingData.city || bookingData.state || bookingData.zip
      ? {
          address: {
            '@type': 'PostalAddress',
            ...(bookingData.address && { streetAddress: bookingData.address }),
            ...(bookingData.city    && { addressLocality: bookingData.city }),
            ...(bookingData.state   && { addressRegion: bookingData.state }),
            ...(bookingData.zip     && { postalCode: bookingData.zip }),
            addressCountry: 'US',
          },
        }
      : {}),
    ...(services.length > 0
      ? {
          hasOfferCatalog: {
            '@type': 'OfferCatalog',
            name: 'Lawn Care Services',
            itemListElement: services.map((s) => ({
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: s.name,
                ...(s.description && { description: s.description }),
              },
              ...(s.basePrice != null && {
                price: String(s.basePrice),
                priceCurrency: 'USD',
              }),
            })),
          },
        }
      : {}),
  };
}

/**
 * Explicit allowlist of public routes that should be indexed and receive
 * a canonical tag. Everything not on this list (auth, portal, admin,
 * dashboard, estimate-sign, etc.) gets "noindex, nofollow".
 *
 * /book/:slug is handled dynamically — it's indexable only when the slug
 * resolves to a real, active company.
 */
const STATIC_INDEXABLE_ROUTES = new Set(['/', '/about', '/contact', '/privacy', '/terms', '/cookies']);

function isStaticIndexable(pathname) {
  return STATIC_INDEXABLE_ROUTES.has(pathname);
}

/**
 * Inject route-specific metadata into an HTML template string.
 *
 * @param {string}  html
 * @param {object}  opts
 * @param {string}  [opts.title]        Page title (SITE suffix auto-appended if missing)
 * @param {string}  [opts.description]
 * @param {string}  [opts.canonicalUrl]
 * @param {string}  [opts.bodyHtml]     React-rendered inner HTML for <div id="root">
 */
function injectMeta(html, { title, description, canonicalUrl, bodyHtml } = {}) {
  const fullTitle = title
    ? (title.includes(SITE) ? title : `${title} — ${SITE}`)
    : null;

  if (fullTitle) {
    html = html.replace(/<title>[^<]*<\/title>/,                                `<title>${esc(fullTitle)}</title>`);
    html = html.replace(/(<meta property="og:title" content=")[^"]*(")/,        `$1${esc(fullTitle)}$2`);
    html = html.replace(/(<meta name="twitter:title" content=")[^"]*(")/,       `$1${esc(fullTitle)}$2`);
  }
  if (description) {
    html = html.replace(/(<meta name="description" content=")[^"]*(")/,         `$1${esc(description)}$2`);
    html = html.replace(/(<meta property="og:description" content=")[^"]*(")/,  `$1${esc(description)}$2`);
    html = html.replace(/(<meta name="twitter:description" content=")[^"]*(")/,`$1${esc(description)}$2`);
  }
  if (canonicalUrl) {
    html = html.replace(/(<meta property="og:url" content=")[^"]*(")/,          `$1${esc(canonicalUrl)}$2`);
  }
  if (bodyHtml) {
    html = html.replace(
      /<div id="root"><\/div>/,
      `<div id="root">${bodyHtml}</div>`,
    );
  }

  return html;
}

/**
 * Inject server-side robots directive and canonical link.
 *
 * The template ships with `<meta name="robots" content="noindex, nofollow">` as
 * its safe baseline. For explicitly indexable routes we replace that with
 * "index, follow" and prepend a canonical <link> before </head>.
 */
function injectRobotsAndCanonical(html, { indexable, canonicalPath }) {
  if (indexable) {
    html = html.replace(
      /(<meta name="robots" content=")[^"]*(")/,
      '$1index, follow$2'
    );
    const canonicalTag = `<link rel="canonical" href="${CANONICAL_BASE}${esc(canonicalPath)}" />`;
    html = html.replace('</head>', `  ${canonicalTag}\n  </head>`);
  }
  return html;
}

// ---------------------------------------------------------------------------
// Per-route static metadata for pages that exist as an SPA
// (used when prerendered files are not available, and for /book/:slug runtime)
// ---------------------------------------------------------------------------
const STATIC_META = {
  '/about': {
    title: `About ${SITE} — Outdoor Service Business Software`,
    description: `Learn about ${SITE}, the all-in-one business management platform built for outdoor service professionals. Our mission is to help you schedule smarter, invoice faster, and grow your business.`,
  },
  '/contact': {
    title: `Contact ${SITE} — Get in Touch`,
    description: `Get in touch with the ${SITE} team for support, sales inquiries, or general questions. We typically respond within one business day.`,
  },
  '/privacy': {
    title: `Privacy Policy — ${SITE}`,
    description: `${SITE}'s Privacy Policy explains how we collect, use, and protect your information when you use our outdoor service business management platform.`,
  },
  '/terms': {
    title: `Terms of Service — ${SITE}`,
    description: `Read the ${SITE} Terms of Service governing your use of our outdoor service business management platform.`,
  },
  '/cookies': {
    title: `Cookie Policy — ${SITE}`,
    description: `${SITE}'s Cookie Policy explains how we use cookies and similar tracking technologies on our website and platform.`,
  },
};

// ---------------------------------------------------------------------------
// API data fetchers for dynamic routes
// ---------------------------------------------------------------------------

/**
 * Fetch booking metadata.
 * Returns:
 *   { httpStatus: 404 }                       — slug not found / company inactive
 *   { httpStatus: 200, bookingData: null }     — fetch error / unexpected response
 *   { httpStatus: 200, bookingData: {...} }    — valid company with raw API data
 */
async function fetchBookingMeta(slug) {
  try {
    const r = await fetch(`${API_URL}/api/public/book/${encodeURIComponent(slug)}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (r.status === 404) return { httpStatus: 404 };
    if (!r.ok) return { httpStatus: 200, bookingData: null };
    const d = await r.json();
    if (!d.companyName) return { httpStatus: 404 };
    return { httpStatus: 200, bookingData: d };
  } catch {
    return { httpStatus: 200, bookingData: null };
  }
}

/**
 * Fetch estimate metadata.
 * Returns:
 *   { httpStatus: 404 }              — token not found
 *   { httpStatus: 410 }              — estimate expired (validUntil in past) or rejected
 *   { httpStatus: 200, meta: {...} } — valid estimate
 */
async function fetchEstimateMeta(token) {
  try {
    const r = await fetch(`${API_URL}/api/public/estimates/${encodeURIComponent(token)}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (r.status === 404) return { httpStatus: 404 };
    if (!r.ok) return { httpStatus: 200, meta: null };
    const d = await r.json();

    const isRejected = d.status === 'rejected';
    const isExpired = d.validUntil && new Date(d.validUntil) < new Date();
    if (isRejected || isExpired) return { httpStatus: 410 };

    const company = d.company?.name;
    const num = d.estimateNumber;
    if (!company && !num) return { httpStatus: 200, meta: null };
    return {
      httpStatus: 200,
      meta: {
        title: `${num ? `Estimate ${num}` : 'Estimate'}${company ? ` from ${company}` : ''}`,
        description: company
          ? `Review and sign your service estimate from ${company}.`
          : 'Review and sign your service estimate.',
      },
    };
  } catch {
    return { httpStatus: 200, meta: null };
  }
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------
const server = createServer(async (req, res) => {
  try {
    const url      = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;

    // -----------------------------------------------------------------------
    // Dynamic sitemap — generated from active company slugs
    // -----------------------------------------------------------------------
    if (pathname === '/sitemap.xml') {
      try {
        const r = await fetch(`${API_URL}/api/public/sitemap-slugs`, {
          signal: AbortSignal.timeout(5000),
        });
        const slugEntries = r.ok ? await r.json() : [];

        const staticEntries = [
          { loc: `${CANONICAL_BASE}/`,        changefreq: 'weekly',  priority: '1.0' },
          { loc: `${CANONICAL_BASE}/about`,   changefreq: 'monthly', priority: '0.7' },
          { loc: `${CANONICAL_BASE}/contact`, changefreq: 'monthly', priority: '0.6' },
          { loc: `${CANONICAL_BASE}/privacy`, changefreq: 'yearly',  priority: '0.3' },
          { loc: `${CANONICAL_BASE}/terms`,   changefreq: 'yearly',  priority: '0.3' },
          { loc: `${CANONICAL_BASE}/cookies`, changefreq: 'yearly',  priority: '0.3' },
        ];

        const bookingEntries = slugEntries.map(({ slug, updatedAt }) => {
          const lastmod = updatedAt ? `\n    <lastmod>${updatedAt.slice(0, 10)}</lastmod>` : '';
          return `  <url>\n    <loc>${CANONICAL_BASE}/book/${encodeURIComponent(slug)}</loc>${lastmod}\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>`;
        });

        const staticXml = staticEntries.map(({ loc, changefreq, priority }) =>
          `  <url>\n    <loc>${loc}</loc>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`
        ).join('\n');

        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${staticXml}${bookingEntries.length ? '\n' + bookingEntries.join('\n') : ''}\n</urlset>`;

        res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
        res.end(xml);
      } catch (err) {
        console.error('Sitemap generation error:', err.message);
        res.writeHead(503);
        res.end('Service Unavailable');
      }
      return;
    }

    // Serve static assets directly (JS / CSS / images / etc.)
    if (pathname !== '/') {
      const filePath = join(DIST_DIR, pathname);
      if (existsSync(filePath) && statSync(filePath).isFile()) {
        const mime = MIME[extname(filePath)] ?? 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime });
        createReadStream(filePath).pipe(res);
        return;
      }
    }

    const bookMatch     = pathname.match(/^\/book\/([^/?#]+)/);
    const estimateMatch = pathname.match(/^\/estimates\/([^/?#]+)\/sign/);

    // -----------------------------------------------------------------------
    // Static prerendered pages — served directly (all metadata already baked in)
    // -----------------------------------------------------------------------
    if (prerenderedPages[pathname]) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(prerenderedPages[pathname]);
      return;
    }

    // -----------------------------------------------------------------------
    // SPA fallback for static routes when prerendered files don't exist
    // (development mode or before a production build)
    // -----------------------------------------------------------------------
    if (STATIC_META[pathname]) {
      const meta = STATIC_META[pathname];
      let html = injectMeta(template, {
        ...meta,
        canonicalUrl: `${CANONICAL_BASE}${pathname}`,
      });
      html = injectJsonLd(html, SITE_JSONLD);
      html = injectRobotsAndCanonical(html, { indexable: true, canonicalPath: pathname });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }

    // -----------------------------------------------------------------------
    // /book/:slug — runtime SSR with pre-fetched booking data
    // -----------------------------------------------------------------------
    if (bookMatch) {
      const slug   = bookMatch[1];
      const result = await fetchBookingMeta(slug);

      if (result.httpStatus === 404) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(template);
        return;
      }

      const bookingData = result.bookingData;

      // Fail closed: only index the page when a validated company payload is present.
      // API errors, timeouts, and unexpected upstream responses all land here with
      // bookingData === null — serve a 503 shell so crawlers don't index thin pages.
      if (!bookingData) {
        let html503 = template;
        html503 = html503.replace(/(<meta name="robots" content=")[^"]*(")/,  '$1noindex, nofollow$2');
        res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '60' });
        res.end(html503);
        return;
      }

      let bodyHtml = '';
      if (renderSSR) {
        try {
          bodyHtml = renderSSR(`/book/${slug}`, { bookingData });
        } catch (err) {
          console.warn(`SSR render failed for /book/${slug}:`, err.message);
        }
      }

      const title = `Book with ${bookingData.companyName}`;
      const description = `Request outdoor services from ${bookingData.companyName}. Choose a service, describe your property, and submit your booking request online.`;

      const canonicalUrl = `${CANONICAL_BASE}/book/${slug}`;
      let html = injectMeta(template, { title, description, canonicalUrl, bodyHtml });
      const bookingLd = buildBookingJsonLd(bookingData, slug);
      if (bookingLd) {
        html = injectJsonLd(html, bookingLd);
      }
      html = injectRobotsAndCanonical(html, { indexable: true, canonicalPath: `/book/${slug}` });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }

    // -----------------------------------------------------------------------
    // /estimates/:token/sign — metadata only (noindex, no canonical needed)
    // -----------------------------------------------------------------------
    if (estimateMatch) {
      const result = await fetchEstimateMeta(estimateMatch[1]);

      if (result.httpStatus === 404) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(template);
        return;
      }
      if (result.httpStatus === 410) {
        res.writeHead(410, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(template);
        return;
      }

      const html = result.meta ? injectMeta(template, result.meta) : template;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }

    // -----------------------------------------------------------------------
    // All other routes — SPA shell
    // -----------------------------------------------------------------------
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(template);
  } catch (err) {
    console.error('Request error:', err);
    res.writeHead(500);
    res.end('Internal Server Error');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`GreenSynk SSR server listening on port ${PORT}`);
});
