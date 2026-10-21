# GreenSynk
## Product, Workflows & Technical Reference

Prepared October 21, 2026 • Codebase documentation snapshot

GreenSynk is a multi-tenant subscription platform for lawn care, landscaping, and outdoor service businesses. This guide explains the product, operating workflows, roles, commercial model, data structures, integrations, and implementation boundaries.

**Document status:** Updated reference based on the current workspace implementation. This is not a security certification, a production acceptance test, a legal opinion, or a promise that every configured integration is currently delivering.

**Audience:** Founders, operators, product managers, developers, support teams, implementation partners, and business stakeholders.

**Documentation lineage:** An earlier comprehensive document exists at `GREENSYNK_OVERVIEW.md`. It was last updated in June 2026 and is preserved unchanged. This guide supersedes that document where they disagree, particularly on the database, React version, verification flow, plan eligibility, API paths, and background processing.

**Confidentiality:** Internal product and engineering reference. No passwords, API credentials, payment secrets, customer records, or demo-account credentials are included.

## Contents

1. Executive product overview
2. Users, roles, and access boundaries
3. Commercial model, subscriptions, and limits
4. Feature and screen specifications
5. End-to-end business workflows
6. Status models and business rules
7. Notifications, communications, and consent
8. Platform administration
9. System architecture and technology
10. Data model and relationships
11. APIs and integration contracts
12. Payments and financial safeguards
13. Security, privacy, and operational controls
14. Background jobs and reliability
15. Mobile, PWA, and App Store considerations
16. Development, testing, and release operations
17. Implementation boundaries and known caveats
18. Operating checklists and acceptance scenarios
19. Glossary and source references
20. Generated API and schema appendices

## 1. Executive product overview

### 1.1 Purpose and positioning

GreenSynk combines customer management, scheduling, field execution, estimating, invoicing, payment collection, recurring services, communications, and reporting in one company workspace. Its core use case is a service business that needs to track a customer from initial request through completed work and payment.

The product serves both solo operators and growing crews. Starter emphasizes the core operating workflow; Growth adds coordination, routes, field evidence, recurring work, and communications; Pro adds lead management, advanced rule-based automation, AI-assisted estimating, exports, and saved-card charging.

GreenSynk also includes customer-facing pages and a separate platform administration console. The landscaping company is a tenant; the homeowner is that tenant's customer; the GreenSynk operator administers the SaaS platform. These identities must not be conflated.

### 1.2 Product surfaces

| Surface | Primary purpose | Typical users |
| --- | --- | --- |
| Marketing website | Explain the service, plans, policies, and contact options | Prospects |
| Company application | Run customer, schedule, service, and financial operations | Owners, company admins, staff |
| Public booking page | Receive service requests without company-user login | New and existing customers |
| Customer portal | View personal records, request visits, review estimates, and pay invoices | Homeowners and commercial clients |
| Public estimate signing | Review and accept an individual estimate using a secure link | Estimate recipients |
| Public reviews | Submit feedback and view appropriate review content | Customers and visitors |
| Platform console | Manage tenant accounts, billing visibility, admins, and platform controls | GreenSynk operators |

### 1.3 Primary operating lifecycle

Inquiry or booking request → customer and property → estimate, if needed → scheduled appointment → field service → invoice → payment → receipt → review or follow-up → recurring relationship.

This is a business lifecycle, not one indivisible automated transaction. Several handoffs require an explicit action: confirming a requested visit, reviewing an AI draft, creating an invoice, recording an offline payment, or configuring an automation rule.

### 1.4 Scope exclusions

Do not describe the current application as a full accounting, payroll, inventory, fleet telematics, or enterprise dispatch suite. Continuous background GPS, full offline record editing, a complete public developer API program, and store-native applications are not established merely by the current web implementation.

## 2. Users, roles, and access boundaries

### 2.1 Tenant model

A company is the organizational boundary. Company users belong to a company, and operational records carry a company association. Requests derive tenant identity from authentication rather than trusting a client-supplied company ID.

The intended model is strict separation between tenants. Tenant-scoped reads, related-record checks, role gates, and dedicated access tests support that model. This document does not assert that every route has passed a fresh independent isolation audit.

### 2.2 Role matrix

| Identity | Main responsibilities | Important restrictions |
| --- | --- | --- |
| Company owner | Company setup, subscriptions, team, operations, finance | Limited to their company; owner-only team removal exists |
| Company admin | Day-to-day management, financial and coordination screens | Not a platform admin; some owner-only operations remain restricted |
| Company staff | Shared operational records, assigned jobs, and assigned lead work | Manager-only screens blocked; cannot create, delete, reassign, or reschedule appointments through the staff update path |
| Customer portal user | Their own appointments, invoices, estimates, and preferences | No access to the company-wide CRM or another customer's records |
| Platform admin | Cross-company account administration and platform controls | Separate login, token, and admin permissions |
| Public visitor | Booking, policy pages, reviews, or token-scoped signing | No general authenticated company access |

### 2.3 Access is evaluated in multiple layers

1. Authentication determines the user and token context.
2. Tenant scoping limits which records are addressed.
3. Role checks distinguish management and staff operations.
4. Feature checks compare the subscription tier to the requested capability.
5. Usage checks enforce applicable resource limits.
6. Subscription checks restrict writes on protected routes when billing or trial conditions require it.
7. Record-specific checks apply ownership and assignment rules.

Navigation visibility is not authorization. Frontend route guards and sidebar badges improve usability, but the backend must independently authorize each operation.

### 2.4 Authentication contexts

Company users, platform admins, customer portal users, and public links use distinct contexts. Company and admin JWTs have separate token types and signing configuration. Portal JWTs use a portal-specific derivation and payload type.

Current token durations are seven days for company users, four hours for platform admins, and thirty days for portal sessions. Company tokens issued before a recorded password change are rejected when that check succeeds. Equivalent revocation behavior must not be assumed for every token type.

Company-user login accepts an email or a unique normalized phone number. Email verification is required before company-user login succeeds.

## 3. Commercial model, subscriptions, and limits

### 3.1 Baseline catalog

