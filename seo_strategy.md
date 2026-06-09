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
- The current public web surface is React + Vite + Wouter with client-side rendering for all public page bodies.
- `ssr-server.mjs` now injects limited server-side metadata for `/book/:slug` and `/estimates/:token/sign`, but it does not server-render the page body.
- Most public routes still share the baseline HTML shell in the initial response, and several informational routes still inherit homepage metadata unless the server response is made route-aware.

## Dismissed categories
- (None yet)
