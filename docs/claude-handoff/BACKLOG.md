# Source-verified engineering backlog

This is a prioritized handoff register, not new task execution or permission to implement. Historical task numbers are retained. Project-record status and source status are separate: “Proposed” does not prove a bug, and an archived suggestion does not prove rejection.

All source findings below were inspected at baseline `86c5de465bef127b11acd4e07041e048a1987c6f`. Runtime exploitability and external-provider correctness are not certified by static inspection.

**Priorities:** P0 = safety boundary review/fix first; P1 = core reliability; P2 = maintainability/monitoring; P3 = convenience. Unnumbered REVIEW items are requested reviews, not fabricated tracker issues. Historical dependencies #191/#202/#203/#204/#205/#206/#209/#210/#216 were retrieved as MERGED; still inspect their behavior before relying on it.

## P0 — #220 Property creation tenant isolation

- **Record:** Proposed; dependency #216 (merged).
- **Verified condition:** `artifacts/api-server/src/routes/properties.ts:46` inserts `{companyId, ...parsed.data}` without checking parsed customerId against the company. PUT reassignment below it does check ownership. Source gap remains.
- **Root cause:** FK existence is being accepted without tenant relationship validation.
- **Minimal correction:** Before POST insert, validate customer ID with both customer ID and authenticated company ID; return the existing-style 400 for invalid ownership.
- **Tests:** `property-service-access.e2e.mjs`; add both foreign-company and nonexistent-customer creation cases plus valid-own-customer creation.
- **Acceptance:** Invalid associations create no row; valid CRUD and role behavior are unchanged.
- **Regression/security risks:** Rejecting legitimate reassignment or changing error shape; cross-tenant relationships are a data-integrity/security risk. No production exploit was attempted.

## P0 — #217 Manual paid action versus live payment claim

- **Record:** Proposed; dependency #210 (merged).
- **Verified condition:** `src/routes/invoices.ts:323` pre-reads the company-owned invoice; its subsequent paid update excludes already-paid status but lacks the observed updatedAt ownership comparison used by portal writers.
- **Root cause:** A pre-read plus non-paid condition cannot distinguish a newly claimed processing write.
- **Minimal correction:** Choose an approved atomic policy: disallow manual override of a live processing claim, or compare the exact observed version and handle a conflict without invalidating the charge. Preserve timestamp truncation.
- **Tests:** `portal-claim-ownership.test.mjs`, `autopay-claim-ownership.test.mjs`, `autopay-sweep-race.test.mjs`; add a manual-writer race fixture.
- **Acceptance:** An older manual action cannot replace a newer claim; paidAt/method remain correct; notifications run only once for the winning genuine transition.
- **Regression/security risks:** Financial state corruption, lost reconciliation, duplicate notices/charges if claims become incoherent. Product approval is needed for deliberate manual override semantics.

## P0 — REVIEW-A Fail-open identity and subscription policy

- **Record:** Requested review; no existing issue number supplied.
- **Sources:** `src/lib/auth.ts`, `src/lib/subscription.ts`, router mounts in `src/routes/*.ts`, `src/routes/admin-auth.ts`, `src/routes/customer-portal.ts`.
- **Verified condition:** User password-change freshness DB exception permits next(); missing user row does not reject. Admin token verification itself only verifies signature/type, not fresh active status. Subscription check passes GET, missing company/user, and DB exceptions; not all routers mount it.
- **Minimal next step:** Create a route/policy matrix and fault-injection tests before deciding which failures should deny access versus return a service-unavailable response. Do not globally lock out read/recovery/billing flows under an invented policy.
- **Tests:** `permissions.e2e.mjs`, `manager-screen-access.e2e.mjs`, `portal-auth.e2e.mjs`, `billing-access.e2e.mjs`, admin stale/deactivation suites.
- **Acceptance:** Human-approved behavior for revoked/deactivated/deleted principals, stale roles, lookup errors, expired trials, and missing company rows; both allowed and forbidden paths tested.
- **Risks/dependencies:** Availability-versus-revocation tradeoff; a broad auth change can break every tenant. Review separate from #220.