| Plan | Built-in monthly price | Users | Customers | Appointments/month | Estimates/month | Invoices/month |
| --- | --- | --- | --- | --- | --- | --- |
| Starter | $49 | 1 | 50 | 100 | 10 | 25 |
| Growth | $99 | 5 | 250 | 500 | 100 | 250 |
| Pro | $199 | Unlimited | Unlimited | Unlimited | Unlimited | Unlimited |

These are built-in application defaults, not a contractual quote or a live Stripe price verification. The database-backed catalog is used for displayed plan details and numeric limits, with defaults as fallback. Stripe product and price configuration is separate.

Monthly appointment, estimate, and invoice usage is counted by record creation date in the application's current-month range, not by the appointment service date or invoice due date. Customer usage counts existing customer rows; user usage counts active users. The wording "active customers" in the catalog should not be interpreted as a separate customer-status filter.

### 3.2 Feature distribution

| Capability group | Current baseline availability |
| --- | --- |
| CRM, properties, services, scheduling, basic tracking, invoices, payment collection, public booking, email reminders, portal, dashboard, settings | Starter and above |
| Team management, routes, recurring plans, SMS, review requests, before/after photos, GPS events, Growth reporting, notes/tags entitlement, communication timeline, follow-up campaigns, branded booking | Growth and above |
| AI estimate drafting, lead pipeline, advanced automations, CSV exports, autopay, white-label booking | Pro |
| Forecasting, custom dashboards, general API access, custom intake, additional AI scoring/suggestion labels | Listed in the Pro feature map; complete user-facing workflows not established by this review |

Manual estimating is not globally Growth-gated in the current API. Starter has an estimate quota. The AI draft endpoint is separately Pro-gated. The customer portal is included in the Starter feature map, unlike older documentation.

Advanced automations are Pro-gated in the backend. A Growth badge still appears for Automations in navigation; treat the backend entitlement as authoritative until the display is aligned.

### 3.3 Registration and trial

Registration collects owner identity, company name, strong password, optional phone, and selected tier. It creates the company and owner, starts a fourteen-day trial on the selected plan, and sends an email confirmation link. If no plan is provided, the API defaults to Growth.

Registration does not return a company-user session token. The owner confirms their email, receives the welcome message, and then signs in. Verification links expire after twenty-four hours. Resend confirmation uses a generic response and an in-process per-address throttle.

### 3.4 Subscription lifecycle

Trialing → Stripe checkout → confirmed subscription events → active subscription.

Billing management also supports subscription portal access, usage summaries, plan change checks, and cancellation-related state. Downgrade checks compare current resource usage against the target plan's numeric limits.

The subscription middleware allows GET requests, and blocks protected writes when a trial has expired, the subscription is canceled, or a past-due account exceeds its seven-day grace period measured from the current billing period end. It returns HTTP 402 with a subscription-required error.

This is not a blanket guarantee that every mutation uses that middleware. See the implementation caveats. Billing access remains necessary so users can resolve payment issues.

## 4. Feature and screen specifications

### 4.1 Dashboard and activity

The company dashboard summarizes today's appointments, upcoming visits, recent customers, current-month revenue, unpaid invoice count and value, recurring job count, total customers, and pending review requests.

The activity stream records actions with company, actor, entity, time, and metadata. It supports filtering, unread indicators, and marking activity as seen. Activity is an operational audit trail, not a substitute for a reconciled accounting ledger or guaranteed tamper-proof archive.

### 4.2 Customers and properties

The CRM supports customer creation, search, listing, detail, editing, and deletion. Records hold contact data, address, notes, source, tags, portal setup information, payment references, and communication preferences.

The customer API requires a phone value of seven to thirty characters; names can be empty and email is optional. A service address supplied during customer creation is mirrored into a property. Updating the customer's primary address synchronizes the oldest property or creates one if needed.

Customer detail combines profile, properties, recent appointments, and recent invoices. A property represents a service location and can contain address, yard/access information, and coordinates where available.

Deleting a record is not equivalent to archiving it. Referential constraints and operational history can affect removal. Establish a retention policy before routine production deletion.

### 4.3 Service catalog

Services contain a name, description, category, duration in minutes, base price, and active flag. The catalog is used during scheduling, public booking, portal booking, and AI-assisted estimating.

An inactive service should not be offered as a new public or portal booking choice. Catalog pricing is a baseline; the actual appointment, estimate, or invoice can carry its own amount.

### 4.4 Appointments, calendar, and technician view

Appointments associate a company and customer with optional property, service, assigned user, start/end times, price, public notes, internal notes, status, and completion information.

The list and calendar provide complementary ways to review the schedule. New customer-originated requests produce an unread indicator. Opening the relevant workflow can mark requests as seen.

Technician-facing work includes assigned appointments, status progression, completion notes, and eligible field evidence. Growth-tier additions include check-in/start/tracking events and before/after photos.

GPS tracking here means location-bearing job events, including coordinates and optional accuracy/notes. Do not describe it as continuous background vehicle or employee tracking.

### 4.5 Estimates

Estimates hold a customer, optional property, number, status, validity date, notes, itemized amounts, and signing details. The application supports create, list, detail, edit, delete, PDF generation, and sending a signature link.

A recipient can open a token-scoped signing page and provide their name and signature. The intended result is recorded acceptance information. However, the inspected signing handler looks up the hashed public token and then updates using the raw token, a probable defect that can prevent acceptance from being saved. Treat estimate signing as implemented but requiring correction and end-to-end verification, not as certified working. Legal enforceability and jurisdiction-specific signature requirements are outside this implementation description.

The Pro AI estimator accepts a job description, optional property size and service selection, and the company's catalog. It returns draft line items and notes. Catalog matching constrains supported services and prefers catalog prices. The response identifies an AI or fallback/mock source. A fallback is used when configuration, provider output, or generation fails; human review is required in either case.

### 4.6 Invoices and collections

Invoices support itemized descriptions, quantities, unit prices, totals, tax, due date, status, customer, optional appointment, payment method, payment note, paid timestamp, PDF output, and Stripe references.

Managers can create manually, derive invoice input from an appointment, send an invoice, view/download its PDF, or record an offline payment. The appointment helper returns invoice-ready data; do not assume opening it alone creates the invoice.

Invoice sending is delivery-gated: an invoice is not promoted to sent simply because a send was requested. Manual send reports failure when delivery does not succeed.

