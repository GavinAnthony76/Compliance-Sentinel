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
    html = html.replace(/(<link rel="canonical" href=")[^"]*(")/,               `$1${esc(canonicalUrl)}$2`);
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
    title: `About ${SITE} — Lawn Care Business Software`,
    description: `Learn about ${SITE}, the all-in-one business management platform built for lawn care professionals. Our mission is to help you schedule smarter, invoice faster, and grow your business.`,
  },
  '/contact': {
    title: `Contact ${SITE} — Get in Touch`,
    description: `Get in touch with the ${SITE} team for support, sales inquiries, or general questions. We typically respond within one business day.`,
  },
  '/privacy': {
    title: `Privacy Policy — ${SITE}`,
    description: `${SITE}'s Privacy Policy explains how we collect, use, and protect your information when you use our lawn care business management platform.`,
  },
  '/terms': {
    title: `Terms of Service — ${SITE}`,
    description: `Read the ${SITE} Terms of Service governing your use of our lawn care business management platform.`,
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
          ? `Review and sign your lawn care estimate from ${company}.`
          : 'Review and sign your lawn care estimate.',
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

      let bodyHtml = '';
      if (renderSSR && bookingData) {
        try {
          bodyHtml = renderSSR(`/book/${slug}`, { bookingData });
        } catch (err) {
          console.warn(`SSR render failed for /book/${slug}:`, err.message);
        }
      }

      const title = bookingData?.companyName
        ? `Book with ${bookingData.companyName}`
        : 'Request a Service';
      const description = bookingData?.companyName
        ? `Request lawn care services from ${bookingData.companyName}. Choose a service, describe your property, and submit your booking request online.`
        : 'Request professional lawn care services. Choose a service and submit your booking online.';

      const canonicalUrl = `${CANONICAL_BASE}/book/${slug}`;
      let html = injectMeta(template, { title, description, canonicalUrl, bodyHtml });
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