## P0 — REVIEW-B Stripe ownership, reconciliation, and notification audit

- **Record:** Requested review; no existing issue number supplied.
- **Sources:** `src/routes/billing.ts`, `src/routes/customer-portal.ts`, `src/routes/autopay.ts`, `src/lib/stuck-invoices.ts`, `src/lib/notifications.ts`.
- **Verified condition:** Portal uses Connect destination payments; saved-card charge uses platform-context PaymentIntents. Claims/reverts/reconciliation and replay guards exist. This is not an assertion that ownership, amount, currency, and account checks are complete everywhere.
- **Minimal next step:** Enumerate pay, confirm, webhook and autopay paid transitions and verify IDs, metadata, session/payment status, invoice amount/currency, tenant/customer, Stripe account/mode, idempotency, and receipt/owner notification dispatch.
- **Tests:** payment-access, portal/autopay/sweep ownership suites, stuck-invoices, awaited-dispatch, paid-transition-dispatch, payment-receipt-email, branded-emails.
- **Acceptance:** Sandbox/stub evidence for replay, timeout, concurrent manual/portal/autopay writes, uncertain provider status, and duplicate-notification prevention; no live money.
- **Risks/dependencies:** Financial loss and wrong-account settlement. Changes touching account model need explicit approval; depends conceptually on #217’s final concurrency policy.

## P1 — #222 Public estimate signature and PDF token consistency

- **Record:** Archived suggestion; retain reference; no declared tracker dependencies.
- **Verified condition:** `src/routes/public-estimates.ts:180` looks up hashed token; line 191 signs via raw-token UPDATE; line 217 public PDF retrieval also uses raw token. Authenticated `src/routes/estimates.ts` stores hashes and rotates raw share links.
- **Root cause:** Inconsistent raw-versus-hashed token representation across public paths; signature UPDATE can return no row and later code dereferences it.
- **Minimal correction:** Standardize token hashing in all public handlers, check update result, and prevent repeat/racing acceptance. Inspect signed-estimate email dispatch’s async/delivery semantics without bundling an unrelated notification rewrite.
- **Tests:** `portal-document-access.e2e.mjs` is related but not public-signing proof; add valid public view/sign/PDF, invalid token, signed/rejected state, and concurrent-signing cases.
- **Acceptance:** Signature persists once, PDF works with the same raw share token, invalid access is denied, stored hashes are never exposed as reusable links, notification wording does not promise unverified delivery.
- **Risks:** Public token leakage, duplicate signatures, broken old links, claim of a signature without persistence. No production signature was submitted.

## P1 — #223 Lifecycle campaign triggers

- **Record:** Archived suggestion; retain reference; no declared dependencies.
- **Verified condition:** `src/lib/follow-ups.ts` exposes enqueueFollowUps; `src/routes/leads.ts:166` and `public-booking.ts:321` call lead_created. No other explicit callers were found for estimate_sent, appointment_completed, invoice_sent.
- **Minimal correction:** Wire appropriate successful lifecycle transitions in `routes/estimates.ts`, `appointments.ts`, and `invoices.ts`. Keep the separate `lib/automations.ts` engine intact. Design deduplication for repeated sends/status writes.
- **Tests:** Existing manager access tests do not prove trigger dispatch. Add lifecycle/failure/repeat tests with mocked/suppressed messaging.
- **Acceptance:** Each campaign starts only for the correct successful event, company and recipient; delivery failure cannot enqueue a misleading sent event; repeated events have defined deduplication behavior.
- **Risks:** Surprise customer messages, duplicate campaigns, improper consent, changed automation tier behavior. Coordinate with REVIEW-C for worker delivery guarantees.