Portal users can view their invoices, obtain applicable PDFs/receipts, and initiate payment where the business has configured collection. Pro adds stored-card setup, customer autopay settings, a charge operation, and reminder tools.

### 4.7 Recurring service plans

Recurring plans associate customer, property, service, frequency, interval, next run date, active status, and price. Supported interval calculation includes weekly, biweekly, monthly, quarterly, and custom day intervals.

The generator materializes pending appointments fourteen days ahead, with a safety cap of twelve iterations per plan per run. It checks for an appointment at the same company/customer/start time before insertion and advances the next run timestamp.

A recurring plan is not a recurring Stripe subscription. Its autopay flag alone does not prove a fully automatic charge pipeline.

### 4.8 Routes

Managers can create a dated route, assign it, add or remove appointment stops, inspect stops, optimize order, and send an on-my-way notification.

The implemented optimization is a nearest-neighbor heuristic based on available property coordinates. It requires enough geocoded stops and returns an explicit non-optimized result when coordinates are insufficient.

This is not a traffic-aware navigation engine, a globally optimal route solver, or a guarantee of travel time. Operators should review the stop order and use appropriate navigation tools for actual driving.

### 4.9 Leads

The Pro lead pipeline supports contact details, source, status, estimated value, assignment, notes, follow-up date, lost reason, and links to customer/property records.

Lead sources include manual, referral, website, phone, public booking, and other. Statuses are new, contacted, site visit scheduled, estimate sent, won, and lost. Managers create, assign, delete, convert to customers, and create estimates from leads. Staff access is restricted by assignment and allowed fields.

Public booking can also create a lead when the company has the lead-pipeline feature. This does not mean the booking request is only a lead: the public workflow also manages customer/property and appointment records.

### 4.10 Reviews, communications, follow-ups, and automations

Review tooling sends requests and allows feedback collection, moderation/visibility management, and public review surfaces. A configured external review URL can form part of the request.

The communication timeline records email/SMS events and relevant previews or metadata. Follow-up campaigns add delayed messages and per-recipient execution logs. Advanced automations add trigger/action rules. Their actual wiring is detailed later; a selectable label is not proof that all lifecycle events enqueue it.

### 4.11 Reporting and export

Growth reporting exposes financial and operating summaries calculated from stored operational records, including invoice and customer-related measures. Pro CSV export covers customers, appointments, and invoices.

Customer and appointment exports share filtering logic with their corresponding lists. Reports are not audited financial statements. Confirm date filters, paid/unpaid definitions, time zones, and invoice-aging semantics before using numbers for accounting decisions.

### 4.12 Settings and billing

Company settings include identity, contact details, address, website, time zone, logo, primary color, review URL, and payment instructions. Payment configuration includes supported offline-method instructions and Stripe connection status.

Banking or payment handles shown as instructions are not proof of automated reconciliation. The business generally records externally received payments itself.

## 5. End-to-end business workflows

### 5.1 New company onboarding

1. Choose a plan and submit owner/company information.
2. Meet the password policy: at least eight characters with upper/lowercase letters, a digit, and a special character.
3. Open the confirmation email before the link expires.
4. Sign in with the verified email or an eligible unique phone identifier.
5. Review company identity, time zone, contact and payment settings.
6. Add active services with useful durations and prices.
7. Add customers and service addresses.
8. Invite eligible staff if the plan allows multiple users.
9. Configure booking, portal communication, and payment collection.
10. Subscribe before the trial expires to retain protected write access.

Expected result: a configured tenant with a verified owner and usable service catalog. Registration alone does not confirm successful delivery of every downstream email.

### 5.2 Public service request

1. A visitor opens the company's `/book/:slug` page.
2. The application loads an active company and its active services.
3. The visitor submits contact, property, service, preferred date, notes, and optional SMS consent.
4. The server validates the service/company relationship and requested date.
5. It normalizes submitter identity and performs customer lookup/creation and pending-request admission inside a locked transaction.
6. It creates the property and a pending appointment marked with portal-request origin.
7. If eligible, it creates a lead and enqueues the wired lead-created follow-up event.
8. Notifications inform the company and submitter as configured.
9. The business reviews and confirms or changes the request.

The preferred date is a request, not a guaranteed real-time availability reservation. Both public and portal booking cap open pending requests at five per scoped submitter/customer identity. Rate limiting is an additional control, not the same cap.

### 5.3 Customer creation and portal invitation

1. A company user enters the customer's contact information and optional service address.
2. The server creates the tenant-scoped customer and mirrors the address into a property.
3. Portal invitation logic creates an expiring hashed invitation token.
4. The customer opens the set-password link and completes portal setup.
5. Alternatively, the customer requests a one-time email sign-in link.
6. The customer accesses only their own records within the selected company portal.

The generic portal login hub can locate matching company portals by customer email. A customer with multiple companies chooses the appropriate portal.

### 5.4 Lead to estimate

1. A manager creates or reviews a lead and assigns responsibility.
2. The assignee contacts the prospect and updates pipeline stage and follow-up date.
3. A manager converts the lead into a customer when appropriate.
4. A manager creates an estimate from the lead/customer context.
5. An eligible Pro user may request an AI draft.
6. The operator checks scope, quantities, prices, tax, validity, and terms.
7. The business sends the estimate for signature.
8. The customer opens the signing link, reviews it, and attempts acceptance if appropriate. The current token mismatch noted in section 4.5 must be resolved and verified before relying on this step.
9. The business schedules the work; acceptance should not be assumed to book an appointment automatically.

### 5.5 Schedule to completed service

1. A manager creates or confirms an appointment and selects customer, property, service, time, and assignee.
2. The calendar and appointment list reflect the job.
3. The assigned worker reviews the job and access notes.
4. Eligible users check in and start the job with permitted location information.
5. Before/after photos are attached where the tier allows them.
6. The worker records completion notes and completes the appointment.
7. Status notifications and configured completion rules may run.
8. A manager reviews completion evidence and invoices the customer.

A staff member's update path strips assignment, scheduling, customer/property/service selection, and price changes. Staff can progress their own assigned work without gaining scheduling management rights.

### 5.6 Customer-requested changes

