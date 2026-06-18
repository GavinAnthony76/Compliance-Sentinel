/**
 * Prerender static public routes to HTML at build time.
 *
 * Run after both the client build (vite build) and the SSR build
 * (vite build --config vite.ssr.config.ts). Outputs one HTML file
 * per route under dist/prerendered/.
 *
 * Usage: node prerender.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONTACT_EMAIL, getOrgContactEmail } from './site-config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_PUBLIC  = join(__dirname, 'dist', 'public');
const DIST_SERVER  = join(__dirname, 'dist', 'server');
const DIST_PRERENDERED = join(__dirname, 'dist', 'prerendered');

const SITE        = 'GreenSynk';
const CANONICAL   = 'https://greensynk.com';
const OG_IMAGE    = 'https://greensynk.com/opengraph.jpg';
const API_URL     = process.env.API_INTERNAL_URL ?? `http://localhost:${process.env.API_PORT ?? 8080}`;

/**
 * Minimal site-level JSON-LD for informational pages.
 * Replaces the homepage product schema so crawlers see accurate entity data.
 * The contact email is sourced from the DB-backed API (with a safe fallback).
 */
function buildSiteJsonLd(contactEmail) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${CANONICAL}/#organization`,
        name: SITE,
        url: CANONICAL,
        logo: { '@type': 'ImageObject', url: `${CANONICAL}/favicon.svg` },
        contactPoint: { '@type': 'ContactPoint', email: contactEmail, contactType: 'customer support' },
        sameAs: [],
      },
      {
        '@type': 'WebSite',
        '@id': `${CANONICAL}/#website`,
        url: CANONICAL,
        name: SITE,
        publisher: { '@id': `${CANONICAL}/#organization` },
      },
    ],
  }, null, 2);
}

const STATIC_ROUTES = [
  {
    path: '/',
    file: 'index.html',
    title: `${SITE} | Outdoor Service Business Management Software`,
    description: `${SITE} helps landscaping, lawn care, irrigation, and outdoor service companies manage customers, crews, schedules, routes, estimates, invoices, payments, and growth from one platform.`,
    siteJsonLd: false, // keep the full homepage product schema from the template
  },
  {
    path: '/about',
    file: 'about.html',
    title: `About ${SITE} — Outdoor Service Business Software`,
    description: `Learn about ${SITE}, the all-in-one business management platform built for outdoor service professionals. Our mission is to help you schedule smarter, invoice faster, and grow your business.`,
    siteJsonLd: true,
  },
  {
    path: '/contact',
    file: 'contact.html',
    title: `Contact ${SITE} — Get in Touch`,
    description: `Get in touch with the ${SITE} team for support, sales inquiries, or general questions. We typically respond within one business day.`,
    siteJsonLd: true,
  },
  {
    path: '/privacy',
    file: 'privacy.html',
    title: `Privacy Policy — ${SITE}`,
    description: `${SITE}'s Privacy Policy explains how we collect, use, and protect your information when you use our outdoor service business management platform.`,
    siteJsonLd: true,
  },
  {
    path: '/terms',
    file: 'terms.html',
    title: `Terms of Service — ${SITE}`,
    description: `Read the ${SITE} Terms of Service governing your use of our outdoor service business management platform.`,
    siteJsonLd: true,
  },
  {
    path: '/cookies',
    file: 'cookies.html',
    title: `Cookie Policy — ${SITE}`,
    description: `${SITE}'s Cookie Policy explains how we use cookies and similar tracking technologies on our website and platform.`,
    siteJsonLd: true,
  },
];

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function injectFull(template, { title, description, canonicalUrl, bodyHtml, jsonLd }) {
  let html = template;

  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  html = html.replace(/(<meta name="robots" content=")[^"]*(")/,              '$1index, follow$2');
  html = html.replace(/(<meta name="description" content=")[^"]*(")/,         `$1${esc(description)}$2`);
  html = html.replace(/(<meta property="og:title" content=")[^"]*(")/,        `$1${esc(title)}$2`);
  html = html.replace(/(<meta property="og:description" content=")[^"]*(")/,  `$1${esc(description)}$2`);
  html = html.replace(/(<meta property="og:url" content=")[^"]*(")/,          `$1${esc(canonicalUrl)}$2`);
  html = html.replace(/(<meta name="twitter:title" content=")[^"]*(")/,       `$1${esc(title)}$2`);
  html = html.replace(/(<meta name="twitter:description" content=")[^"]*(")/,`$1${esc(description)}$2`);

  const canonicalTag = `<link rel="canonical" href="${esc(canonicalUrl)}" />`;
  html = html.replace('</head>', `  ${canonicalTag}\n  </head>`);

  if (jsonLd) {
    html = html.replace(
      /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
      `<script type="application/ld+json">\n    ${jsonLd}\n    </script>`,
    );
  }

  if (bodyHtml) {
    html = html.replace(
      /<div id="root"><\/div>/,
      `<div id="root">${bodyHtml}</div>`,
    );
  }

  return html;
}

async function main() {
  if (!existsSync(join(DIST_PUBLIC, 'index.html'))) {
    console.error('dist/public/index.html not found — run "pnpm build:client" first.');
    process.exit(1);
  }

  if (!existsSync(join(DIST_SERVER, 'entry-server.js'))) {
    console.error('dist/server/entry-server.js not found — run "pnpm build:ssr" first.');
    process.exit(1);
  }

  const rawTemplate = readFileSync(join(DIST_PUBLIC, 'index.html'), 'utf-8');

  // Resolve the platform contact email from the DB-backed API (falls back to
  // the shared default when the API is not reachable during the build).
  const contactEmail = await getOrgContactEmail(API_URL);
  const siteJsonLd = buildSiteJsonLd(contactEmail);

  // Patch the homepage's hardcoded contact email in the template so the kept
  // product-schema JSON-LD also reflects the DB-sourced address.
  const template = rawTemplate.replace(
    new RegExp(`("email":\\s*")${DEFAULT_CONTACT_EMAIL}(")`),
    `$1${contactEmail}$2`,
  );

  const { render } = await import('./dist/server/entry-server.js');

  mkdirSync(DIST_PRERENDERED, { recursive: true });

  for (const route of STATIC_ROUTES) {
    process.stdout.write(`Prerendering ${route.path} ...`);

    let bodyHtml = '';
    try {
      bodyHtml = render(route.path);
    } catch (err) {
      console.warn(` SSR render failed (${err.message}), using empty body`);
    }

    const html = injectFull(template, {
      title: route.title,
      description: route.description,
      canonicalUrl: `${CANONICAL}${route.path === '/' ? '/' : route.path}`,
      bodyHtml,
      jsonLd: route.siteJsonLd ? siteJsonLd : null,
    });

    writeFileSync(join(DIST_PRERENDERED, route.file), html, 'utf-8');
    console.log(' done');
  }

  console.log(`\nPrerendered ${STATIC_ROUTES.length} routes to dist/prerendered/`);
}

main().catch((err) => {
  console.error('Prerender failed:', err);
  process.exit(1);
});
