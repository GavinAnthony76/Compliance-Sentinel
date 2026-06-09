# SEO Strategy

## In scope
- Public marketing pages
- Public booking pages (`/book/:slug`)
- Public customer-accessible transactional entry pages that can be crawled (`/portal/:slug/login`, `/estimates/:token/sign`) when they expose public HTML

## Out of scope
- Authenticated company dashboard routes (`/dashboard`, `/customers`, `/appointments`, `/billing`, etc.)
- Authenticated customer portal routes after login (`/portal/:slug`, `/portal/:slug/invoices`, `/portal/:slug/appointments`, `/portal/:slug/estimates`)
- Platform admin routes (`/admin/**`) except the public admin auth entry pages if they expose crawlable HTML

## Target audience
- Lawn care business owners and operators evaluating lawn care business management software.

## Primary keywords
- lawn care management software
- lawn care business software
- lawn care scheduling software
- lawn care invoicing software
- lawn care CRM

## Architecture notes
- The public frontend is React + Vite + Wouter, served in production by `artifacts/lawn-saas/ssr-server.mjs`.
- `/`, `/about`, `/contact`, `/privacy`, `/terms`, and `/cookies` are build-time prerendered through `prerender.mjs` + `src/entry-server.tsx`.
- `/book/:slug` is runtime SSR and is intended to be indexable only when the slug resolves to a real active company.
- `/estimates/:token/sign` remains metadata-only plus noindex; it is a transactional entry page, not a ranking target.
- `/portal/:slug/login` and similar utility routes should remain noindex unless the SEO strategy changes.
- The shared HTML shell still seeds baseline robots, canonical, and JSON-LD markup, so server and prerender overrides must stay aligned with the route allowlist.

## Dismissed categories
- (None yet)