1. The customer opens their appointment list in the portal.
2. A portal-originated pending or confirmed request can be canceled.
3. Company-originated visits, including recurring-generated visits, direct the customer to contact the business instead.
4. The server enforces this origin rule independently of the UI.
5. A successful portal cancellation notifies the company; the owner email is used as fallback when the company's notification address is missing.

### 5.7 Invoice to payment and receipt

1. A manager creates an invoice manually or from appointment-derived data.
2. The server calculates totals from supplied line items when present and allocates a company-scoped number.
3. The manager sends the invoice; successful email delivery determines sent status.
4. The customer opens their invoice in the portal.
5. For online payment, Stripe checkout is initiated using the configured collection path.
6. Signed webhook processing and/or the confirmation path reconcile the invoice.
7. A real transition to paid triggers the appropriate receipt and company notification.
8. For cash, check, or another offline method, a manager records payment and method details.

Offline mark-paid records an administrative payment assertion; it does not itself charge a card or independently verify an external transfer.

### 5.8 Saved card and Pro charging

1. Set up the customer's Stripe customer/payment method through the application's setup flow.
2. Save the payment method reference and explicitly enable the relevant customer setting.
3. Invoke the invoice charge operation when authorized by the business process.
4. The server claims the invoice as processing and creates/confirms the Stripe payment intent.
5. Success records paid state and dispatches receipt/owner notification.
6. Failure restores an appropriate state only if the operation still owns the claim.
7. A recovery sweep examines invoices left processing after an interrupted attempt.

This is the implemented charge workflow. A customer toggle, recurring-plan flag, or feature name must not be marketed as proof that every future invoice is automatically charged on schedule.

### 5.9 Recurring maintenance

1. A manager creates an active recurring plan with next run date, frequency, service, and price.
2. The generator creates pending visits within the fourteen-day horizon.
3. The business reviews assignments, times, and route placement.
4. Staff complete each visit.
5. Invoicing is performed manually or through an explicitly configured automation.
6. Pausing the recurring plan stops future generation; existing generated appointments should be reviewed separately rather than assumed canceled.

### 5.10 Reviews and retention

1. Complete the service and confirm the customer contact details and consent.
2. Send a review request manually or through a configured action.
3. The customer follows the review link and submits feedback.
4. Managers review the resulting content and visibility.
5. Use the communication timeline and follow-up logs to inspect what the system attempted.
6. Record any manual follow-up and schedule the next appropriate service.

## 6. Status models and business rules

### 6.1 Status vocabularies

| Record | Important states or markers | Interpretation |
| --- | --- | --- |
| Appointment | pending, confirmed, in_progress, completed, cancelled, no_show | Service progression; origin is a separate field |
| Lead | new, contacted, site_visit_scheduled, estimate_sent, won, lost | Sales progression |
| Invoice | draft, sent, overdue, processing, paid and route-supported other values | Processing is a payment claim, not final settlement |
| Estimate | draft and route/UI-supported sent or acceptance states; signing metadata | Signature acceptance and status must be interpreted together |
| Follow-up execution | pending, processing, sent, skipped, failed, cancelled | Delivery processing and suppression outcomes |
| Subscription | trialing, active, past_due, canceled and Stripe-derived values | Access and billing state |

Some state columns are text fields rather than database enums. Not every status vocabulary is enforced identically across every write path. These are operational descriptions, not a formal guarantee of a fully constrained state machine.

### 6.2 Data and time rules

- Appointment creation expects an ISO datetime; portal/public requests validate usable future dates.
- Service duration, scheduled duration, and actual tracked duration are different concepts.
- Company time zone is stored, but individual date formatting and month boundaries should be validated before claims of uniform tenant-local time behavior.
- Financial amounts are stored as fixed-precision numeric fields; Stripe uses smallest-unit amounts at its boundary.
- Quantity multiplied by unit price determines a line amount. Invoice totals are recalculated when line items are supplied.
- Invoice numbers are unique within a company, supported by a database constraint and retry allocation logic.
- A paid invoice is not equivalent to a paid GreenSynk subscription: these represent separate financial relationships.

## 7. Notifications, communications, and consent

### 7.1 Email

The current notification code uses Resend for transactional email, with GreenSynk sender configuration and tenant branding where applicable. An installed SendGrid connection exists in the workspace, but installation alone does not mean current application mail is sent through it.

Email workflows include account confirmation, welcome, recovery/security notices, team invitations, portal access, appointment updates, estimates, invoices, receipts, owner payment notices, follow-ups, reviews, and relevant operational alerts.

The email helper exposes delivery outcome information. Important invoice send paths consume that result. Other communication logs may reflect an attempted send or provider acceptance rather than confirmed inbox delivery. A successful HTTP request from a business workflow does not prove that an email arrived.

### 7.2 SMS

Twilio is the SMS integration. SMS access generally depends on tier, sender configuration, recipient data, opt-in/out state, and category preferences.

Consent data includes opt-in/out timestamps, source, reason, and an event history. Portal customers can manage appointment, estimate, invoice, and service-update categories. The inbound webhook handles consent-related keywords, including opt-out and help behavior, with provider-request validation.

Public consent pages include `/sms`, `/sms-policy`, and `/sms-opt-in`. Registration and booking consent should remain visible before payment decisions and should never be interpreted as mandatory service consent.

Consent-aware sending is present, but some lead/test or direct-send paths use lower-level sending. Do not make a blanket legal-compliance claim without reviewing every live sender path and the business's actual policies.

### 7.3 Advanced rule-based automation

Pro rules have a name, trigger, action, configuration JSON, and active flag. Supported action implementations include sending a review request, follow-up email, SMS reminder, or creating an invoice.

Observed trigger wiring includes customer created, appointment completed, upcoming appointment within the reminder window, invoice sent, and invoice overdue on applicable update paths. A test endpoint previews rule execution eligibility. Unknown action strings can be skipped by the engine.

The engine is not a general visual workflow designer or durable multi-step orchestration platform. Several events execute asynchronously; delivery and retry guarantees differ from the synchronous core operation.

### 7.4 Delayed follow-up campaigns

Growth campaigns hold a trigger type, channel, delay in hours, subject/template, and active flag. Pending logs become due at creation time plus the campaign delay. The worker claims pending rows before sending and records a result.

