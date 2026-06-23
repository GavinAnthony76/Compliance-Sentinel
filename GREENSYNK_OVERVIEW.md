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
Company profile and **branding** (used on the public booking page and customer communications). Tabs: Business Info, Branding, Payments, and **App & Notifications** (PWA install prompt + push notification placeholder).

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

## 16. Application Audit — June 2026

> Performed against the `master` branch (commit `54fa9f6`). Live site: greensynk.com. Compared against Jobber, Housecall Pro, ServiceTitan, and LawnStarter.

---

### What GreenSynk Does Exceptionally Well

**Multi-tenancy isolation**
Every DB query is filtered by `companyId` derived from the JWT — never from the request body. The private object storage endpoint (`storage.ts:89`) additionally verifies DB ownership before serving any file. There is no known cross-tenant data exposure path.

**SSRF protection**
`lib/safe-fetch.ts` implements a complete, defense-in-depth SSRF guard for all server-side image fetches (e.g., tenant logo in PDF generation): HTTPS-only, full private-IP block list covering IPv4 (RFC1918, CGNAT, link-local, multicast), IPv6 (loopback, link-local, ULA, IPv4-mapped), redirect refusal, content-type validation, and a hard timeout. This is better than most production SaaS applications.

**Stripe webhook security**
The webhook handler refuses to process any event when `STRIPE_WEBHOOK_SECRET` is absent (returns `503`), verifies every signature with `constructEvent`, and uses conditional DB updates (`ne(status, "paid")`) to make every handler idempotent against Stripe replay. Subscription status is re-read live from Stripe (not assumed) to avoid premature trial-to-active flips. This is textbook Stripe integration.

**Auth architecture**
Four fully separated auth contexts (company JWT, admin JWT, portal JWT, public tokens) each with independent secrets and type checks (`payload.type !== "user"` guards in every middleware). Admin routes enforce a forced-password-change gate at the router level. bcrypt cost factor is 12. Password reset tokens are single-use and expire in 1 hour. Anti-enumeration is applied on all account-recovery endpoints.

**Feature gating — defense in depth**
Plan limits and feature gates are enforced identically on the server (`requireFeature`, `requireWithinPlanLimit`) and the client (`PlanGate` component, sidebar badges). Downgrade safety is enforced server-side (`getDowngradeViolations`) — the UI warning cannot be bypassed via API.

**Structured logging and error handling**
pino structured logs on every request (method, URL, status — no query strings to avoid leaking tokens). All background tasks (automations, recurring plans, follow-ups) are non-fatal to the calling request. The global error handler scrubs 5xx messages. Stripe API keys are redacted before surfacing error messages to clients (`billing.ts:644`).

**Trial lifecycle**
The trial soft-cutoff blocks writes via `requireActiveSubscription` (returns `402`) while allowing reads. The frontend intercepts 402 globally and redirects to `/billing`. Trial preservation during Stripe checkout (keeping remaining days, minimum 48-hour buffer) is handled correctly.

**Subscription lifecycle completeness**
All four invoice-payment paths (mark-paid, portal webhook, portal confirm-payment, autopay charge) are wired to dispatch receipt and owner-notification emails. All billing activity is idempotently logged.

---

### Security Issues

#### HIGH — Hardcoded Admin Password in Version-Controlled Document

**File:** `GREENSYNK_OVERVIEW.md` (Section 14, now remediated in this commit)
**What it was:** The platform admin password (`Admin1234!`) was stored in plain text in a git-tracked markdown file.
**Risk:** Anyone with read access to the repo (or git history) can log in as the platform super-admin. If this repo is ever made public or leaked, the impact is total platform compromise.
**Action taken:** The password has been removed from this document. The password itself **must be rotated immediately** — git history is permanent. Change the admin password via `/admin/settings` or directly via the DB, then verify no other copies exist in commit history.

#### MEDIUM — CORS Fallback Allows Any Origin

**File:** `artifacts/api-server/src/app.ts:73`
**Code:** `origin: allowedOrigins.length > 1 ? allowedOrigins : true`
**Risk:** If `FRONTEND_URL` is not set in the environment, `allowedOrigins` contains only the `*.replit.dev` regex pattern (length = 1), which triggers the fallback to `true` — equivalent to `Access-Control-Allow-Origin: *` with `credentials: true`. Any origin can then make credentialed cross-origin requests to the API.
**Fix:**
```typescript
// Change line 73 in app.ts:
origin: allowedOrigins.length > 0 ? allowedOrigins : false,
```
Also ensure `FRONTEND_URL` is set to `https://greensynk.com` in the production environment.

#### MEDIUM — JWT Tokens Have No Invalidation Mechanism

