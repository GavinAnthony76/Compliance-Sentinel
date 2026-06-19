# GreenSynk — Comprehensive Application Document

> A complete reference covering what GreenSynk is, every feature and function, the full technology stack, the data model, and how the system fits together.

---

## 1. What Is GreenSynk?

**GreenSynk** is a production-ready, **multi-tenant SaaS platform for lawn care and landscaping businesses**. It gives an owner-operator or a multi-person crew a single place to run their entire operation: managing customers, scheduling jobs, planning daily routes, sending estimates, invoicing, collecting payments, automating customer communication, and analyzing performance.

It is sold as a subscription product across **three pricing tiers** (Starter, Growth, Pro), and it includes a **platform admin console** for the SaaS operator (the business that runs GreenSynk itself) to manage all the lawn care companies on the platform.

### Three distinct audiences use the system

| Audience | Who they are | What they get |
|----------|-------------|---------------|
| **Lawn care business** (tenant) | Owners, admins, and field staff at a landscaping company | The full operational dashboard — customers, scheduling, routes, invoicing, automations, billing |
| **End customers** (homeowners) | The clients of a lawn care business | A self-service portal + public booking page to request service, view appointments, sign estimates, and pay invoices |
| **Platform admin** | The operator of GreenSynk itself | A super-admin console to manage every tenant company, monitor revenue, suspend accounts, and audit activity |

### Multi-tenancy

Every piece of data is scoped to a **company** (the tenant). A user belongs to exactly one company, and all queries are filtered by `companyId` so that no tenant can ever see another tenant's data. Customer-facing surfaces (booking pages, portals) are addressed by a per-company **slug** (e.g. `/book/greenscapes-demo`).

---

## 2. Technology & Build Stack

GreenSynk is a **TypeScript monorepo** managed with **pnpm workspaces**. Each package owns its own dependencies, and shared code (database, API spec, generated client) lives in reusable libraries.

### Core stack

| Layer | Technology |
|-------|-----------|
| **Monorepo** | pnpm workspaces |
| **Language** | TypeScript 5.9 on Node.js v24 |
| **API server** | Express 5 |
| **Frontend** | React 18 + Vite |
| **Routing (frontend)** | Wouter |
| **Data fetching / cache** | TanStack React Query |
| **Styling** | Tailwind CSS + shadcn/ui (Radix UI primitives) |
| **Database** | PostgreSQL (Neon, via `NEON_DATABASE_URL`) |
| **ORM** | Drizzle ORM |
| **Auth** | bcryptjs (password hashing) + JWT (jsonwebtoken) |
| **Billing** | Stripe (via Replit Stripe integration) |
| **Email** | Resend (`resend` package) via `noreply@greensynk.com` |
| **SMS** | Twilio |
| **API typing** | OpenAPI spec → code generation → typed React Query hooks + Zod schemas |
| **Logging** | pino / pino-http (structured logs) |
| **Security middleware** | helmet, cors, cookie-parser |
| **Build (server)** | esbuild (pdfkit externalized — see memory) |

### Monorepo layout

```
workspace/
├── artifacts/
│   ├── api-server/      → Express backend (all /api routes)
│   ├── lawn-saas/       → React + Vite frontend (the web app)
│   └── mockup-sandbox/  → Component preview/prototyping server
├── lib/
│   ├── db/              → Drizzle schema + DB client (shared)
│   ├── api-spec/        → OpenAPI spec + codegen config
│   └── api-client-react/→ Generated typed hooks + Zod schemas
└── replit.md            → Project overview / developer notes
```

### How the layers connect

1. **The database schema** is defined once in `lib/db` with Drizzle.
2. **The API contract** is defined as an OpenAPI spec in `lib/api-spec`.
3. **Codegen** turns that spec into fully typed React Query hooks and Zod validation schemas in `lib/api-client-react`.
4. **The frontend** imports those generated hooks, so every API call is type-safe end to end. The auth token is automatically attached to every request.
5. **The Express server** implements the endpoints, enforces auth + plan gating, and talks to PostgreSQL through Drizzle.

### Key developer commands

```bash
pnpm --filter @workspace/api-server run dev     # Run the API server
pnpm --filter @workspace/lawn-saas  run dev     # Run the frontend
pnpm --filter @workspace/db         run push    # Apply DB schema changes
pnpm --filter @workspace/api-spec   run codegen # Regenerate the typed API client
pnpm run typecheck                              # Full TypeScript check

# DB access (always use NEON_DATABASE_URL, never DATABASE_URL)
psql "$NEON_DATABASE_URL"
```

---

## 3. Authentication & Authorization

GreenSynk runs **four separate authentication contexts**, each with its own credentials, tokens, and middleware.

| Context | Who | Token (localStorage) | Middleware |
|---------|-----|----------------------|------------|
| **Company users** | Owners / admins / staff | `greensync_token` | `requireAuth` |
| **Platform admins** | SaaS operators | `greensync_admin_token` | `requireAuth` (admin routes) |
| **Customer portal** | End customers (homeowners) | portal session token | `requirePortalAuth` |
| **Public links** | Anyone with a secure token | short-lived signed token | per-route token check |

### Company user authentication

- **Registration** — `POST /api/auth/register` creates a company **and** its first owner user in one step (a 3-step onboarding form on the frontend). A **welcome email** is sent immediately after registration (non-blocking try/catch; uses Resend).
- **Login** — `POST /api/auth/login` returns a signed JWT.
- **Current user** — `GET /api/auth/me` returns the logged-in user plus their company (including `subscriptionStatus` and `trialEndsAt`).
- **Roles** — `owner`, `admin`, `staff` (controls what staff can access).
- **Password hashing** — bcryptjs.

### Account recovery

