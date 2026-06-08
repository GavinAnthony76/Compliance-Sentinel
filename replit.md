# GreenSync - Lawn Care SaaS Platform

## Overview

Multi-tenant SaaS web application for lawn care businesses. Full-stack application with a React frontend and Express backend, featuring 3-tier subscription plans, complete business management tools, Stripe billing, admin panel, and public booking pages.

## Architecture

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

### Stack
- **Monorepo**: pnpm workspaces
- **Node.js**: v24, TypeScript 5.9
- **API Server**: Express 5 (port via `PORT` env var, default 8080)
- **Frontend**: React 18 + Vite, Wouter routing, TanStack React Query, Tailwind CSS + shadcn/ui
- **Database**: PostgreSQL + Drizzle ORM
- **Auth**: bcryptjs + JWT (jsonwebtoken)
- **Billing**: Stripe (via Replit Stripe integration, `getUncachableStripeClient()`)
- **Notifications**: Twilio SMS + Email (mock mode when credentials absent)
- **API Layer**: OpenAPI spec → Orval codegen → typed React hooks + Zod schemas

## Packages

### `artifacts/api-server` - Express Backend
- Port: `PORT` env var (8080 in dev)
- All routes under `/api`
- JWT auth middleware: `authenticate` (company), `authenticateAdmin` (platform admin)

### `artifacts/lawn-saas` - React Frontend
- Vite dev server, `BASE_URL` aware
- Token storage: `greensync_token` (company), `greensync_admin_token` (admin)
- All API calls auto-patched with Authorization header in App.tsx

### `lib/db` - Database Layer
- 14 schema tables: companies, users, customers, properties, services, appointments, invoices, estimates, recurring_plans, routes, review_requests, automations, activity_logs, platform_admins
- `pnpm --filter @workspace/db run push` — apply schema changes

### `lib/api-spec` - OpenAPI + Codegen
- `pnpm --filter @workspace/api-spec run codegen` — regenerate hooks + schemas

## Key Files

| File | Purpose |
|------|---------|
| `artifacts/api-server/src/app.ts` | Express app, raw body for Stripe |
| `artifacts/api-server/src/routes/index.ts` | All routes mounted |
| `artifacts/api-server/src/lib/auth.ts` | JWT + bcrypt middleware |
| `artifacts/api-server/src/lib/stripe.ts` | Stripe client (uncacheable) |
| `artifacts/api-server/src/lib/features.ts` | Plan feature gating |
| `artifacts/api-server/src/lib/notifications.ts` | SMS/email (mock fallback) |
| `lib/db/src/schema/index.ts` | All 14 DB tables |
| `artifacts/lawn-saas/src/App.tsx` | Router + all page imports |
| `artifacts/lawn-saas/src/components/layout.tsx` | AppLayout sidebar |
| `artifacts/lawn-saas/src/hooks/use-auth-state.ts` | Auth hook |

## API Routes

### Company (JWT: greensync_token)
- `POST /api/auth/register` — create company + owner
- `POST /api/auth/login` — returns JWT
- `GET /api/auth/me` — current user + company
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
- `GET /api/billing/status` + `GET /api/billing/plans` + `POST /api/billing/subscribe` + `POST /api/billing/portal`
- `GET /api/activity`

### Public
- `GET /api/public/booking/:slug` — company booking page data
- `POST /api/public/booking/:slug` — submit booking request
- `POST /api/stripe/webhook` — Stripe events

### Platform Admin (JWT: greensync_admin_token)
- `POST /api/admin/auth/login`
- `GET /api/admin/auth/me`
- `GET /api/admin/dashboard`
- `GET /api/admin/companies` + `GET /api/admin/companies/:id`
- `POST /api/admin/companies/:id/suspend` + activate + plan + notes
- `GET /api/admin/admins` + `POST /api/admin/admins`
- `GET /api/admin/activity`
- `POST /api/admin/seed` — seeds demo data

## Frontend Pages

### Public
- `/` — Landing page (marketing)
- `/login` — Company login
- `/register` — 3-step company registration
- `/admin/login` — Platform admin login (dark theme)
- `/book/:slug` — Public customer booking page