Recognized campaign trigger labels include lead created, estimate sent, appointment completed, and invoice sent. This review found explicit enqueue calls for lead-created flows; the other recognized labels must not be assumed operational until their lifecycle hooks are wired and tested.

Templates support fields such as first name, last name, and full name. Missing contact information, opt-outs, or missing/inactive campaigns affect execution. A campaign can exist successfully without any event having enqueued recipients.

## 8. Platform administration

### 8.1 Administrative surfaces

The separate admin console provides platform metrics, revenue visibility, company listing and detail, account provisioning, company information updates, suspension/reactivation, plan controls, trial extension, internal notes, user support actions, activity history, beta-readiness indicators, platform-admin management, settings, and SMS compliance visibility.

Company support actions include adding a user, toggling or deleting a company user, and owner-password reset support. Admin access to tenant account metadata is different from a full tenant-user impersonation or complete customer-editing workflow.

### 8.2 Subscription integrity

Administrative plan/status changes should not convert an actively Stripe-paying tenant into a fake trial or unpaid state. Trial-extension behavior protects active billing status. Manual operational controls do not replace Stripe subscription lifecycle management.

### 8.3 Stale-admin controls

Platform settings include a configurable stale-admin threshold and scheduler enablement. A persisted due check and PostgreSQL advisory lock coordinate the stale-admin sweep. The baseline cadence is daily, with a ninety-day default threshold.

Runs and outcomes are visible through administrative history. Sweep-health monitoring records stale conditions and alert/recovery information. This is an operational control, not a complete identity-governance program.

### 8.4 Demo seeding

The admin seed endpoint is explicitly disabled in production. Use synthetic records and a separately managed account for review/demo access; do not re-enable unrestricted production seeding. Keep credentials outside documentation and source control.

## 9. System architecture and technology

### 9.1 Logical architecture

Browser/PWA → React application → authenticated `/api` requests → Express routes and business helpers → Drizzle/PostgreSQL.

External branches connect the API to Stripe for financial operations, Resend for email, Twilio for SMS, object storage for uploaded media, and the configured OpenAI-compatible integration for estimate drafting.

Stripe webhooks enter through signature-verified public routes. Public booking, estimate links, and reviews expose narrowly scoped unauthenticated operations. Customer portal endpoints use their own token context.

### 9.2 Current stack

| Layer | Implementation |
| --- | --- |
| Language/runtime | TypeScript, Node.js 24 runtime/tooling family |
| Workspace | pnpm monorepo |
| Frontend | React 19.1, Vite 7.3, Wouter |
| Query/cache | TanStack React Query; generated hooks plus hand-written fetch calls |
| UI | Tailwind CSS 4, Radix/shadcn-style components, Lucide icons |
| Forms/validation | React Hook Form, Zod |
| Motion/report UI | Framer Motion, Recharts where used |
| API | Express 5 |
| Database | PostgreSQL through `DATABASE_URL`, Drizzle ORM |
| Authentication | bcryptjs and jsonwebtoken |
| PDFs | PDFKit |
| Server build | esbuild |
| Contract generation | OpenAPI and Orval into shared React client and Zod packages |
| Logging/security middleware | Pino, pino-http, Helmet, CORS |
| PWA | vite-plugin-pwa and Workbox |

Exact installed patch versions can change with the lockfile. The project uses Replit-managed PostgreSQL, not the retired Neon connection described in the old overview.

### 9.3 Workspace structure

| Location | Responsibility |
| --- | --- |
| `artifacts/lawn-saas` | Main GreenSynk application, public pages, portals, admin UI |
| `artifacts/api-server` | API routes, integrations, PDF generation, workers, tests |
| `lib/db` | Shared database client, schema, insert schemas/types |
| `lib/api-spec` | API specification and code generation configuration |
| `lib/api-client-react` | Generated typed client/hooks |
| `lib/api-zod` | Generated API validation package |
| `artifacts/mockup-sandbox` | Isolated design/component previews, not core product data |
| `artifacts/greensynk-ad` | Marketing video artifact, not the operational application |

The frontend includes marketing prerender/server-rendering tooling alongside client-side application routes. The API and frontend are separately managed services; neither should hardcode a browser-visible localhost backend address.

## 10. Data model and relationships

### 10.1 Principal relationships

Company → users, customers, properties, services, appointments, invoices, estimates, recurring plans, routes, leads, communications, campaigns, and audit activity.

Customer → properties, appointments, invoices, estimates, recurring plans, and portal/payment references.

Appointment → optional property, service, assigned user, job-tracking events, photos, and related invoice.

Invoice → invoice line items; estimate → estimate line items; route → route stops; campaign → follow-up execution logs.

Some related IDs are plain integer columns rather than database-level foreign keys. Company scoping and related-record validation must therefore be enforced in route logic as well as schema constraints.

### 10.2 Entity groups

| Group | Stored entities | Purpose |
| --- | --- | --- |
| Tenant and identity | companies, users | Business identity, role, account, subscription references |
| CRM and selling | customers, properties, services, leads | Contact, location, service and opportunity data |
| Delivery | appointments, recurring_plans, routes, route_stops | Work planning and service delivery |
| Field evidence | job_tracking_events, appointment_photos | Location/time events and work images |
| Financial documents | invoices, invoice_line_items, estimates, estimate_line_items | Itemized billing and quoting |
| Customer engagement | review_requests, reviews, communication_events | Requests, feedback, communication history |
| Automation | automation_rules, follow_up_campaigns, follow_up_logs | Rules and delayed message execution |
| Governance | activity_logs, sms_consent_events | Activity and consent history |
| Platform | platform_admins, platform_settings, plans | SaaS operator controls and catalog |

There are twenty-seven application table declarations in the inspected schema directory. A generated field reference is included in the appendices. It describes schema declarations, not a production data export.

### 10.3 Sensitive information

Sensitive fields include contact/address details, access notes, signatures, photos, location events, password hashes, reset/invitation hashes, and Stripe customer/payment references. Exports and logs can also contain personal data.

Raw payment card data should remain with Stripe-managed collection components; the app stores provider references rather than a local card vault. Uploaded evidence should use authenticated tenant-scoped reads where private.

## 11. APIs and integration contracts

### 11.1 API organization