## P1 — #219 Public estimate abuse: historical premise not verified

- **Record:** Proposed; dependency #204 (merged).
- **Verified condition:** Current `src/routes/public-estimates.ts` defines only GET `/estimates/:token`, POST `/estimates/:token/sign`, and GET `/estimates/:token/pdf`. The registered `/api/public/estimates` IP limiter exists in app.ts. No general public estimate-request POST matching the historical task description was found.
- **Root cause:** Not established; historical description appears to conflate another form or an earlier implementation.
- **Minimal next step:** Ask the product owner to identify the exact user-visible submission form and endpoint. Public booking already has atomic pending-request caps. Do not add a pending-intake cap to token signing under the assumption it is the missing form.
- **Tests:** `public-booking-cap.e2e.mjs` is a reference only, not proof of an estimate-intake endpoint.
- **Acceptance:** Document the actual abuse surface; if confirmed, add identity normalization, atomic per-submitter pending cap, friendly 429, and focused concurrency regression. If no such feature exists, close/re-scope only after human approval.
- **Risks:** Blocking legitimate signatures or implementing an unrequested new form. Status: **clarification required, not ready for implementation**.

## P1 — #215 Paid-transition static guard blind spot

- **Record:** Proposed; dependency #202 (merged).
- **Verified condition:** `tests/paid-transition-dispatch.test.mjs` has context/window heuristics, including approximately five preceding lines and invoice/update naming assumptions. It covers literal/raw SQL/variable writes but no distant arbitrarily named object-flow fixture.
- **Root cause:** Lexical proximity is not identifier/data-flow tracing. Exact evasion remains to be proved by a new fixture.
- **Minimal correction:** First add the far-constructed object fixture; then minimally track objects passed to invoice `.set(...)` or use an approved parser approach.
- **Acceptance/tests:** Fixture detects bypass, legitimate dispatch patterns pass, unrelated status updates stay exempt. Preserve awaited-dispatch coverage.
- **Risks:** False positives or suppressions that weaken the guard. No parser dependency major upgrade without approval.

## P1 — REVIEW-C Background-job reliability

- **Record:** Requested review; no issue number supplied.
- **Sources:** app.ts; `lib/automations.ts`, `follow-ups.ts`, `recurring.ts`, `stuck-invoices.ts`, `stale-admins.ts`, `sweep-health.ts`.
- **Verified condition:** In-process intervals run on startup. Autoscale can suspend instances; stale-admin sweep has persisted due-check/lock, but equivalent durable coordination is not established for every job.
- **Minimal next step:** Inventory each job’s claim/lock, idempotency, due state, retry/backoff, failure recording, and recovery; propose bounded corrections, not a unilateral queue-platform migration.
- **Acceptance/tests:** Restart/multiple-instance/no-provider/delayed-run scenarios produce no duplicate charge, duplicate appointment, lost notification, or lost recovery marker. Preserve existing sweep ownership suites.
- **Risks:** Duplicate side effects or missed reminders under autoscale. Architecture/provider changes require explicit approval.

## P2 — #211 Mock-surface preflight coverage

- **Record:** Proposed; dependency #203 (merged).
- **Verified condition:** Nine named suites use mock.module without assertRelativeMockCovers/assertMockCovers references: account-emails, admin-deactivation-note, admin-sweep-toggle, branded-emails, lockout-runs-health, platform-settings-clamp, sweep-claim-ownership, sweep-health-alert, team-invite-email.
- **Sources/tests:** Files under `artifacts/api-server/tests/`; reference `mock-surface-check.mjs` and `autopay-claim-ownership.test.mjs`.
- **Minimal correction:** Consolidate each mock’s exports and run the appropriate existing preflight before production imports.
- **Acceptance:** One deliberate missing-export negative case produces a clear error, all nine normal suites pass, gate remains safe.
- **Risks:** Incorrect coverage map hiding a missing named export; preserve mock-only provider behavior.