### Company Dashboard (auth required)
- `/dashboard` — Stats overview
- `/calendar` — Monthly calendar view with appointments
- `/customers` — Customer management (CRUD)
- `/properties` — Property/location management
- `/services` — Service catalog (CRUD)
- `/appointments` — Job scheduling
- `/invoices` — Billing and invoicing
- `/recurring` — Recurring service plans
- `/estimates` — Quote management
- `/routes` — Daily route planning
- `/reviews` — Customer review requests
- `/automations` — Workflow automation rules
- `/team` — Staff management
- `/settings` — Company profile + branding
- `/billing` — Subscription management (Stripe)

### Admin Panel (admin auth required)
- `/admin/dashboard` — Enhanced platform metrics: MRR, active subs, customers, appointments, plan distribution, recent signups, recent activity feed
- `/admin/billing` — Revenue & billing: MRR by plan with bars, subscription status distribution, monthly signup chart, past-due company management
- `/admin/companies` — All companies with plan + status filters; click to detail
- `/admin/companies/:id` — Company detail: stats row, edit info modal, internal notes, add staff user, reset owner password, toggle/delete users, change plan/status, recent activity
- `/admin/activity` — Platform activity logs with action search + entity type filter (company/user/customer/etc), company names enriched
- `/admin/admins` — Admin user management (create, edit, delete)
- `/admin/settings` — Admin profile settings (name, email, password)

## Plans & Pricing
- **Starter**: $49/mo — solo operators, basic features
- **Growth**: $99/mo — teams, SMS, recurring, routes, estimates, reviews
- **Pro**: $199/mo — everything + automations, advanced analytics

## Demo Credentials
- Company: `alex@greenscapes.com` / `Demo1234!` (Growth plan)
- Admin: `admin@greensync.com` / `Admin1234!`
- Public booking: `/book/greenscapes-demo`

## Demo Data (seeded)
- 6 customers (James Harrison, Maria Santos, David Chen, Rachel Thompson, Tom Williams, Linda Garcia)
- 5 services (Lawn Mowing $65, Fertilization $89, Hedge Trimming $120, Aeration $150, Leaf Removal $175)
- 10 appointments (5 completed, 2 today scheduled, 3 upcoming)
- 6 invoices (3 paid, 2 sent, 1 draft)
- 3 estimates, 3 recurring plans, 3 review requests, 3 automation rules

## Plan Feature Gating
- **review_requests** route requires Growth plan (enforced in backend + sidebar badge)
- Sidebar badges: `Growth` on Recurring, Estimates, Routes, Reviews, Team; `Pro` on Automations
- `PlanGate` component wraps pages to show upgrade wall for insufficient plan
- `requireFeature()` in backend enforces plan gating per route

## Environment Variables
- `DATABASE_URL` — PostgreSQL connection (auto-provided by Replit)
- `JWT_SECRET` — Token signing (auto-generated if absent)
- `SESSION_SECRET` — Session key
- `ADMIN_JWT_SECRET` — Admin token (defaults to `JWT_SECRET + "-admin"`)
- `STRIPE_SECRET_KEY` — Via Replit Stripe integration
- `STRIPE_WEBHOOK_SECRET` — For webhook verification
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` — SMS (optional)
- `EMAIL_PROVIDER_API_KEY` — Email (optional)
- `FRONTEND_URL` — For CORS/redirects

## Parked / Backlog (tabled — revisit later)
- **Admin manages a company's customers**: no platform-admin endpoint or UI exists to add/edit/remove a company's customers on their behalf. Admin can only see customer counts. Would add admin routes (currently customers are `requireAuth` company-only) + admin UI under company detail.
- **Starter plan tag/notes inconsistency**: Add Customer form shows a `tags` field, but `customer_notes_tags` is a Growth-tier feature in `features.ts`. Decide whether to hide tags for Starter users or make it available; align frontend form with backend gating.

## Monorepo Commands
- `pnpm --filter @workspace/api-server run dev` — API server
- `pnpm --filter @workspace/lawn-saas run dev` — Frontend
- `pnpm --filter @workspace/db run push` — Apply schema changes
- `pnpm --filter @workspace/api-spec run codegen` — Regenerate API client
- `pnpm run typecheck` — Full TypeScript check