The Express application mounts its routes under `/api`. Main groups cover auth, dashboard, customers, properties, services, appointments, recurring plans, invoices, estimates, routes, reviews, automation, team, settings, billing, portal, leads, reporting, export, communications, follow-ups, storage, consent, and platform administration.

Company endpoints typically use `Authorization: Bearer ...`. Admin and portal calls require their own token contexts. A company token is not a portal token, even if both are sent in the same HTTP header.

### 11.2 Important endpoint examples

| Method/path | Purpose |
| --- | --- |
| `POST /api/auth/register` | Register company/owner and start verification |
| `POST /api/auth/verify-email` | Consume email confirmation |
| `POST /api/auth/login` | Company-user authentication |
| `GET /api/auth/me` | Current user and company |
| `GET /api/dashboard` | Company summary |
| `GET/POST /api/customers` | Search/list or create customers |
| `POST /api/appointments/:id/complete` | Complete an assigned/authorized job |
| `POST /api/estimates/ai-draft` | Pro draft generation |
| `POST /api/estimates/:id/send-for-signature` | Send signature link |
| `POST /api/invoices/:id/send` | Deliver invoice |
| `POST /api/invoices/:id/mark-paid` | Record payment manually |
| `POST /api/public/book/:slug/submit` | Public service request |
| `POST /api/portal/appointments` | Customer request |
| `POST /api/portal/appointments/:id/cancel` | Eligible request cancellation |
| `POST /api/billing/subscribe` | Start subscription checkout |
| `POST /api/billing/webhook` | Primary signed Stripe event endpoint |
| `POST /api/autopay/invoices/:id/charge` | Saved-method invoice charge |

The full handler inventory in Appendix A is generated from route declarations. It is a navigation aid, not a published external API guarantee or a complete OpenAPI contract. Some webhook and inline-auth paths require inspecting the handler body to understand authorization.

### 11.3 Error conventions

| Status | Common meaning |
| --- | --- |
| 400 | Invalid input, invalid token, or disallowed record state |
| 401 | Missing, invalid, expired, or invalidated authentication |
| 402 | Subscription action required on protected writes |
| 403 | Role, plan, record ownership, or capacity restriction |
| 404 | Missing or deliberately unavailable resource |
| 409 | Conflict such as duplicate registration identity |
| 429 | Rate or admission cap reached where implemented |
| 502 | Upstream delivery failure on relevant send paths |
| 500 | Unexpected internal failure |

Not every endpoint uses identical error payloads. Clients should handle non-success responses explicitly rather than assume a resolved fetch means a successful operation.

## 12. Payments and financial safeguards

### 12.1 Separate financial relationships

1. A lawn care company pays GreenSynk for a SaaS subscription.
2. A homeowner pays the lawn care company for service.

The application maintains both flows. Stripe customer/subscription references for the tenant do not identify a homeowner's stored payment method.

### 12.2 Stripe connection and collection

The business can inspect Stripe Connect status, begin onboarding, and obtain a connected-account dashboard link. Portal payment depends on its configured connected-account collection path.

The current Pro saved-card charge implementation uses the platform Stripe context rather than the same Connect flow. This is an important implementation distinction for funds routing, reconciliation, merchant-of-record expectations, and payment-method compatibility. Review it with the business before representing both paths as identical.

Stripe account mode and price IDs must match the configured account. Live keys must never be used for automated money-moving tests.

### 12.3 Webhooks and settlement

Webhook verification requires the configured signing secret and raw request body. Missing verification configuration fails closed. Relevant events reconcile tenant subscription state and customer-invoice payment state.

Duplicate Stripe deliveries must not trigger duplicate paid transitions or receipt sends. The payment code uses state-transition guards. Portal confirmation, payment webhooks, manual mark-paid, and saved-card charging all need consistent handling of a genuine transition to paid.

### 12.4 Concurrency and crash recovery

Payment operations claim invoices as processing. Claim ownership is tied to an update token so a delayed failure does not release a newer writer's claim. The recovery sweep checks stale processing invoices and reconciles against Stripe before safely restoring a non-processing state.

Unique company/invoice-number constraints protect numbering. These safeguards reduce specific race conditions; they do not constitute a general double-entry ledger or eliminate every possible cross-path race.

## 13. Security, privacy, and operational controls

### 13.1 Controls present

- Strong-password validation and bcrypt hashing.
- Email verification before self-registered company users can sign in.
- Hashed recovery/invitation tokens in applicable flows.
- Separate company, portal, and platform-admin token contexts.
- Tenant filters and record assignment checks.
- Manager role gates on financial and coordination routes.
- Plan and resource-limit checks.
- Rate limits on sensitive public/authentication operations.
- Transaction-scoped advisory locks for booking admission.
- Stripe signature verification and payment state guards.
- Authenticated private object reads with ownership checks in the current storage route.
- Safer tenant-image fetching for server-generated PDFs.
- Security headers and configured CORS behavior.
- Consent event records and SMS preferences.

### 13.2 Limits of those controls

Some authorization/status checks fail open if their database lookup throws. Rate-limit counters are process-local, so replicas do not share one global counter. Some related-record validations and mutation gates are not uniform.

Company tokens are stored by the frontend in local storage. This makes robust cross-site scripting prevention, dependency hygiene, and token handling important. Logout clears the client session; do not infer server-side revocation of every previously issued JWT.

No claim is made here of MFA, enterprise SSO, SOC 2/ISO certification, penetration-test completion, fixed backup retention, specified recovery objectives, or a contractual uptime SLA.

### 13.3 Privacy and retention considerations

Set explicit retention and deletion policies for contact records, signatures, invoices, activity, consent, photos, and GPS events. Define which data must be retained for legal/accounting reasons and how export or deletion requests are approved.

A GDPR/CCPA request workflow, legally compliant signature policy, or full consent program cannot be inferred from fields alone. Public policy pages should be reviewed against actual data processing and provider arrangements.

## 14. Background jobs and reliability

### 14.1 Observed scheduling

| Job | Nominal cadence | Behavior |
| --- | --- | --- |
| Upcoming appointment automation scan | About every 5 minutes | Finds eligible reminder-window work |
| Pending follow-ups | Every 5 minutes, with startup processing | Claims due logs and records outcomes |
| Recurring appointment generation | Hourly, with startup processing | Fills the next 14 days |
| Processing-invoice recovery | Every 5 minutes, with startup processing | Reconciles stale payment claims |
| Stale platform-admin check | Hourly due check | Persists a daily eligibility decision and coordinates with an advisory lock |
| Sweep-health monitor | Hourly, with delayed startup check | Detects stale sweep health and records alerts/recovery |

