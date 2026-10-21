# Database and data safety

## Current source of truth

`lib/db/src/index.ts` creates a pg Pool and Drizzle client using **DATABASE_URL only**. `lib/db/drizzle.config.ts` uses the same variable. Do not reactivate legacy NEON_DATABASE_URL selection. Some historical test-helper comments still mention Neon, and `tests/db-cleanup.mjs` retains a legacy preference; the test guard removes that variable before cleanup.

Schemas are TypeScript definitions in `lib/db/src/schema/`, exported by `index.ts`. There is no checked-in Drizzle migration history or snapshot journal under lib/db at this baseline. The package exposes `push` and `push-force`, not a migration replay system. This is a portability/reproducibility blocker, not permission to invent a migration history.

## Schema map — 27 application tables

| Schema file | Tables | Relationships / preservation contract |
| --- | --- | --- |
| `companies.ts` | companies | Tenant root; plan/trial/billing/Connect/branding/contact settings |
| `users.ts` | users | Company member, credentials, role/active/verification/reset metadata |
| `customers.ts` | customers | Company customer, contact/property context, portal credentials/tokens, saved payment references |
| `properties.ts` | properties | Company and customer references, service location, yard/access notes |
| `services.ts` | services | Company service catalog, prices/duration/active state |
| `appointments.ts` | appointments | Company/customer/service/property/assignment references; schedule, status, origin |
| `recurring-plans.ts` | recurring_plans | Recurrence definition and next-occurrence generation context |
| `invoices.ts` | invoices, invoice_line_items | Company/customer and appointment relationship; child items cascade from invoice |
| `estimates.ts` | estimates, estimate_line_items | Company/customer, line items, hashed public token, signature/acceptance metadata |
| `leads.ts` | leads | Company-owned leads, optional customer link and assigned staff |
| `routes.ts` | routes, route_stops | Company route and company-owned child stops |
| `review-requests.ts` | review_requests | Company/customer review invitation and delivery context |
| `reviews.ts` | reviews | Company review record and public presentation controls |
| `automations.ts` | automation_rules | Company automation configuration |
| `communications.ts` | communication_logs | Company/customer delivery and communication history |
| `follow-ups.ts` | follow_up_campaigns, follow_up_logs | Company campaign and queued/executed follow-up records |
| `appointment-photos.ts` | appointment_photos | Company/appointment, object reference, uploader |
| `job-tracking.ts` | job_tracking_events | Company/appointment field-work events and coordinates |
| `activity-logs.ts` | activity_logs | Business/admin activity, scheduler progress and deduplication markers |
| `platform-admins.ts` | platform_admins | Separate platform operators and inactivity/deactivation metadata |
| `platform-settings.ts` | platform_settings | Singleton platform configuration, not a tenant row |
| `plans.ts` | plans | Shared plan display/limits catalog; feature entitlement code remains separate |
| `sms-consent-events.ts` | sms_consent_events | Consent history and subject association |

Inspect actual field types, nullability, `references`, `onDelete`, and unique constraints in each file before touching a relationship. A generic FK proves existence, not that two related rows belong to the same company.

## Isolation rules

1. Authenticate before company access. Derive companyId from the verified identity.
2. Scope parent reads and writes to the authenticated company. A resource ID alone is insufficient.
3. Validate related IDs belong to the same company before inserting/updating relationships. #220 demonstrates the difference.
4. Child tables without companyId, such as invoice line items, must be accessed through a tenant-checked parent. Other children have their own companyId and still need consistency checks.
5. Portal data must additionally match authenticated customerId; company JWTs must never replace portal Authorization.
6. Platform tables/admin routes intentionally have global scope and need separate admin authorization. Do not apply tenant assumptions to their sweep tests.
7. No PostgreSQL row-level-security policy is defined in the inspected schema files. Do not claim RLS protection; live database policy configuration was not queried.

## Safe test provisioning

Use a new **disposable PostgreSQL server/database** for Claude. Node and pnpm alone are not enough. Provision a user allowed to create the disposable sibling test database if using the current helper.

`artifacts/api-server/tests/test-db-guard.mjs` exports async `useLocalTestDatabase()`. It:

- Requires DATABASE_URL, rejects Neon hosts and a configured legacy production host match.
- Deletes NEON_DATABASE_URL in the child process.
- Derives a sibling database named `<configured_database>_test`, creates it if needed, and redirects DATABASE_URL.
- Is idempotent when the name already ends in `_test`.

**Important:** this naming/host heuristic is not a universal proof of safety. Never provide production credentials or host access to Claude. A database named `_test` on a production server is not acceptable test isolation.

The combined runner awaits the guard before `push-force`; it then uses namespaced fixtures and cleanup. Do not invoke individual e2e files against a normal running development API or run bare push-force on the real development database.

## Schema change procedure

No schema change was made for this handoff. For future work:

1. Inspect the schema diff and existing data/constraint compatibility.
2. Review the exact SQL/Drizzle effect on an isolated copy with synthetic fixtures.
3. Classify additive versus destructive/breaking changes; request approval for breaking/destructive changes.
4. Obtain a verified backup and recovery plan under the human operator’s control.
5. Separate schema review from feature-code review. Do not silently run db push in a PR or production workflow.
6. Apply approved changes to a disposable test database first; verify old data compatibility and application tests.
7. Production application of schema changes requires human review through the approved Replit process.

`pnpm --filter @workspace/db push` changes the target database and may prompt for data loss. `push-force` is destructive and reserved for guarded disposable test setup. Neither is a schema-validation command.

`scripts/post-merge.sh` installs using the lockfile and attempts non-force db push, continuing only for recognized data-loss prompts. Review that behavior before any platform task merge. A manual Git pull is not proof this platform-specific hook executes; never assume synchronization happened.

## Financial and timestamp invariants

- Invoice numbers must remain tenant-unique; the allocation helper retries uniqueness races rather than invalid aggregate row locking.
- Payment status claims/reverts compare the observed timestamp ownership token. PostgreSQL microseconds versus JS milliseconds require consistent truncation.
- Stripe reconciliation must precede releasing a stranded processing claim.
- Do not rewrite Stripe references or change platform/Connect ownership to satisfy fixture setup.
- Do not export customer data, password hashes, signed object URLs, or connection strings into this package.
