# Validation and acceptance

## Before running anything

Confirm the selected issue, approved baseline, current branch, clean/understood working tree, disposable PostgreSQL target, and disabled real providers. Never print database URLs or keys to prove configuration. Do not test against production or the ordinary development database containing real records.

Read `tests/test-db-guard.mjs` and `tests/ci-harness.mjs` before running database suites. The existing guard is awaited and redirects to `_test` before destructive setup. Do not copy only its name without preserving the await.

## Core commands and meaning

From repository root:

```sh
pnpm install --frozen-lockfile
pnpm run typecheck:libs
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/lawn-saas run typecheck
pnpm --filter @workspace/lawn-saas test
BUILD_OUTDIR=dist-handoff pnpm --filter @workspace/api-server run build
PORT=26093 BASE_PATH=/ API_PORT=8080 NODE_ENV=production pnpm --filter @workspace/lawn-saas run build
```

These commands do not authorize package changes, schema changes, or startup against real data. `pnpm run typecheck` is the broader workspace command; it currently fails in the separate ad artifact. Root `pnpm build` begins with that check. Report both SaaS checks and root status, not just the passing subset.

No lint script is established. Do not silently add a new formatter/linter gate or reformat the repository during a defect fix.

### Combined API gate — disposable database only

The current package script is:

```sh
pnpm --filter @workspace/api-server run test:all:ci
```

It builds once into dist-ci, force-syncs schema after the DB guard, and runs permissions/access/admin groups on separate local ports (5099/5098/5097), then ownership and mocked notification suites. Do not run concurrent builds into the same output directory.

For a safety-isolated run in a shell with inherited provider settings, remove the external service credentials/connector identity from the **child process only**. The following is a documented future command, not an instruction to change workspace secrets:

```sh
env -u NODE_ENV \
  -u STRIPE_SECRET_KEY -u STRIPE_PUBLISHABLE_KEY \
  -u STRIPE_WEBHOOK_SECRET -u STRIPE_V2_WEBHOOK_SECRET \
  -u REPL_IDENTITY -u WEB_REPL_RENEWAL -u REPLIT_CONNECTORS_HOSTNAME \
  -u RESEND_API_KEY \
  -u TWILIO_ACCOUNT_SID -u TWILIO_AUTH_TOKEN -u TWILIO_PHONE_NUMBER \
  -u AI_INTEGRATIONS_OPENAI_API_KEY \
  pnpm --filter @workspace/api-server run test:all:ci
```

Why unset inherited NODE_ENV here: the harness chooses test for API servers and explicitly test for relevant database/ownership suites, while provider-mocked email suites need their own non-suppressed environment. Setting test globally caused the billing-status mocked-email assertions to fail during baseline; a focused normalized run passed. This does **not** authorize removing the test suppression in production helpers.

The no-provider access tests still need the reviewed stub/expectation correction identified in BASELINE.md. Treat nonzero exit as failure, not permission to retrieve live credentials.

### Focused commands

```sh
pnpm --filter @workspace/api-server run test:awaited-dispatch
pnpm --filter @workspace/api-server exec node tests/paid-transition-dispatch.test.mjs
env -u NODE_ENV pnpm --filter @workspace/api-server run test:billing-emails
pnpm --filter @workspace/api-server run test:permissions:ci
pnpm --filter @workspace/api-server run test:access:ci
pnpm --filter @workspace/api-server run test:admin:ci
pnpm --filter @workspace/api-server run test:stuck-invoices:ci
```

Standalone CI commands also require isolated DB/provider setup. Do not run them all redundantly after a passing unchanged combined gate. Test-script names such as test:access without :ci may expect an already running test API and should not be aimed at the normal preview blindly.

## Coverage ownership

