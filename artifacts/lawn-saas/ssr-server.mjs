/**
 * GreenSynk SSR meta-injection server.
 *
 * Serves the Vite-built SPA with route-specific <title>, Open-Graph/Twitter
 * meta tags, robots directives, and canonical links injected into index.html
 * before it reaches the browser. This gives crawlers and social-preview bots
 * server-visible metadata even though the app body is still React-rendered on
 * the client side.
 *
 * Public routes that get dynamic injection:
 *   /book/:slug            — company name + description from /api/public/book/:slug
 *   /estimates/:token/sign — estimate number + company from /api/public/estimates/:token
 *
 * Crawl governance:
 *   Indexable routes (allowlist) receive "index, follow" + a canonical tag.
 *   Everything else receives "noindex, nofollow" and no canonical tag.
 *   Invalid /book/:slug returns HTTP 404; expired/rejected /estimates/:token/sign returns HTTP 410.
 */

import { createServer } from 'node:http';
import { createReadStream, readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 3000);
const API_URL = process.env.API_INTERNAL_URL ?? `http://localhost:${process.env.API_PORT ?? 8080}`;
const DIST_DIR = join(__dirname, 'dist', 'public');
const CANONICAL_BASE = 'https://greensynk.com';

let template;
try {
  template = readFileSync(join(DIST_DIR, 'index.html'), 'utf-8');
} catch {
  console.error('Could not read dist/public/index.html — run "pnpm build" first.');
  process.exit(1);
}

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

function injectMeta(html, { title, description }) {
  const fullTitle = title
    ? (title.includes(SITE) ? title : `${title} — ${SITE}`)
    : null;

  if (fullTitle) {
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(fullTitle)}</title>`);
    html = html.replace(/(<meta property="og:title" content=")[^"]*(")/,    `$1${esc(fullTitle)}$2`);
    html = html.replace(/(<meta name="twitter:title" content=")[^"]*(")/,   `$1${esc(fullTitle)}$2`);
  }
  if (description) {
    html = html.replace(/(<meta name="description" content=")[^"]*(")/,          `$1${esc(description)}$2`);
    html = html.replace(/(<meta property="og:description" content=")[^"]*(")/,   `$1${esc(description)}$2`);
    html = html.replace(/(<meta name="twitter:description" content=")[^"]*(")/,  `$1${esc(description)}$2`);
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

/**
 * Fetch booking metadata.
 * Returns:
 *   { httpStatus: 404 }              — slug not found / company inactive
 *   { httpStatus: 200, meta: {...} } — valid company
 */
async function fetchBookingMeta(slug) {
  try {
    const r = await fetch(`${API_URL}/api/public/book/${encodeURIComponent(slug)}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (r.status === 404) return { httpStatus: 404 };
    if (!r.ok) return { httpStatus: 200, meta: null };
    const d = await r.json();
    if (!d.companyName) return { httpStatus: 404 };
    return {
      httpStatus: 200,
      meta: {
        title: `Book with ${d.companyName}`,
        description: `Request lawn care services from ${d.companyName}. Choose a service, describe your property, and submit your booking request online.`,
      },
    };
  } catch {
    return { httpStatus: 200, meta: null };
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

/**
 * Resolve page-specific meta and HTTP status for a given pathname.
 *
 * Returns:
 *   null                              — not a dynamic route; use template as-is
 *   { httpStatus, meta, indexable }   — dynamic route result
 */
async function resolvePageMeta(pathname) {
  const bookMatch     = pathname.match(/^\/book\/([^/?#]+)/);
  const estimateMatch = pathname.match(/^\/estimates\/([^/?#]+)\/sign/);

  if (bookMatch) {
    const result = await fetchBookingMeta(bookMatch[1]);
    return {
      httpStatus: result.httpStatus,
      meta: result.meta ?? null,
      indexable: result.httpStatus === 200 && result.meta != null,
      canonicalPath: pathname,
    };
  }

  if (estimateMatch) {
    const result = await fetchEstimateMeta(estimateMatch[1]);
    return {
      httpStatus: result.httpStatus,
      meta: result.meta ?? null,
      indexable: false,
      canonicalPath: null,
    };
  }

  return null;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;

    // Serve static assets directly (JS/CSS/images/etc.)
    if (pathname !== '/') {
      const filePath = join(DIST_DIR, pathname);
      if (existsSync(filePath) && statSync(filePath).isFile()) {
        const mime = MIME[extname(filePath)] ?? 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime });
        createReadStream(filePath).pipe(res);
        return;
      }
    }

    // Resolve dynamic route (booking / estimate) or null for static routes
    const dynamic = await resolvePageMeta(pathname);

    // Return proper error status for invalid/expired dynamic routes
    if (dynamic && dynamic.httpStatus === 404) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(template);
      return;
    }
    if (dynamic && dynamic.httpStatus === 410) {
      res.writeHead(410, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(template);
      return;
    }

    // Determine indexability for this pathname
    const indexable = dynamic
      ? dynamic.indexable
      : isStaticIndexable(pathname);

    const canonicalPath = dynamic?.canonicalPath ?? (indexable ? pathname : null);

    // Build HTML: start from template, inject title/OG meta, then robots/canonical
    let html = template;
    if (dynamic?.meta) {
      html = injectMeta(html, dynamic.meta);
    }
    html = injectRobotsAndCanonical(html, { indexable, canonicalPath });

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(html);
  } catch (err) {
    console.error('Request error:', err);
    res.writeHead(500);
    res.end('Internal Server Error');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`GreenSynk SSR server listening on port ${PORT}`);
});
