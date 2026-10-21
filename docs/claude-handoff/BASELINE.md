# Baseline verification report

## Identification

- Inspection date: October 21, 2026.
- Source commit: `86c5de465bef127b11acd4e07041e048a1987c6f`.
- Local branch: `master`, configured upstream `origin/master`.
- Initial working tree: clean. Handoff documents are subsequent additions, not code changes.
- Node: `v24.13.0`; pnpm: `10.26.1`.
- Lockfile: `pnpm-lock.yaml`.
- Lockfile SHA-256: `f46e60a28284f8678c416eb3f33a9d61da4b68b5eed1e3b9fe63afc52cc6e378`.
- `origin`: GitHub repository `GavinAnthony76/Compliance-Sentinel`. Repository name differs from GreenSynk; owner confirmation required.
- Read-only `git ls-remote --symref origin HEAD refs/heads/master refs/heads/main` succeeded: remote HEAD is master; advertised commit `6acb43cb99a54ff81522492008e53b8f08f55838`.
- Local baseline and remote HEAD differ. No fetch, pull, merge, push, or ancestry reconciliation was performed. Do not assume one is a fast-forward of the other.

## Safe execution boundaries

Typechecks/builds operate on source/generated outputs. API gate code was inspected before running. Its awaited database guard redirects to a separate disposable sibling test database before schema force-push and fixture cleanup. No production database test operations were performed.

API subprocess configuration removed direct Stripe keys, webhook secrets, connector identity/host, Resend credentials, Twilio credentials/phone, and AI API credentials; NODE_ENV=test was supplied. These were child-process changes, not workspace or production secret changes.

Mock email suites install fake provider SDK implementations and dummy credentials; their “Email sent via Resend” log lines represent mocks. No live-message/charge tests were intentionally enabled. The autopay positive path explicitly skipped without sandbox keys.

## Executed results

| Check | Result | Evidence / interpretation |
| --- | --- | --- |
| `pnpm run typecheck` | FAIL, exit 2 | Library declaration build completes; root recursive check stops in greensynk-ad due DOM globals/HTML element types and animation Variant typing |
| `pnpm --filter @workspace/api-server run typecheck` | PASS | No TypeScript errors in the SaaS API package |
| `pnpm --filter @workspace/lawn-saas run typecheck` | PASS | No TypeScript errors in the SaaS web package |
| `pnpm --filter @workspace/lawn-saas test` | PASS | 5 test files, 35 tests |
| API build with `BUILD_OUTDIR=dist-handoff pnpm --filter @workspace/api-server run build` | PASS | Isolated output avoids replacing running preview bundle; does not prove runtime provider availability |
| Initial frontend build without artifact env | BLOCKED, exit 1 | Vite correctly requires PORT; shell did not inherit artifact service env |
| `PORT=26093 BASE_PATH=/ API_PORT=8080 NODE_ENV=production pnpm --filter @workspace/lawn-saas run build` | PASS with warnings | Client + SSR build and six-route prerender finish; landing-page body fallback occurs |
| Provider-isolated combined `test:all:ci` | FAIL, exit 1 | 14 of 16 named summary groups pass; access group and billing-status-email group fail under this invocation |
| Focused `test:billing-emails` with NODE_ENV unset, providers/connector unavailable | PASS | 35 passed, 0 failed; confirms inherited test suppression caused initial unit assertions |
| `pnpm --filter @workspace/db exec drizzle-kit check --config ./drizzle.config.ts` | BLOCKED/FAIL | CLI reports missing AWS Data API parameters with current config; not a successful schema validation |
| Lint | NOT AVAILABLE | No lint script or checked-in GitHub lint workflow was found in inspected manifests/configuration |
| Full root `pnpm build` | NOT RUN as an additional duplicate gate | It begins with the already-failed root typecheck; SaaS production builds were tested separately |
| Existing preview startup / health | PASS for basic availability | Configured API/web workflows were running; proxied GET `/api/healthz` returned 200. No authenticated workflow acceptance is implied |

## Combined API gate details

PASS:
- Awaited payment-dispatch guard
- Paid-transition dispatch guard
- Lead-access validation
- Admin-deactivation validation
- Stuck-invoice sweep validation
- Sweep/autopay race validation
- Claim-ownership race validation
- Sweep claim-ownership race validation
- Portal claim-ownership race validation
- Payment receipt email validation
- Team-invite email validation
- Branded owner-email validation
- Account-email validation
- Portal booking/cancellation notification validation

FAIL:
1. **Access validation:** `tests/payment-access.e2e.mjs` reports 23 passed / 2 failed. It expects 403 for own-invoice payment without a Connect account but gets 503 BillingUnavailable; its concurrent-portal-pay case also gets four 503 responses. Safe no-provider configuration fails Stripe initialization before those expectations. Preserve this evidence; do not enable a live key to turn it green.
2. **Billing status email validation:** 16 passed / 19 failed when NODE_ENV=test suppresses mocked provider sends. Other email suites manage NODE_ENV themselves; this suite inherits it. The focused run with NODE_ENV unset passes **35 / 0** using the mocked provider. The original combined exit remains a failure, not retrospectively relabeled PASS.

No second full gate was run after the focused diagnostic; no application changes were made. Historical finished workflow logs showed a prior combined pass and frontend 35/35, but they are not substituted for this safety-restricted baseline.

## Existing source/build issues

### Workspace typecheck

`artifacts/greensynk-ad/src/components/video/VideoTemplate.tsx`, `VideoWithControls.tsx`, `src/hooks/use-mobile.tsx`, `src/lib/video/hooks.ts`, and `src/main.tsx` produce missing DOM types/globals. `src/lib/video/animations.ts` also produces Variant/transition typing errors. These errors predate any Claude implementation; no type settings, files, or artifacts were deleted to hide them.

### Frontend production warnings

- `src/components/ui/tooltip.tsx`: sourcemap cannot resolve original source location.
- Landing prerender: `localStorage is not defined`; prerender falls back to an empty body for `/` while the command exits successfully.
- Six static routes are generated; client PWA precache reports 126 entries, approximately 3.8 MiB total. This is not the per-file 2 MiB limit.

A successful build therefore does not certify server-rendered landing content.

### Database validation

Guarded test schema push reports no changes against the isolated test database. This is not a read-only comparison with the real development or production schema. No migration journal was found under lib/db; drizzle-kit check failed rather than providing a migration consistency baseline. Do not replace this with unguarded push-force.

## Test gaps / uncertainties

- Public signature and public PDF raw/hash happy-path regression.
- Property creation foreign-customer association.
- Manual paid action versus newly claimed processing invoice.
- Campaign enqueue/deduplication beyond lead_created.
- Mock export preflight in nine suites.
- Distant object construction in paid-transition detection.
- Admin health auto-refresh/recovery UI.
- No full-browser, native-device, live Stripe, live SMS, live email-delivery, or production schema acceptance was performed.
- Branch protection, GitHub CI, production auto-publishing triggers, staging isolation, and backups remain operator-verification items.

## Evidence location

Raw command logs remain locally under ignored `generated-artifacts/claude-handoff-validation/`, not in Git or the downloadable source handoff. They may contain synthetic test identity details and internal output. This report records sanitized commands/results instead of distributing raw logs.

Future PRs must report the original failures separately from regressions they introduce. A required check may not be weakened or removed to obtain a green result.