## P2 — #201 Show resolved sweep incidents

- **Record:** Proposed; dependency #191 (merged).
- **Verified condition:** Recovery activity markers exist in `src/lib/sweep-health.ts`; no `sweep_health_recovered` UI consumption found in frontend `src/pages/admin-admins.tsx` or `admin-dashboard.tsx`.
- **Minimal correction:** Surface latest recovery metadata through the appropriate admin endpoint/UI; compare recovery versus alert timestamps, not just a boolean.
- **Tests:** `sweep-health-alert.test.mjs`, `lockout-runs-health.test.mjs`, `admin-lockout-runs.e2e.mjs`, frontend `lockout-history-panel.test.tsx`.
- **Acceptance:** Newer recovery displays resolved time; older recovery cannot hide a newer incident.
- **Risks:** Incorrect all-clear hides an active outage. Coordinate field shape with #213; neither requires rewriting the sweep scheduler.

## P2 — #213 Refresh sweep history automatically

- **Record:** Proposed; dependency #209 (merged).
- **Verified condition:** LockoutHistoryPanel in frontend `src/pages/admin-admins.tsx:55` fetches once on mount; a separate minute timer updates only current time.
- **Minimal correction:** Periodically refresh history while mounted with cleanup and stale-request handling.
- **Acceptance/tests:** Fake timers and a new run response clear the warning without reload; errors do not falsely mark healthy; unmounted component does not retain timers.
- **Risks:** Polling load, stale response overwrites, misleading health. Existing thresholds and disabled-sweep display must remain.

## P3 — #212 Appointment date presets

- **Record:** Proposed; dependency #206 (merged).
- **Verified condition:** Frontend `src/pages/appointments.tsx:340` has startDate/endDate and inputs; no Today/This week/This month shortcuts located.
- **Minimal correction:** Add presets using the existing `src/lib/appointment-date-range.ts` helper; confirm week-start convention rather than guess.
- **Tests:** `src/lib/__tests__/appointment-date-range.test.ts`, appointment export-filter API tests, new preset interaction tests.
- **Acceptance:** Correct local day/week/month bounds, highlight/clear behavior, manual edits and exported filter parity.
- **Risks:** Timezone/day-boundary errors and silently changing default filter semantics.

## P3 — #214 Address search

- **Record:** Proposed; dependency #205 (merged).
- **Verified condition:** `src/lib/customer-filters.ts` matches name/email/phone, not addressLine1/city/zip.
- **Minimal correction:** Extend shared conditions and frontend `src/pages/customers.tsx` placeholder; do not create separate export logic.
- **Tests:** `customer-export-filters.e2e.mjs`; add street/city/ZIP and cross-tenant exclusion.
- **Acceptance:** List and CSV match the same address search; original search remains valid.
- **Risks:** Broader unintended result sets or query-performance regression; tenant condition must remain ANDed.

## Baseline repair prerequisites — not yet tracker issues

1. Root typecheck fails in the ad artifact (DOM type definitions and animation variant types). Preserve that artifact and fix narrowly.
2. Safe provider-disabled access test expects a 403 while getting configuration-unavailable 503; add an intentional stub/defined no-provider assertion rather than enabling live Stripe.
3. Billing-status unit suite inherits NODE_ENV=test and suppresses its mocked sends; focused run with NODE_ENV unset passes. Normalize unit-test environment without disabling real-send suppression for integration suites.
4. Frontend build exits successfully despite landing prerender failing on localStorage and a tooltip sourcemap warning.
5. No checked-in migration history; drizzle-kit check does not provide a successful read-only schema baseline with the current config.

## Sequencing

Approve repository/base/validation first; then separate #220, #217, #222 branches. Perform REVIEW-A/B alongside scoped safety work without silently expanding it. Add #223 after transition semantics and delivery deduplication are defined. Hold #219 until clarified. Keep test/monitoring improvements separate from convenience UI work.
