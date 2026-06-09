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
- The current public web surface is a React + Vite SPA with client-side routing.
- Public routes presently share one HTML shell, so route-specific metadata and content are not present in the initial server response.

## Dismissed categories
- (None yet)