Cadences describe in-process scheduling, not a guarantee that a process is always awake. Autoscale suspension, restarts, and overlapping instances must be considered.

### 14.2 Delivery and execution guarantees

Database-backed follow-up rows and payment claim recovery provide more recoverability than a fire-and-forget promise, but they are not equivalent to a dedicated durable job queue with retries, dead letters, and uniform exactly-once semantics.

Critical external I/O should finish before the HTTP response when required for reliability. Some current appointment and automation paths still launch asynchronous side effects. On autoscaling infrastructure, post-response CPU suspension can interrupt them.

Inspect provider logs and recorded outcomes for confirmation. An appointment save, rule create, or test response returning 200 does not prove a customer notification was delivered.

## 15. Mobile, PWA, and App Store considerations

### 15.1 Implemented web behavior

The main application is responsive and includes a PWA manifest, standalone display configuration, application icons, automatic service-worker updates, and static asset caching.

Authenticated API, admin, portal, billing, and sensitive operational navigation are intentionally excluded from offline caching. This avoids treating sensitive tenant data as an offline cache feature.

The PWA should not be marketed as supporting full offline job creation, editing, invoicing, or synchronization. No general offline mutation queue was established in this review.

### 15.2 Native distribution status

App Store screenshots and branding exports exist in the repository, and a dedicated review/demo account has been prepared separately. These assets do not prove that an iOS/Android native project or store-approved binary is part of this workspace.

No Capacitor configuration or iOS/Android project directories were found under the main application during this review. A web wrapper may exist outside this repository; that was not verified.

### 15.3 Release considerations

For a shared web/native strategy, Capacitor can be evaluated where suitable. Store releases still require native build/signing configuration, privacy declarations, permission handling, safe navigation/payment behavior, and working review access.

Verify camera/photo upload and foreground location behavior on real devices. Do not promise native push notifications or background location merely because browser photo/location features exist.

Review accounts must remain usable throughout review. Since the prepared account was trialing when last checked, its access window should be reviewed before resubmission. A permanent demo label alone does not bypass trial enforcement.

## 16. Development, testing, and release operations

### 16.1 Primary commands

| Command | Purpose |
| --- | --- |
| `pnpm --filter @workspace/api-server run dev` | Build and run the API development service |
| `pnpm --filter @workspace/lawn-saas run dev` | Run the main frontend |
| `pnpm --filter @workspace/lawn-saas run build` | Build client, SSR bundle, and prerender output |
| `pnpm --filter @workspace/api-spec run codegen` | Regenerate shared API artifacts |
| `pnpm --filter @workspace/db run push` | Apply intended development schema changes |
| `pnpm run typecheck` | Workspace TypeScript checks |
| `pnpm --filter @workspace/api-server run test:all:ci` | Combined backend validation gate |
| `pnpm --filter @workspace/lawn-saas test` | Frontend Vitest suite |

After changing shared library exports or generated types, rebuild the relevant shared outputs before diagnosing consumer TypeScript export failures. Avoid concurrent CI builds writing into the same output directory.

### 16.2 Environment configuration categories

Required categories include PostgreSQL connectivity, company/admin token secrets, service port/base paths, application-origin settings, Stripe keys/webhook secret, email provider/sender configuration, Twilio sender credentials, storage settings, and optional AI integration configuration.

