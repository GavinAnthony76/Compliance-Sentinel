/**
 * GreenSynk SSR meta-injection server.
 *
 * Serves the Vite-built SPA with route-specific <title> and Open-Graph/Twitter
 * meta tags injected into index.html before it reaches the browser. This gives
 * crawlers and social-preview bots server-visible metadata even though the app
 * body is still React-rendered on the client side.
 *
 * Public routes that get dynamic injection:
 *   /book/:slug            — company name + description from /api/public/book/:slug
 *   /estimates/:token/sign — estimate number + company from /api/public/estimates/:token
 *
 * All other routes receive the static baseline tags already baked into index.html.
 */

import { createServer } from 'node:http';
import { createReadStream, readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 3000);
// Internal URL of the API service. In Replit's deployment both services share
// localhost, so this default works. Override with API_INTERNAL_URL if needed.
const API_URL = process.env.API_INTERNAL_URL ?? `http://localhost:${process.env.API_PORT ?? 8080}`;
const DIST_DIR = join(__dirname, 'dist', 'public');

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

async function fetchBookingMeta(slug) {
  try {
    const r = await fetch(`${API_URL}/api/public/book/${encodeURIComponent(slug)}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    if (!d.companyName) return null;
    return {
      title: `Book with ${d.companyName}`,
      description: `Request lawn care services from ${d.companyName}. Choose a service, describe your property, and submit your booking request online.`,
    };
  } catch {
    return null;
  }
}

async function fetchEstimateMeta(token) {
  try {
    const r = await fetch(`${API_URL}/api/public/estimates/${encodeURIComponent(token)}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const company = d.company?.name;
    const num = d.estimateNumber;
    if (!company && !num) return null;
    return {
      title: `${num ? `Estimate ${num}` : 'Estimate'}${company ? ` from ${company}` : ''}`,
      description: company
        ? `Review and sign your lawn care estimate from ${company}.`
        : 'Review and sign your lawn care estimate.',
    };
  } catch {
    return null;
  }
}

async function resolvePageMeta(pathname) {
  const bookMatch      = pathname.match(/^\/book\/([^/?#]+)/);
  const estimateMatch  = pathname.match(/^\/estimates\/([^/?#]+)\/sign/);
  if (bookMatch)     return fetchBookingMeta(bookMatch[1]);
  if (estimateMatch) return fetchEstimateMeta(estimateMatch[1]);
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

    // SPA route — serve index.html with injected meta tags
    const meta = await resolvePageMeta(pathname);
    const html = meta ? injectMeta(template, meta) : template;

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