- **Forgot password** — `POST /api/auth/forgot-password` sends a reset link by email. Anti-enumeration: always returns success regardless of whether the email exists.
- **Reset password** — `POST /api/auth/reset-password` enforces a strong-password policy server-side (≥8 chars, uppercase, lowercase, digit, special character). After a successful reset it sends a **security confirmation email** with a timestamp and warning. The event is logged to the activity audit trail.
- **Forgot username** — `POST /api/auth/forgot-username` emails the user their account details (full name, login email, role, and direct sign-in / reset links). Also anti-enumeration.
- **Frontend support** — dedicated `/forgot-password`, `/reset-password`, and `/forgot-username` pages.

### Platform admin authentication

- Separate login at `/admin/login`, separate token (`greensync_admin_token`), separate JWT secret (`ADMIN_JWT_SECRET`).
- Has its own forgot/reset password flow (`/admin/forgot-password`, `/admin/reset-password`).

### Customer portal authentication

- Customers log in with phone or email + password to a dedicated portal.
- **Passwordless magic-link login** — a customer can request a one-time login link by email (`POST /api/portal/auth/request-link`). Clicking it auto-signs them in via `POST /api/portal/auth/verify-link`. The link is single-use and short-lived; password login works alongside it. Anti-enumeration: requesting a link always returns success regardless of whether the email exists.
- Includes a "set password" first-time flow and a portal-specific forgot-password flow.
- When a customer is first created (Growth+), a **portal invite email** is automatically sent with a magic-link (or SMS if phone is on file).

---

## 4. Subscription Tiers & Feature Gating

