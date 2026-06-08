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
Generate invoices (with itemized line items), send them, and track status (Draft → Sent → Paid). Invoices can be created directly or generated from a completed appointment. When an invoice is created or sent, a **professional invoice email** is automatically dispatched to the customer (including invoice number, due date, itemized line items, total due, and a direct payment link). Customer lookups are scoped by company to prevent cross-tenant disclosure.

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
| `customers` | Client profiles (includes portal password hash, magic-link token) |
| `properties` | Physical service locations, linked to customers |
| `services` | Master list of offered services + base prices/duration |
| `appointments` | Individual work orders (status: pending / confirmed / in_progress / completed / cancelled / no_show) |
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
- `GET /api/public/booking/:slug` — booking page data
- `POST /api/public/booking/:slug` — submit a booking request
- Public estimate view/sign endpoints (tokenized)
- `POST /api/stripe/webhook` — Stripe events

### Customer Portal (portal auth)
- `POST /api/portal/auth/login` — password login (phone or email + password)
- `POST /api/portal/auth/request-link` — request a passwordless magic-link email
- `POST /api/portal/auth/verify-link` — exchange magic-link token for portal session
- `POST /api/portal/auth/set-password` / `forgot-password` / `reset-password`
- View appointments, invoices (pay via Stripe), estimates (sign)

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

| Role | Email | Password |
|------|-------|----------|
| **Platform admin** | `admin@greensynk.com` | `Admin1234!` |

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
