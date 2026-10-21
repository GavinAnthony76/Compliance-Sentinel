# Regression guardrails

## Non-negotiable engineering boundaries

1. **No destructive operations.** Do not delete modules/directories, reinitialize the repo/project, overwrite database contents, drop/truncate tables, perform destructive migrations, remove working features, reset Git history, force-push, modify production secrets, or run unrelated OS administration without explicit approval.
2. **Preserve functionality.** Read relevant code and tests before editing. Prefer additive/narrow fixes. No unrelated refactors or breaking APIs/schema/configuration without approval.
3. **Small reviewable changes.** One feature branch/PR per issue or tightly related issue set. Do not mix payment-system changes with convenience UI work.
4. **Regression protection.** Establish current behavior, identify tests, add a defect regression, make the smallest fix, run focused and broader safe checks, and compare with BASELINE.md. Do not silently delete, skip, or weaken failures.
5. **Financial safety.** Use mocks or explicitly approved isolated sandbox infrastructure. Never initiate a live charge/refund or mutate real financial ownership/customer records for testing.
6. **Tenant safety.** Derive company ownership from authentication, validate related IDs, and test both allowed and forbidden access.
7. **No unilateral release.** Claude must not publish, change deployment settings, merge into the protected production branch, trigger live migrations/deploy workflows, or modify live billing.
8. **Approval boundaries.** Isolated normal repo work/tests are permitted only for the selected issue. Ask before destructive/production-affecting actions, significant architecture changes, major dependency upgrades, and potentially breaking migrations.

## Behavior that must remain intact

### Sessions, access, and portal

- Owner/admin/staff, platform-admin, and customer-portal identity types remain distinct.
- Do not overwrite a fetch caller’s Authorization with a company JWT.
- Preserve email normalization and verification/login recovery flows.
- Password reset invalidates appropriate company sessions; a failed DB lookup policy must be explicitly approved.
- A manager-only screen requires backend role enforcement, not only hidden navigation.
- Portal users cannot access another customer’s documents or cancel company/recurring-origin appointments.
- Handle 401 by clearing cached auth data without resetQueries/refetch loops.

### Catalog, business operations, and limits

- Preserve customers/properties/services CRUD, assignment boundaries, status transitions, shared filters, and date interpretation.
- Keep customer/appointment/invoice CSV results consistent with corresponding list filters.
- Preserve plan limit enforcement and feature gates; UI labels must not silently grant server capabilities.
- Starter portal access/manual estimate availability must not disappear through a broad gating refactor.
- Do not claim advanced forecasting/API/AI labels are implemented solely because entitlement strings exist.
- Keep public booking’s atomic pending cap, normalized identity, layered rate limits, and portal-origin semantics.

### Money and notifications

- Separate subscription billing, Connect portal payments, and platform-context autopay.
- Preserve invoice-number uniqueness and allocation retry behavior.
- Preserve processing ownership tokens in claim, successful transition, stale release, and failed-writer revert.
- Compare database timestamps at JS-compatible precision.
- Confirm actual paid provider state before updating invoice; reconcile before releasing unknown processing states.
- Emit receipt and owner notification on all genuine paid paths; await critical sends before response where needed.
- Preserve idempotency and prevent duplicate paid notices under webhook/confirmation races.
- Do not mark an invoice sent unless delivery result confirms it.
- Resolve business recipients using the established owner fallback, not company.email alone.
- Test-mode email/SMS suppression is load-bearing. Mock suites that bypass it must replace the provider, not use live credentials.

### Jobs, storage, and deployment

- Do not replace persisted due checks/advisory locks with bare in-memory 24-hour timers.
- Preserve recovery/alert deduplication and disabled-sweep health interpretation.
- Keep private object ownership authorization and PDF image SSRF defenses.
- Do not remove PDFKit/Twilio externalization without a tested runtime-compatible build plan.
- Do not put large assets or private responses into the PWA precache.
- Preserve artifact paths, SSR/prerender behavior, and managed service startup/health checks.

## Change-impact checklist

For each PR state:
- What existing behavior could this alter?
- Which roles/tenants/customer identities must still work or remain blocked?
- Which create/edit/delete/read/status states need protection?
- Are other endpoints writing the same state?
- Are emails, SMS, webhooks, workers, and plan gates affected?
- Does the change preserve old data and existing links?
- What is not verified, and what must a human approve?

## Release stop conditions

Stop if the repository/base is unapproved, the change exceeds scope, production credentials would be needed for tests, the DB is not disposable, financial ownership is unclear, unexpected schema deletion is proposed, a required test regresses, or production deployment could trigger automatically. Preserve the existing working deployment and report the blocker; do not improvise a bypass.