GreenSynk sells three plans. Feature access is enforced **both** in the backend (the `requireFeature()` middleware returns a `403 PlanUpgradeRequired` when a tenant's plan lacks a feature) **and** in the frontend (sidebar plan badges + a `PlanGate` upgrade wall on restricted pages).

### Starter — $49/month
For solo operators who need the core essentials.

- Customer management
- Service catalog
- Appointments / job scheduling
- Invoicing
- Calendar
- Dashboard
- Company settings
- Public booking page
- Email reminders

### Growth — $99/month
For growing teams. **Everything in Starter, plus:**

- Multiple staff members (multi-user)
- Recurring service plans
- SMS reminders & notifications
- Estimates / quotes
- Daily route planning
- Customer notes & tags
- Review requests
- Reporting & analytics
- Branded booking page
- Workflow automations
- Customer self-service portal

### Pro — $199/month
For high-scale operations. **Everything in Growth, plus:**

- Autopay (automatic invoice charging)
- Advanced analytics
- CSV data export (customers, appointments, invoices)
- Lead pipeline
- AI hooks (estimate builder, lead qualification, upsell suggestions)
- Custom intake fields
- White-label booking page

> **Gating logic:** The plan-to-feature map lives in `artifacts/api-server/src/lib/features.ts`. `hasFeature(plan, feature)` checks membership; `requireFeature(feature)` is the Express middleware that blocks access and tells the client which plan is required.

---

## 5. Trial & Subscription Lifecycle

New companies start a **14-day free trial** on the plan they selected during registration. They can evaluate all features of that tier during the trial period.

### Trial cutoff (soft gate)

When the trial expires (or if a subscription is canceled), a **soft cutoff** kicks in:

- **Backend** — `requireActiveSubscription` middleware (in `lib/subscription.ts`) is applied after `requireAuth` on all write routes (customers, appointments, invoices, estimates, services, properties, recurring-plans, team, review-requests, automations, leads). GET requests are always allowed. Non-GET requests from an expired/canceled tenant receive a `402 SubscriptionRequired` response.
- **Frontend** — A `TrialBanner` (in `components/trial-banner.tsx`) is displayed at the top of every app page:
  - Blue / informational: > 7 days remaining
  - Amber / warning: ≤ 7 days remaining
  - Red / urgent: ≤ 3 days remaining
  - Red sticky: trial expired — directs to `/billing`
- **402 global handler** — `QueryCache.onError` in `App.tsx` intercepts any 402 response and redirects to `/billing`, ensuring a clear upgrade path even if an expired user somehow triggers a write.
- Trial status is derived from `user.company.subscriptionStatus` (`"trialing"`) and `user.company.trialEndsAt` — both returned by `GET /api/auth/me`.

### Upgrading

The `/billing` page lets tenants subscribe via Stripe Checkout. On successful payment, the Stripe webhook (`POST /api/stripe/webhook`) updates the company's `subscriptionStatus` to `"active"` and removes the trial cutoff.

---

## 6. Feature Reference (Company App)

The main web application is the operational hub for a lawn care business. Below is every feature area.

### Dashboard (`/dashboard`)
At-a-glance overview of the business: revenue figures, upcoming jobs, and a feed of recent activity.

### Customers (`/customers`, `/customers/:id`)
Full CRUD customer management. Each customer has a detail page showing their history and preferences. Supports **internal notes and tags** (Growth+). A customer can have multiple properties. When a customer is created (Growth+ with portal feature), a **portal invite email** (and optional SMS) is automatically dispatched.

### Properties (`/properties`)
Manage the physical service locations tied to each customer. Appointments and routes are anchored to properties.

### Services (`/services`)
The master catalog of service offerings (e.g. Lawn Mowing, Fertilization, Hedge Trimming, Aeration, Leaf Removal), each with a base price and duration.

### Appointments (`/appointments`) & Calendar (`/calendar`)
Schedule one-off jobs, assign (dispatch) them to staff, and mark them complete. The calendar gives a monthly visual view of all scheduled work. Appointment statuses: `pending`, `confirmed`, `in_progress`, `completed`, `cancelled`, `no_show`.

**Automatic customer notifications on status change** — whenever an appointment's status changes, the customer is automatically notified by email (and SMS when available) with status-specific copy:

| Status | Email subject | Customer message |
|--------|-------------|-----------------|
| `confirmed` | "Appointment Confirmed — {service}" | Appointment is confirmed |
| `in_progress` | "We're on the way — {service}" | Service is now in progress |
| `completed` | "Service Complete — {service}" | Service is complete, thank you |
| `cancelled` | "Appointment Cancelled — {service}" | Appointment was cancelled, please reschedule |
| `no_show` | "We missed you — {service}" | We couldn't reach you, please reschedule |

Notifications are non-blocking — a delivery failure never blocks the status update.

### Recurring Plans (`/recurring`) — Growth+
Templates that automatically generate future appointments on a weekly / bi-weekly / custom cadence, so repeat service contracts run themselves.

### Estimates (`/estimates`, public `/estimate-sign`) — Growth+
Create and send quotes with itemized line items. Customers can view and **e-sign** estimates through a secure public link — the signature and signed-at timestamp are stored on the estimate.

### Invoices (`/invoices`)
Generate invoices (with itemized line items), send them, and track status (Draft → Sent → Paid). Invoices can be created directly or generated from a completed appointment. When an invoice is sent, a **professional invoice email** is automatically dispatched to the customer (including invoice number, due date, itemized line items, total due, and a direct payment link).

**The "Sent" status is delivery-gated — it never appears unless the email was actually delivered.** This guarantee holds across every path that could mark an invoice sent:
- **Manual send** (`POST /invoices/:id/send`) attempts the email first and returns `502 EmailDeliveryFailed` with the status unchanged if it fails.
- **Create** (`POST /invoices` with `status: "sent"`) persists the invoice as **Draft** first and only promotes it to **Sent** once delivery is confirmed.
- **Update** (`PUT /invoices/:id` setting `status: "sent"`) defers the Draft → Sent transition until delivery succeeds, otherwise the prior status is retained.
- **Automations** (auto-invoice on appointment completion) follow the same create-as-draft-then-promote-on-delivery pattern.

Delivery fails when there are no email-provider credentials, the provider rejects the message, or the customer has no email on file — in all of these cases the invoice stays Draft so a "Sent" status never lies about a message that never went out. The underlying email helper returns a structured delivery result (`{ delivered, reason }`) rather than silently swallowing failures. Customer lookups are scoped by company to prevent cross-tenant disclosure.

### Routes (`/routes`) — Growth+ ("SmartRoute")
Plan and optimize the day's service stops. Provides a day-view list (and map) for technicians to follow an ordered route, linking each stop to an appointment.

### Reviews (`/reviews`) — Growth+
Send review/feedback requests to customers after work is completed, and track which requests have been sent.

### Automations (`/automations`) — Growth+
A trigger → action workflow engine (see Section 9). Build rules like "send a review request after an appointment is completed." Supports a **dry-run preview** so the user can see what an automation would do before turning it on.

### Team (`/team`) — Growth+
Invite, update, and remove staff users, and manage their roles.

### Reporting (`/reporting`) — Growth+
Business performance analytics aggregated from operational data (revenue, jobs, customers, etc.). Pro unlocks advanced analytics.

### Settings (`/settings`)
Company profile and **branding** (used on the public booking page and customer communications).

### Billing (`/billing`)
Self-service subscription management powered by Stripe — view current plan/status, see available plans, subscribe/upgrade, and open the Stripe customer portal.

### Data Export — Pro only
CSV export of customers, appointments, and invoices.

---

## 7. Customer-Facing Surfaces

### Public booking page (`/book/:slug`)
A branded, public lead-intake page addressed by the company's slug. Prospective customers can request service without an account. Submissions flow into the company's pipeline.

### Customer portal (Growth+)
A self-service area for the business's end customers:

- `portal-login` / `portal-set-password` / `portal-forgot-password` — portal authentication (password or magic-link)
- `portal-dashboard` — overview
- `portal-appointments` — view upcoming and past appointments
- `portal-invoices` — view invoices and **pay online via Stripe**
- `portal-estimates` — view and sign estimates

### Public estimate signing (`/estimate-sign`)
Customers open a secure tokenized link to review and e-sign an estimate without logging in.

---

## 8. Platform Admin Console

A separate, secured console (dark-themed login) for the operator of GreenSynk to manage the whole platform.

- **`/admin/dashboard`** — Platform metrics: MRR, active subscriptions, total customers, appointments, plan distribution, recent signups, and a recent-activity feed.
- **`/admin/billing`** — Revenue & billing: MRR broken down by plan, subscription-status distribution, a monthly signup chart, and tools to manage past-due companies.
- **`/admin/companies`** & **`/admin/companies/:id`** — Browse all tenant companies (filter by plan + status). The detail page shows a stats row, lets the admin edit company info, keep internal notes, add staff users, reset the owner's password, toggle/delete users, change the plan or account status (suspend/activate), and view recent activity.
- **`/admin/activity`** — Platform-wide audit log with action search and entity-type filtering, enriched with company names.
- **`/admin/admins`** — Manage platform admin users (create, edit, delete).
- **`/admin/settings`** — Admin's own profile (name, email, password).

---

## 9. The Automations Engine

GreenSynk includes a background **trigger → action** automation engine.

**Triggers**
- `appointment_completed`
- `appointment_upcoming_24h`
- `invoice_created`

**Actions**
- `send_review_request`
- `send_follow_up_email`
- `send_sms_reminder`
- `create_invoice`

**How it runs**
- A background scheduler runs on an interval (~5 minutes), scanning for upcoming appointments to fire 24-hour reminders and processing other triggers.
- A **dry-run mode** lets users preview what a rule would do before activating it.

---

## 10. Integrations

### Stripe (payments & billing)
- **SaaS subscription billing** — tenants subscribe to Starter/Growth/Pro; managed through Stripe Checkout/Portal with webhook handling (`POST /api/stripe/webhook`). The webhook also clears the trial cutoff when a subscription becomes active.
- **Customer payments** — end customers pay invoices online through the portal.
- **Autopay** — stored payment methods auto-charge invoices (Pro).
- Uses the Replit Stripe integration (`getUncachableStripeClient()`).

### Resend (email)
The transactional email engine powering **all outbound email**: welcome emails on company signup, invoice emails, reminders, account-recovery emails, security confirmations, review requests, portal invites, appointment status-change notifications, and customer magic-link logins.

- **From address:** `noreply@greensynk.com` (domain verified on Bluehost, DKIM/SPF active)
- **Credentials:** resolved by `lib/resend.ts → resolveEmailCredentials()` which reads `RESEND_API_KEY` and `RESEND_FROM_EMAIL` from the environment
- **Mock mode:** when `RESEND_API_KEY` is absent, emails are logged (not sent) — no errors thrown
- All sends are wrapped in non-blocking try/catch; a Resend error is logged but never breaks the calling request

### Twilio (SMS)
Powers SMS reminders and customer notifications (Growth+). Gated behind the `sms_notifications` feature; gracefully falls back (logged, non-fatal) when Twilio env vars are absent.

---

## 11. Database Schema

The data layer (`lib/db/src/schema/`) defines the full relational model in Drizzle. Every business table is scoped to a `company` for multi-tenant isolation.

> **Always use `NEON_DATABASE_URL`** for direct DB access — `DATABASE_URL` is not used in this project.

| Table | Purpose |
|-------|---------|
| `companies` | The tenant root — branding, contact info, slug, `subscription_plan`, `subscription_status`, `trial_ends_at` |
| `users` | Company staff/owners (roles: owner, admin, staff) |
| `platform_admins` | Super-admins for the whole SaaS platform |
| `platform_settings` | Singleton (id=1) platform-wide config: admin-dormancy settings **and the public contact email addresses** referenced by the marketing site, legal pages, and the contact form. Only three real mailboxes exist — `hello@` (general), `support@`, `sales@`; the `privacy` and `legal` columns default to the general `hello@` address but remain independently overridable |
| `customers` | Client profiles (includes portal password hash, magic-link token) |
| `properties` | Physical service locations, linked to customers |
| `services` | Master list of offered services + base prices/duration |
| `appointments` | Individual work orders (status: pending / confirmed / in_progress / completed / cancelled / no_show). The `origin` column marks who created the visit — `company` (default, incl. recurring-generated) vs `portal_request` (booked by a customer through the portal); only `portal_request` rows are customer-cancellable |
| `recurring_plans` | Templates that generate future appointments |
| `invoices` + `invoice_line_items` | Billing records and their itemized lines |
| `estimates` + `estimate_line_items` | Quotes, with signature data and signed-at timestamp |
| `routes` + `route_stops` | Daily technician routes and their ordered stops |
| `automations` | Automation rules (trigger type + action type) |
| `review_requests` | Log of feedback requests sent to customers |
| `activity_logs` | System-wide audit trail of all company actions |

---

## 12. Complete API Surface

All endpoints are mounted under `/api`.

### Company (JWT: `greensync_token`)
- `POST /api/auth/register` — create company + owner (sends welcome email)
- `POST /api/auth/login` — returns JWT
- `GET /api/auth/me` — current user + company (includes `subscriptionStatus`, `trialEndsAt`)
- `POST /api/auth/forgot-password` / `reset-password` / `forgot-username`
- `GET /api/dashboard` — today's stats
- `CRUD /api/customers`
- `CRUD /api/properties`
- `CRUD /api/services`
- `CRUD /api/appointments` + `POST /api/appointments/:id/complete`
- `CRUD /api/invoices` + send + mark-paid
- `CRUD /api/estimates`
- `CRUD /api/recurring-plans`
- `CRUD /api/routes` + add/remove stops
- `POST /api/review-requests` + list
- `CRUD /api/automations` + toggle
- `GET/PUT /api/settings`
- `GET /api/team` + invite + update + remove
- `GET /api/billing/status` / `plans` + `POST /api/billing/subscribe` / `portal`
- Autopay endpoints (manage payment methods, auto-charge)
- CSV export endpoints (Pro)
- `GET /api/activity`

> **Write routes** (non-GET) are additionally gated by `requireActiveSubscription` — returns `402 SubscriptionRequired` when the trial has expired or the subscription is canceled.

### Public
- `GET /api/platform/contact-info` — platform contact emails (general/support/sales/privacy/legal) from `platform_settings`; **single source of truth** consumed by the marketing site, legal pages, and SEO JSON-LD
- `GET /api/public/booking/:slug` — booking page data
- `POST /api/public/booking/:slug` — submit a booking request
- Public estimate view/sign endpoints (tokenized)
- `POST /api/stripe/webhook` — Stripe events

> **No-hardcoding principle:** Platform contact emails must NOT be hardcoded in the frontend. They live in `platform_settings` and are fetched at runtime via `/api/platform/contact-info` (React: `use-contact-info` hook + `ContactEmailLink`). SEO prerender/SSR resolve them at build/serve time via `site-config.mjs` (`getOrgContactEmail`), falling back to `DEFAULT_CONTACT_EMAIL` only when the API is unreachable during a build.

### Customer Portal (portal auth)
- `POST /api/portal/auth/login` — password login (phone or email + password)
- `POST /api/portal/auth/request-link` — request a passwordless magic-link email
- `POST /api/portal/auth/verify-link` — exchange magic-link token for portal session
- `POST /api/portal/auth/set-password` / `forgot-password` / `reset-password`
- View appointments, invoices (pay via Stripe), estimates (sign)
- `POST /api/portal/appointments` — customer-submitted booking request (`origin = portal_request`)
- `POST /api/portal/appointments/:id/cancel` — customers may cancel **only their own portal-submitted requests**; company-scheduled visits (incl. recurring-generated) return `403` and the UI directs the customer to contact the company

### Platform Admin (JWT: `greensync_admin_token`)
- `POST /api/admin/auth/login` + `GET /api/admin/auth/me`
- Admin forgot/reset password
- `GET /api/admin/dashboard`
- `GET /api/admin/companies` + `GET /api/admin/companies/:id`
- `POST /api/admin/companies/:id/suspend` / activate / plan / notes
- `GET /api/admin/admins` + `POST /api/admin/admins`
- `GET /api/admin/activity`
- `POST /api/admin/seed` — seed demo data

---

## 13. Environment Configuration

| Variable | Purpose |
|----------|---------|
| `NEON_DATABASE_URL` | PostgreSQL connection (always use this, not `DATABASE_URL`) |
| `JWT_SECRET` | Company token signing (auto-generated if absent) |
| `ADMIN_JWT_SECRET` | Admin token signing |
| `SESSION_SECRET` | Portal JWT signing key |
| `STRIPE_SECRET_KEY` | Stripe (via Replit integration) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook verification |
| `RESEND_API_KEY` | Transactional email via Resend (noreply@greensynk.com) |
| `RESEND_FROM_EMAIL` | Sender address (noreply@greensynk.com) |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` | SMS (optional) |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | Object storage bucket |
| `PRIVATE_OBJECT_DIR` | Private object storage path |
| `PUBLIC_OBJECT_SEARCH_PATHS` | Public object storage search paths |

---

## 14. Access Credentials

> **Security note:** Do not store production credentials in this document. Admin login is at `/admin/login`; use the password manager or 1Password vault entry for the platform admin account.

> **Test company:** "Greensmithlawn" — `status=trialing`, `trial_ends_at=2026-06-22`. Log in via the company portal using company slug.

> **Note:** The production database has been wiped of all mock/seed data. Only real signups exist. Use `POST /api/admin/seed` on a staging/dev instance to populate demo data.

---

## 15. Summary

GreenSynk is a complete, multi-tenant vertical SaaS for the lawn care industry. It combines:

- **Operations** — customers, properties, services, scheduling, calendar, recurring plans, and optimized routing.
- **Sales & revenue** — estimates with e-signature, invoicing with online payment, autopay, and Stripe-powered subscription billing across three tiers.
- **Growth & retention** — a customer self-service portal, public booking pages, review requests, SMS/email reminders, a trigger-based automation engine, and automatic customer notifications on every appointment status change.
- **Trial management** — a 14-day free trial with a soft cutoff (backend 402 blocking + frontend countdown banner) that funnels expired users to the billing upgrade page.
- **Platform operations** — a full super-admin console for managing tenants, monitoring MRR, and auditing activity.

All of it is built on a strongly-typed pnpm/TypeScript monorepo with an end-to-end type-safe API layer, enforced multi-tenant data isolation, plan-based feature gating on both server and client, and transactional email via Resend with the verified `greensynk.com` domain.

---

## 16. Application Audit — June 2026 (Updated: June 19 2026)

> Initial audit performed against `master` branch (commit `54fa9f6`). Live site: greensynk.com. Compared against Jobber, Housecall Pro, ServiceTitan, and LawnStarter.
> **Hardening sprint completed June 19 2026** — 15 issues fixed across commit `125a2ff`. This section reflects the current post-hardening state.

---

### What GreenSynk Does Exceptionally Well

**Multi-tenancy isolation**
Every DB query is filtered by `companyId` derived from the JWT — never from the request body. The private object storage endpoint (`storage.ts:89`) additionally verifies DB ownership before serving any file. A cross-tenant write vulnerability in `properties.ts` (mass assignment via `...req.body` spread) was discovered and patched in the hardening sprint — all write routes now use explicit Zod-validated field whitelists.

**SSRF protection**
`lib/safe-fetch.ts` implements a complete, defense-in-depth SSRF guard for all server-side image fetches (e.g., tenant logo in PDF generation): HTTPS-only, full private-IP block list covering IPv4 (RFC1918, CGNAT, link-local, multicast), IPv6 (loopback, link-local, ULA, IPv4-mapped), redirect refusal, content-type validation, and a hard timeout. This is better than most production SaaS applications.

**Stripe webhook security**
The webhook handler refuses to process any event when `STRIPE_WEBHOOK_SECRET` is absent (returns `503`), verifies every signature with `constructEvent`, and uses conditional DB updates (`ne(status, "paid")`) to make every handler idempotent against Stripe replay. Subscription status is re-read live from Stripe (not assumed) to avoid premature trial-to-active flips. `trialEndsAt` is now cleared on `invoice.payment_succeeded` to prevent a stale trial date from blocking a paid account. This is textbook Stripe integration.

**Auth architecture**
Four fully separated auth contexts (company JWT, admin JWT, portal JWT, public tokens) each with independent secrets and type checks. Admin routes enforce a forced-password-change gate at the router level. bcrypt cost factor is 12. Password reset tokens are single-use and expire in 1 hour. Anti-enumeration is applied on all account-recovery endpoints. Post-hardening additions: `requireAuth` now validates tokens against `passwordChangedAt` (stolen tokens expire on password reset); password complexity is enforced at registration and all set-password flows; admin JWT expiry reduced from 7 days to 4 hours.

**Feature gating — defense in depth**
Plan limits and feature gates are enforced identically on the server (`requireFeature`, `requireWithinPlanLimit`) and the client (`PlanGate` component, sidebar badges). Downgrade safety is enforced server-side (`getDowngradeViolations`) — the UI warning cannot be bypassed via API. Post-hardening: `data_export` and `sms_notifications` added to `plan-gate.tsx` so upgrade prompts render for these features.

**Structured logging and error handling**
pino structured logs on every request (method, URL, status — no query strings to avoid leaking tokens). All background tasks (automations, recurring plans, follow-ups) are non-fatal to the calling request. The global error handler scrubs 5xx messages. Stripe API keys are redacted before surfacing error messages to clients (`billing.ts:644`).

**Subscription lifecycle**
The trial soft-cutoff blocks writes via `requireActiveSubscription` (returns `402`) while allowing reads. The frontend intercepts 402 globally and redirects to `/billing`. `past_due` accounts now receive a 7-day grace period from `currentPeriodEnd` before writes are blocked. Canceled companies can no longer access export or reporting routes. All four invoice-payment paths dispatch receipt and owner-notification emails idempotently.

**Invoice integrity**
Invoice numbers are now generated atomically using a per-company sequence counter (`next_invoice_seq` column, updated via `GREATEST(seq+1, count+1)` `UPDATE … RETURNING`). Concurrent invoice creation can no longer produce duplicate `INV-XXXX` numbers.

---

### Security Issues — Current Status

#### ✅ RESOLVED — Hardcoded Credentials in Version-Controlled Files

**What it was:** Admin credentials (`Admin1234!`, `admin@greensynk.com`) and demo company credentials (`Demo1234!`, `alex@greenscapes.com`) were stored in plain text in `GREENSYNK_OVERVIEW.md` and `replit.md`.
**Action taken:** Both files scrubbed. Admin password confirmed rotated (live API returns `401` for the old credential). **Git history note:** The credentials appear across 4 historical commits — `de18dd1`, `ab24741`, `7813bdb`, `34a1f0a`. Since the passwords no longer work, the practical risk is low. The admin email address (`admin@greensynk.com`) is permanently visible in history. If this repo is ever made public, consider a history rewrite (`git filter-repo`) — this requires a force-push and coordination with all collaborators.

#### ✅ RESOLVED — CORS Fallback Allows Any Origin

**Was:** `origin: allowedOrigins.length > 1 ? allowedOrigins : true` — a missing `FRONTEND_URL` env var caused `Access-Control-Allow-Origin: *` with `credentials: true`.
**Fixed:** `origin: allowedOrigins.length > 0 ? allowedOrigins : false` — the fallback now refuses all cross-origin credentialed requests. Stronger than the recommended fix.

#### ✅ RESOLVED — JWT Tokens Not Invalidated After Password Reset

**Was:** Stolen company user tokens remained valid for 7 days after a password change.
**Fixed:** Added `password_changed_at` column to `users` table. `requireAuth` now queries `passwordChangedAt` per request and rejects tokens with `iat < passwordChangedAt`. `reset-password` sets the column on every successful reset.

#### ✅ RESOLVED — Password Strength Not Enforced on Registration

**Was:** `PASSWORD_REGEX` (uppercase + lowercase + digit + special char) was applied only on `/reset-password`. Registration, portal `set-password`, and admin create flows accepted any 8-character string.
**Fixed:** `PASSWORD_REGEX` now enforced on `/register` (company signup) and portal `/auth/set-password`.

#### ✅ RESOLVED — CSP Disabled

**Was:** `helmet` loaded with `contentSecurityPolicy: false`.
**Fixed:** CSP now enabled with a restrictive explicit policy covering `script-src`, `style-src`, `img-src`, and `connect-src`. No `unsafe-eval` or `unsafe-inline` in `script-src`.

#### ✅ RESOLVED — Cross-Tenant Write via Mass Assignment (`properties.ts`)

**Was:** `POST /api/properties` spread `...req.body` directly into the DB insert after `companyId`. A body containing `{"companyId": 999}` would override the JWT-sourced value, creating properties under another tenant's account.
**Fixed:** Explicit `createPropertySchema` Zod schema whitelists allowed fields. `companyId` comes only from `req.user` (JWT). Same schema applied to `PUT` updates.

#### ✅ RESOLVED — Invoice Number Race Condition

**Was:** Both `routes/invoices.ts` and `lib/automations.ts` generated invoice numbers via `COUNT(*) + 1` — concurrent requests produced duplicate `INV-XXXX` numbers.
**Fixed:** Added `next_invoice_seq integer` column to `companies` table. Number generation uses `UPDATE companies SET next_invoice_seq = GREATEST(seq+1, count+1) RETURNING next_invoice_seq` — fully atomic at the DB level. Self-heals for companies that existed before the column was added.

#### ✅ RESOLVED — Estimate `publicToken` Stored in Plain Text

**Was:** Estimate signing tokens stored as raw strings in the DB. A DB breach would expose all active signing links.
**Fixed:** Now stores SHA-256 hash (matching the portal invite token pattern). `send-for-signature` always generates a fresh raw token + hash (old links are invalidated). Public signing endpoints hash the incoming URL token before DB lookup.

#### ✅ RESOLVED — Admin JWT 7-Day Lifetime

**Was:** Platform admin tokens expired after 7 days with no revocation path — same as company user tokens despite admin having platform-wide authority.
**Fixed:** `signAdminToken` now issues 4-hour tokens.

#### ✅ RESOLVED — Seed Endpoint Mounted in Production

**Was:** `POST /api/admin/seed` mounted unconditionally — a compromised admin token could insert a backdoor company with known credentials.
**Fixed:** Endpoint returns `404` when `NODE_ENV === "production"`.

#### ✅ RESOLVED — Admin `reset-password` Did Not Clear `mustChangePassword`

**Was:** Using the email reset link did not clear the forced-change gate — an admin created with `mustChangePassword: true` who reset via email remained blocked.
**Fixed:** `admin-auth.ts` reset-password handler now sets `mustChangePassword: false`.

#### ✅ RESOLVED — Public Booking Appointment Gaps

**Was:** Appointments created via `POST /book/:slug/submit` had three issues: (1) null `origin` field broke the portal cancellation gate; (2) `serviceId` accepted any integer without validating it belonged to the company; (3) `notes`, `gateNotes`, `yardSize` fields had no maximum length.
**Fixed:** `origin: "portal_request"` set on all public booking appointments; `serviceId` validated against `(serviceId, companyId, isActive)` before insert; max-length constraints added to all text fields.

#### ✅ RESOLVED — `past_due` Accounts Not Blocked from Writes

**Was:** `requireActiveSubscription` only blocked `canceled` and expired trials. A company with a failed payment could write indefinitely.
**Fixed:** 7-day grace period from `currentPeriodEnd`. After grace expires, writes return `402 SubscriptionRequired` with a payment message. Stripe's `customer.subscription.updated` correctly writes `past_due` to the DB; the middleware now enforces it.

#### ✅ RESOLVED — `trialEndsAt` Not Cleared on Payment

**Was:** `invoice.payment_succeeded` / `customer.subscription.updated` webhooks updated `subscriptionStatus` but not `trialEndsAt`. A stale past `trialEndsAt` on an `active` account would cause `requireActiveSubscription` to 402-block all writes.
**Fixed:** `trialEndsAt: null` added to the `invoice.payment_succeeded` DB update.

#### ✅ RESOLVED — Export and Reporting Accessible After Cancellation

**Was:** `export.ts` and `reporting.ts` used `requireAuth` + `requireFeature` but not `requireActiveSubscription`. Canceled companies retained indefinite access to data export and analytics.
**Fixed:** `requireActiveSubscription` added to both routers.

#### ✅ RESOLVED — `data_export` / `sms_notifications` Missing from `plan-gate.tsx`

**Was:** These two features were absent from `PlanGate`'s `FeatureKey` type and `REQUIRED_PLAN` map. The frontend could not render an upgrade prompt for them.
**Fixed:** Both added with descriptions and bullet points. Backend enforcement was always correct; this closes the UI gap.

---

### Open Issues

#### LOW — Portal JWT Shares the Same Base Secret as Company JWT

**File:** `artifacts/api-server/src/routes/customer-portal.ts`
**Issue:** `PORTAL_JWT_SECRET` is `SESSION_SECRET + "portal:"` — the same base secret with a string prefix. The `payload.type === "portal"` check prevents cross-context forgery at the application layer, but the signing keys are not cryptographically independent. A dedicated `PORTAL_JWT_SECRET` environment variable would make them independently rotatable.
**Action:** Low effort — add `PORTAL_JWT_SECRET` to env, read it in `customer-portal.ts`, fall back to derived value only if absent (to avoid breaking live sessions on deploy).

#### LOW — Portal JWT 30-Day Lifetime with No Post-Password-Change Invalidation

**File:** `artifacts/api-server/src/routes/customer-portal.ts`
**Issue:** Customer portal tokens expire after 30 days (vs. 7 days for company users). There is no `passwordChangedAt` equivalent for customers — a stolen portal token remains valid for up to 30 days after the customer changes their password.
**Action:** Add `portalPasswordChangedAt` to `customers` table; check in `requirePortalAuth` (same pattern as the company user fix applied in this sprint).

#### LOW — In-Memory Rate Limiter Is Not Distributed

**File:** `artifacts/api-server/src/app.ts`
**Issue:** Rate limit state lives in a `Map` in the Node.js process. Limits reset on restart and are not enforced across multiple instances. Acceptable for single-instance Replit deployment; a risk if the server is ever scaled horizontally.
**Action:** Replace with Redis-backed rate limiting (e.g., `rate-limiter-flexible`) before horizontal scaling.

---

### Operational Gaps vs. Industry Standard (Jobber / Housecall Pro / ServiceTitan)

The following are not bugs — they are missing features relative to what competing $49–$199/month vertical SaaS platforms provide at equivalent price points.

| Gap | Competitors that have it | Priority |
|-----|--------------------------|----------|
| **Native mobile app (iOS/Android)** | Jobber, HCP, ServiceTitan | High — field crews operate on phones; a mobile-responsive web app is a daily friction point |
| **QuickBooks / Xero integration** | Jobber, HCP, ServiceTitan | High — the #1 integration request from any service business owner |
| **Job photos attached to invoices/work orders** | Jobber, HCP | Medium — before/after photos currently exist but are not surfaced on customer-facing documents |
| **Time tracking / clock-in/out** | Jobber, ServiceTitan | Medium — staff time on jobs is not tracked; required for payroll and labor cost reporting |
| **Two-way SMS inbox** | Jobber, HCP | Medium — current SMS is outbound only (Twilio); customers cannot reply in-app |
| **Custom email templates with brand variables** | HCP, ServiceTitan | Medium — current email copy is hardcoded strings; tenants cannot brand or customize their transactional emails |
| **GPS real-time crew tracking** | ServiceTitan | Low — GPS metadata is stored on appointments but there is no live map view for dispatchers |
| **Recurring plan price escalation** | ServiceTitan | Low — recurring plans use a fixed price; no annual-increase or CPI escalation logic |
| **Chemical/material tracking** | ServiceTitan | Low — relevant for licensed pesticide applicators; not a day-one need |

---

### Architecture & Technical Debt Observations

**No automated test suite.** Zero unit, integration, or e2e tests exist in the codebase. Prior e2e suites were deleted because they wrote to the production Neon DB. The right fix is a dedicated test database, not deleted tests. Highest-risk coverage gaps: auth token flows (especially the new `passwordChangedAt` check), multi-tenancy isolation (`companyId` scoping), Stripe webhook handlers, and plan-limit enforcement. The `requireAuth` middleware now performs a DB query per request — this is correct but makes a regression in that path more impactful.

**Automation scheduler runs in-process.** The 5-minute automation scheduler and recurring-plan generator are `setInterval` loops inside the same Node.js process as the API server. Fine for single-instance Replit deployment, but will fire duplicate automations if scaled horizontally. Recommend BullMQ + Redis or Trigger.dev before horizontal scaling.

**`subscriptionStatus: "past_due"` — grace period uses `currentPeriodEnd` as proxy.** The 7-day grace clock starts from `currentPeriodEnd` (when the billing period ended), not from when Stripe first attempted to charge. In practice these differ by at most hours (Stripe charges at period end), but a dedicated `pastDueAt` column would be more precise and allow admin-configurable grace periods per company.

---

### Scorecard (Updated June 19 2026)

| Dimension | Before | After | Notes |
|-----------|--------|-------|-------|
| Multi-tenancy isolation | 10/10 | **10/10** | Mass assignment in `properties.ts` found and fixed |
| SSRF protection | 10/10 | **10/10** | Unchanged — among the best seen in production SaaS |
| Stripe integration | 10/10 | **10/10** | `trialEndsAt` clear-on-payment added |
| Auth design | 8/10 | **9/10** | JWT invalidation + password strength + 4h admin expiry; docked 1 for portal shared secret |
| RBAC enforcement | 9/10 | **9/10** | Unchanged; portal JWT secret concern remains |
| Input validation | 9/10 | **10/10** | Properties Zod schema, booking field limits, serviceId validation, password regex on all flows |
| CORS configuration | 6/10 | **10/10** | Fixed + hardened (now returns `false` not `true`) |
| Rate limiting | 7/10 | **7/10** | Unchanged — in-memory, single-instance only |
| Security headers | 6/10 | **9/10** | CSP enabled with restrictive policy |
| Test coverage | 1/10 | **1/10** | Zero automated tests — highest ongoing risk |
| Operational maturity | 7/10 | **8/10** | Subscription enforcement hardened; export/reporting gated |
| **Overall** | **8.3/10** | **9.0/10** | 15 issues resolved; 3 low-severity items remain open |

---

### Remaining Action Items

The items below were not resolved in the June 19 hardening sprint — either deferred by priority or requiring additional infrastructure.

1. **Portal JWT shared secret** — add `PORTAL_JWT_SECRET` env var; update `customer-portal.ts` to use it independently.
2. **Portal `passwordChangedAt`** — add `portal_password_changed_at` to `customers` table; check in `requirePortalAuth` to invalidate portal tokens after customer password changes.
3. **In-memory rate limiter** — move to Redis-backed implementation before horizontal scaling.
4. **Git history** — `Admin1234!` and `Demo1234!` remain in 4 historical commits. If the repo is ever made public, run `git filter-repo` to rewrite history and force-push (coordinate with all collaborators first).
5. **`past_due` grace period precision** — replace `currentPeriodEnd` proxy with a dedicated `past_due_at` timestamp column for per-company configurable grace periods.

### Near-Term Roadmap (Next 60 Days)

6. **Test suite** — add integration tests covering: `requireAuth` passwordChangedAt flow, `companyId` isolation on all CRUD routes, Stripe webhook handlers, and plan-limit enforcement. Use a dedicated test DB, not production Neon.
7. **Automation scheduler** — move `setInterval`-based automations and recurring-plan generators to BullMQ + Redis or Trigger.dev before any horizontal scaling.
8. **QuickBooks Online integration** — the single highest-ROI feature gap vs. Jobber/HCP at this price point.
9. **Technician mobile view** — field-first UI for route stops, job logging, and payment collection on one screen (previously scoped for the FieldRoutes parity sprint).
10. **KPI dashboard** — recharts-based revenue trends and retention rate analytics.

---

## 17. Future Iterations

### PWA — Installable Web App (Tabled — Future Iteration)

GreenSynk is currently a standard React SPA. It is **not** a Progressive Web App and cannot be installed on a user's device. This is a known gap vs. Jobber and Housecall Pro, which offer native mobile apps.

**When this is prioritized, the implementation plan is:**

1. Install `vite-plugin-pwa` (`pnpm --filter @workspace/lawn-saas add -D vite-plugin-pwa`)
2. Add `VitePWA()` to `artifacts/lawn-saas/vite.config.ts` with a manifest pointing `start_url` to `/dashboard`
3. Generate 192×192 and 512×512 maskable icon variants from the existing `logo-icon.png`
4. Scope the Workbox service worker to cache static assets only — never authenticated API responses

**What users would gain:**
- **Android:** Install prompt, standalone launch, home screen icon, splash screen
- **iOS:** "Add to Home Screen" via Safari share sheet, standalone mode (no browser chrome)
- **Desktop (Chrome/Edge):** Address bar install button, launches as its own window

**Constraints to keep in mind:**
- iOS does not auto-prompt for installation — users must use the Safari share sheet manually
- The service worker must not cache `/api/*` routes or portal/dashboard routes
- `start_url: "/dashboard"` ensures installed users land on the app, not the marketing page
- A native iOS/Android app (Expo/React Native) remains the longer-term goal for field crews; the PWA is a stepping stone that closes the gap at low cost