| Area | Existing suites |
| --- | --- |
| Company/staff roles and tenant access | permissions.e2e, lead-ownership unit/e2e, manager-screen-access, shared-screen-access |
| Customers/properties/services/appointments | appointment-customer-access, property-service-access, appointment-export-filters |
| Estimates/recurrence | estimate-recurring-plan-access, portal-document-access |
| Portal authentication/actions | portal-auth, portal-appointment-actions, portal-booking-notifications |
| Public booking admission | public-booking-cap |
| Invoices/PDFs/summary/numbering | invoice-billing-access, invoice-number, invoice-summary, invoice-pdf-access, receipt-pdf-access, portal-document-access |
| Payments/races | payment-access, autopay-claim-ownership, portal-claim-ownership, autopay-sweep-race, sweep-claim-ownership, stuck-invoices |
| Paid notification invariants | awaited-dispatch, paid-transition-dispatch, payment-receipt-email, branded-emails |
| Billing/account/team messaging | billing-activity, billing-status-email, account-emails, team-invite-email |
| Admin sweeps/settings/health | admin-stale-deactivation, admin-lockout-runs, admin-settings-threshold, admin-deactivation-note, admin-sweep-toggle, lockout-runs-health, sweep-health-alert, platform-settings-clamp |
| Shared mocked imports | mock-surface-check plus suites using it; nine-suite expansion remains #211 |
| Frontend | searchable-select, appointment-date-range, invoice-processing, invoice-processing-polling, lockout-history-panel |

API names above abbreviate files under `artifacts/api-server/tests/`; frontend exact paths are in FEATURE-INVENTORY.md. Existing tests must be read before extension; a descriptive filename does not establish every scenario is covered.

## Manual non-production acceptance matrix

Use synthetic data in an approved test environment and suppressed/stubbed providers. These are **required future acceptance scenarios**, not scenarios performed for this documentation assignment.

1. **Authentication:** verified owner login, unverified denial, password reset, revoked session, invalid token/type; admin and portal cannot substitute for company identity.
2. **Tenant isolation:** create/read/edit/delete within one company; repeat foreign resource IDs from a second company; assert denial and no writes.
3. **Property linkage:** own customer accepted, foreign/nonexistent customer rejected, reassignment unchanged.
4. **Scheduling:** manager creates/assigns/edits; staff acts only on assigned job and allowed fields; local-date filtering/export matches.
5. **Portal booking:** own request capped atomically; no cross-customer data; cancel allowed for own portal-origin pending/confirmed visits, not company-origin jobs.
6. **Estimates:** authenticated creation/line items/totals, rotated share token, public view/sign/PDF, invalid/old tokens, repeat/concurrent acceptance, rejected state.
7. **Invoicing:** from-appointment prefill remains unsaved until explicit creation; unique numbers under concurrency, PDF/receipt, send success/failure without false sent state.
8. **Payments:** stubbed/sandbox pay/confirm/webhook/autopay paths, replay, wrong account/customer/invoice/amount/currency, manual writer race, unknown provider status, duplicate notifications.
9. **Messaging:** correct owner fallback, tenant branding, consent/STOP, failed-delivery state, no live fixture messages.
10. **Campaigns/recurrence:** successful event enqueue, retries and repeat events, correct customer/tenant, no duplicate generated jobs after restart.
11. **Admin monitoring:** disabled/healthy/overdue/recovered sweep, current operator protection, refreshed history, lockout threshold clamps.
12. **Frontend build:** route navigation, direct URL refresh, public SSR content, responsive pages, processing polling, no console errors in changed flow.

## Replit integration acceptance checklist

- Confirm exact approved integration commit and file diff; no unrelated/unreviewed files.
- Install frozen dependencies and rebuild declarations.
- Compare all failures/warnings/skips with BASELINE.md.
- Complete appropriate focused tests plus established broader safe suite.
- Build frontend/API; confirm startup on approved non-production data and `/api/healthz`.
- Verify affected workflow and related roles with human acceptance.
- Check configuration names, artifact routing, runtime externals, provider accounts/modes.
- Review database migrations and backup/rollback separately.
- Confirm no live Stripe actions or customer messages occurred and no production data was mutated.
- Human signs off; production publishing requires a distinct explicit approval.

If integration fails, stop the release. Preserve current production; record the failure, do not auto-replace it with an unverified build.