Examples of configuration names include `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_JWT_SECRET`, `PORT`, `BASE_PATH`, `APP_BASE_URL`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET`. This guide intentionally contains no values. The retired Neon secret is not the application's current connection source.

### 16.3 Database and test safety

Production and development data are separate environments. Tests that mutate tables must use the isolated test database harness and await its initialization before executing database work.

Do not point destructive reset, push-force, or cleanup routines at normal development or production data. Do not use the old overview's Neon connection command.

Tests must suppress real email/SMS. Payment tests must explicitly require test-mode keys before any charge or external money movement. Test-specific mocks and named exports should be maintained with their dependencies.

### 16.4 Build and operations caveats

PDFKit must remain external to the server bundle because its dependency chain does not safely bundle with the existing esbuild configuration. Large public images can exceed the PWA precache limit; avoid placing unnecessary large assets in the public build.

Production schema changes require the supported publish-time schema review, with destructive differences handled deliberately. No schema changes or production data writes were performed while preparing this guide.

### 16.5 Verification scope for this document

The guide was assembled from route declarations, middleware, schema, plan catalog, frontend routing, worker registration, integration helpers, package configuration, and existing project notes.

The preceding demo-account work confirmed access to selected production endpoints at that time. This documentation task did not repeat a full production journey, audit all integrations, run a fresh security assessment, or certify every feature. Current workspace code may differ from the published build.

## 17. Implementation boundaries and known caveats

### 17.1 Product claims requiring care

| Claim | Accurate qualification |
| --- | --- |
| “Everything is automated” | Several handoffs require explicit user actions; asynchronous execution and scheduler reliability vary |
| “Autopay charges every recurring visit” | Stored-card setup/charge paths exist; recurring-plan flags alone do not establish a complete scheduled charge pipeline |
| “GPS tracking” | Job-event coordinates, not verified continuous background tracking |
| “Optimized routes” | Nearest-neighbor ordering using available coordinates, not live traffic or guaranteed optimal routes |
| “AI-powered platform” | AI estimate drafting is implemented; other AI labels need separate implementation verification |
| “Public API access” | Internal HTTP APIs exist; external developer authentication, keys, docs, quotas, and support program are not established |
| “Works offline” | Static PWA caching exists; authenticated offline data/workflows are not established |
| “Compliant” | Technical consent/security measures exist; no blanket regulatory or certification claim is supported |

### 17.2 Observed inconsistencies

1. The old overview names Neon, React 18, immediate welcome-on-registration, and older endpoint paths; current code differs.
2. Automations navigation displays a Growth label while backend advanced automation access requires Pro.
3. Several Pro feature keys are entitlements/labels without a complete verified user-facing workflow.
4. Follow-up trigger labels exceed the explicit lifecycle enqueue hooks located during review.
5. Subscription middleware is not applied uniformly to every write-capable router.
6. Some email/SMS/status logs are not proof of confirmed recipient delivery.
7. Portal JWT revocation after password changes is not equivalent to the company-user token check.
8. Process-local rate limits and interval workers require care under scaling and suspension.
9. Related-record ownership validation and manager/staff field restrictions should continue to be checked route by route.
10. An App Review account left on a normal trial may lose write access during a later review.
11. The public estimate-signing handler selects by hashed token but updates by raw token. This apparent mismatch needs a targeted correction and acceptance-flow test before signing can be represented as working.

These are documentation caveats, not changes made by this task. Resolve them through separately scoped implementation and verification work when appropriate.

## 18. Operating checklists and acceptance scenarios

### 18.1 Company launch checklist

- Verify owner email and successful sign-in.
- Confirm plan, trial end, limits, and subscription billing.
- Set accurate company contact, branding, address, and time zone.
- Configure active services, prices, and useful durations.
- Verify customer/property addresses and access notes.
- Assign the correct roles and test a staff account separately.
- Confirm booking, portal invitation, estimate, invoice, and receipt links resolve to the intended public application.
- Complete Stripe setup and verify funds routing before real collection.
- Test email and SMS only with authorized recipients and appropriate consent.
- Check a representative schedule, invoice PDF, report, and export.

### 18.2 Daily operations checklist

- Review new requests and unread activity.
- Confirm the day's assignments and incomplete jobs.
- Inspect route stop order and missing coordinates.
- Resolve customer changes and cancellations.
- Review completed work, evidence, and unbilled appointments.
- Follow up on unpaid invoices and failed payment attempts.
- Check queued/failed communications and follow-up logs.
- Review recurring visits generated for the near-term horizon.

### 18.3 Platform operator checklist

- Review errors, payment reconciliation, and recovery-sweep health.
- Monitor email/SMS delivery failures and sender/provider status.
- Inspect subscription status drift and failed webhooks.
- Review inactive/stale admin runs and alert history.
- Confirm safe test environment separation.
- Review data retention, storage access, backups, and incident procedures.
- Keep pricing display, entitlement code, catalog, and Stripe configuration aligned.
- Revalidate review accounts before every store submission.

### 18.4 Representative acceptance scenarios

| Scenario | Expected result |
| --- | --- |
| Unverified owner attempts login | Rejected with email-verification guidance |
| Verified owner signs in | Correct tenant identity and authorized screens |
| Staff opens finance page | Manager-only route denied |
| Staff edits another worker's appointment | Access denied |
| Customer attempts to view another customer's invoice | No access |
| Customer cancels company-created visit | Rejected; instructed to contact business |
| Sixth pending request for same scoped identity | Admission rejected without extra request/notification |
| Invoice email delivery fails | Invoice not falsely promoted to sent |
| Same paid webhook arrives again | No duplicate paid transition/receipt |
| Stale payment operation fails after another claim | Newer claim is not released |
| Insufficient route coordinates | Explicit non-optimized outcome |
| AI integration unavailable | Identified fallback draft; operator reviews it |
| Trial expires | Protected writes require subscription action |
| Sensitive portal route visited offline | No claim of cached private portal data |

These scenarios are a maintenance checklist, not a statement that a fresh test run was performed for this document.

## 19. Glossary and source references

### 19.1 Glossary

| Term | Meaning |
| --- | --- |
| Tenant | A lawn care company using GreenSynk |
| Company admin | A manager inside one tenant |
| Platform admin | An operator of GreenSynk itself |
| Customer | The tenant's client, not necessarily a GreenSynk subscriber |
| Property | A customer service location |
| Appointment | A requested or scheduled service visit |
| Recurring plan | A service schedule that generates visits |
| SaaS subscription | The company's recurring payment for GreenSynk |
| Portal | Customer-scoped self-service application |
| Claim token | A guard identifying the operation that owns an invoice processing state |
| Entitlement | Whether a plan grants access to a feature |
| PWA | Installable web application with configured browser/service-worker behavior |

### 19.2 Source hierarchy

1. Current route implementation and middleware for actual backend behavior.
2. Current frontend routing/pages for user-visible workflows.
3. Database schema for storage fields and structural constraints.
4. Plan entitlement map and database-backed catalog for tier behavior and limits.
5. Tests and operations notes for intended safeguards and environment constraints.
6. Existing June overview for historical context only.

### 19.3 Key source locations

| Source | What to consult |
| --- | --- |
| `artifacts/api-server/src/routes/index.ts` | API mounts |
| `artifacts/api-server/src/routes/*.ts` | Endpoint behavior and authorization |
| `artifacts/api-server/src/lib/features.ts` | Entitlements and baseline limits |
| `artifacts/api-server/src/lib/plan-catalog.ts` | Catalog defaults and refresh |
| `artifacts/api-server/src/lib/subscription.ts` | Protected write restrictions |
| `artifacts/api-server/src/lib/auth.ts` | Company/admin JWT and password behavior |
| `artifacts/api-server/src/lib/automations.ts` | Rule actions and reminder scan |
| `artifacts/api-server/src/lib/follow-ups.ts` | Delayed message processing |
| `artifacts/api-server/src/lib/recurring.ts` | Visit generation |
| `artifacts/api-server/src/lib/stuck-invoices.ts` | Interrupted-payment recovery |
| `artifacts/api-server/src/lib/stale-admins.ts` | Stale-admin sweep |
| `artifacts/api-server/src/lib/ai-estimate.ts` | AI draft/fallback behavior |
| `lib/db/src/schema/*.ts` | Database declarations |
| `artifacts/lawn-saas/src/App.tsx` | Frontend routes and global auth/error handling |
| `artifacts/lawn-saas/src/components/layout.tsx` | Navigation and role visibility |
| `artifacts/lawn-saas/vite.config.ts` | Build and PWA behavior |
| `artifacts/api-server/package.json` | Backend scripts and dependencies |
| `artifacts/lawn-saas/package.json` | Frontend scripts and dependencies |
| `SMS_COMPLIANCE.md` | Existing SMS operations reference |

The following appendices are generated directly from current declarations when the downloadable guide is built. They intentionally omit secret values and production records.