**File:** `artifacts/api-server/src/lib/auth.ts:32,36`
**Issue:** Tokens are signed with a 7-day expiry and no revocation list or `iat`/`jti` blacklist. A password reset (`auth.ts:277`) clears the reset token but does not invalidate existing JWTs. If a user's credentials are compromised, all active sessions remain valid for up to 7 days after a password change.
**Recommended fix (ordered by effort):**
1. *(Minimal)* Add a `passwordChangedAt` timestamp to users. Verify in `requireAuth` that `token.iat > user.passwordChangedAt`. Zero revocation storage needed.
2. *(Better)* Shorten expiry to 24h and issue a refresh token via an HttpOnly cookie.

#### LOW — Portal JWT Shares the Same Base Secret as Company JWT

**File:** `artifacts/api-server/src/routes/customer-portal.ts:12–29`
**Issue:** `PORTAL_JWT_SECRET` is derived from `SESSION_SECRET` with a string prefix appended (`"portal:"`). While the type check (`payload.type !== "portal"`) prevents cross-context forgery, this is a fragile separation. A dedicated `PORTAL_JWT_SECRET` environment variable would make the separation explicit and independently rotatable.

#### LOW — In-Memory Rate Limiter Is Not Distributed

**File:** `artifacts/api-server/src/app.ts:10–36`
**Issue:** Rate limit state lives in a `Map` in the Node.js process. If the API server restarts or scales to multiple instances, limits reset. The login/register/forgot-password endpoints get at most 10–20 requests per minute per IP — reasonable for a single-instance deployment.
**For multi-instance deployments:** Replace with Redis-backed rate limiting (e.g., `rate-limiter-flexible`).

#### LOW — Content-Security-Policy Disabled

**File:** `artifacts/api-server/src/app.ts:41–44`
**Issue:** `helmet` is loaded but `contentSecurityPolicy: false` explicitly disables CSP. Since JWTs are stored in `localStorage`, a CSP is the primary defense against XSS token theft.
**Recommended:** Add a CSP appropriate for the React app (allow `self`, Stripe CDN, Resend, Twilio script origins). This is a frontend server concern but should be coordinated with the Vite SSR server config as well.

#### INFORMATIONAL — `POST /api/admin/seed` Is a Mounted Route in Production

**File:** `artifacts/api-server/src/routes/admin.ts` (seed endpoint)
**Issue:** The seed endpoint is protected by `requireAdminAuth`, so it is not exploitable by unauthenticated users. However, having a data-destruction/seeding endpoint mounted on the production API surface is a risk surface that should be removed or disabled via an environment flag (`NODE_ENV !== "production"`).

---

### Operational Gaps vs. Industry Standard (Jobber / Housecall Pro / ServiceTitan)

The following are not bugs — they are missing features relative to what competing $49–$199/month vertical SaaS platforms provide at equivalent price points.

| Gap | Competitors that have it | Priority |
|-----|--------------------------|----------|
| **Native mobile app (iOS/Android)** | Jobber, HCP, ServiceTitan | Medium — ✅ PWA now installable on iOS/Android/desktop (June 2026); native app (Expo/React Native) remains longer-term goal |
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

**No automated test suite.** Zero unit, integration, or e2e tests exist in the codebase. The agent memory notes (`test-suites-pollute-neon.md`) acknowledge that prior e2e suites wrote to the production Neon DB. The right fix is a dedicated test database, not deleting the tests. Missing coverage areas of highest risk: auth token flows, multi-tenancy isolation (`companyId` scoping), Stripe webhook handlers, and plan-limit enforcement. Without tests, any refactor of `auth.ts`, `features.ts`, or `billing.ts` carries high regression risk.

**Automation scheduler runs in-process.** The 5-minute automation scheduler and recurring-plan generator are `setInterval` loops inside the same Node.js process as the API server. This is fine for a single-instance deployment, but will cause duplicate automation fires if the server is scaled horizontally. Recommend a job queue (BullMQ + Redis, or Trigger.dev) before horizontal scaling.

**Invoice number generation has a race condition.** `lib/automations.ts:195–200` generates invoice numbers by counting existing invoices and incrementing (`INV-{count+1}`). Under concurrent requests, two invoices can receive the same number. Fix: use a DB sequence (`serial` or `gen_random_uuid()` with a formatted prefix) or a `SELECT ... FOR UPDATE` advisory lock.

**`subscriptionStatus: "past_due"` does not block writes.** `lib/subscription.ts` only blocks writes when status is `"canceled"` or the trial has expired. A `"past_due"` account (failed payment) can still create customers, appointments, and invoices indefinitely. Competitors typically give a 7–14 day grace period then restrict writes. Consider adding `past_due` to the cutoff logic with a grace period configurable per company.

---

### Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Multi-tenancy isolation | 10/10 | Flawless — all queries scoped by JWT-derived companyId |
| SSRF protection | 10/10 | Among the best implementations seen in production SaaS |
| Stripe integration | 10/10 | Textbook — signature verification, idempotency, correct status handling |
| Auth design | 8/10 | Strong; docked for shared portal secret + no post-reset invalidation |
| RBAC enforcement | 9/10 | Dual server+client enforcement; minor portal JWT secret concern |
| Input validation | 9/10 | Zod schemas throughout all mutation routes |
| CORS configuration | 6/10 | Functional but has a fallback-to-wildcard bug |
| Rate limiting | 7/10 | Correctly placed, but in-memory only |
| Security headers | 6/10 | Helmet loaded, but CSP explicitly disabled |
| Test coverage | 1/10 | Zero automated tests |
| Operational maturity | 7/10 | Structured logs, audit trail, activity feed; no alerting or health dashboards |
| **Overall** | **8.3/10** | Production-ready with two issues requiring prompt action |

---

### Immediate Action Items (Before Next Onboarding Push)

1. **Rotate the platform admin password.** The old password was stored in git history — rotation is not optional.
2. **Fix the CORS fallback** (`app.ts:73`): change `allowedOrigins.length > 1` to `allowedOrigins.length > 0`, and confirm `FRONTEND_URL=https://greensynk.com` is set in production.
3. **Add post-reset token invalidation** — add `passwordChangedAt` to the users table and check `token.iat > passwordChangedAt` in `requireAuth`.
4. **Disable or gate the seed endpoint** — wrap in `if (process.env.NODE_ENV !== "production")` or remove from the production build.
5. **Fix invoice number race condition** — use a DB sequence instead of `count(*) + 1`.

### Near-Term Roadmap (Next 60 Days)

6. Add a test suite covering auth flows, companyId isolation, and Stripe webhook handlers.
7. Move the automation/recurring schedulers to BullMQ before horizontal scaling.
8. Add `past_due` to the subscription cutoff with a configurable grace period.
9. Enable CSP headers (coordinate with the SSR/Vite server).
10. QuickBooks Online integration — the single highest-ROI feature missing vs. Jobber/HCP at this price point.

---

## 17. Future Iterations

### PWA — Installable Web App ✅ Implemented (June 2026)

GreenSynk is now a **Progressive Web App** — installable on Android, iOS, and desktop. Field technicians and business owners can add it to their home screen for a native-app-like experience.

**What was implemented:**

- `vite-plugin-pwa ^1.0.0` + `workbox-window ^7.4.0` added to `artifacts/lawn-saas`
- `VitePWA()` configured in `vite.config.ts` with `generateSW` strategy
- Web app manifest: `name: GreenSynk`, `start_url: /dashboard`, `theme_color: #059669`, `display: standalone`
- SVG icons: 192×192, 512×512, and maskable variants (full-bleed emerald background) in `public/`
- Apple PWA meta tags added to `index.html` (`apple-mobile-web-app-capable`, `apple-touch-icon`, `theme-color`)

**Caching strategy (security-first):**
- Static assets (JS/CSS/fonts/images): `CacheFirst` via Workbox glob patterns
- `/api/*`, `/admin/*`, `/portal/*`, `/dashboard/*`, and all authenticated routes: `NetworkOnly` — **never cached**
- `navigateFallback: null` — no cached HTML fallback for any authenticated page
- Google Fonts: `StaleWhileRevalidate` (stylesheet) + `CacheFirst` (font files, 1-year TTL)

**New components:**
- `src/hooks/use-pwa.ts` — `usePWAInstall()` (install prompt + iOS detection) and `useOfflineStatus()` hooks
- `src/components/offline-banner.tsx` — amber banner displayed when network is unavailable
- `src/components/pwa-install-prompt.tsx` — bottom-sheet install prompt on Chrome/Android; iOS share-sheet instructions on Safari

**Settings → App & Notifications tab (new):**
- Shows install prompt / installed status / iOS instructions
- Push notification placeholder (Firebase Cloud Messaging — coming soon)
- Required future env vars documented: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_VAPID_KEY`

**Tech page (`/tech`) improvements:**
- Service address displayed on each job card with **Open in Maps** link (Google Maps)
- **Tap-to-call** link for customer phone number
- `CompletionModal` replaces `window.prompt` for completion notes — proper textarea modal
- Offline indicator banner specific to the technician view

**Remaining limitations:**
- Icons are SVG — most modern browsers support SVG PWA icons; if Lighthouse flags it, convert to PNG with `sharp`
- iOS does not auto-prompt for installation — users must use Safari share sheet manually
- Push notifications not yet wired — requires Firebase project setup
- A native iOS/Android app (Expo/React Native) remains the longer-term goal for field crews; this PWA closes the gap at low cost
