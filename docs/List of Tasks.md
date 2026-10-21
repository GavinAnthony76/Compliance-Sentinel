# List of Tasks

GreenSynk — Consolidated Task Register

Prepared October 21, 2026.

## Scope and status

This document consolidates the eleven task suggestions listed in the project context and the SaaS documentation review. It records proposed work; it does not authorize implementation, change task statuses, or claim any item has been completed.

Nine items remain proposed in the task list. The two documentation-review suggestions are included here for completeness as archived suggestions. Existing task descriptions may reflect earlier code; each item should be checked against the current implementation before work begins.

Items are grouped by subject, not ranked by priority. Task references connect each entry to its existing project record. Existing dependencies are reproduced for traceability, but their current completion status has not been revalidated.

## 1. Payments and financial safeguards

### Keep a staff “mark as paid” click from wiping out a card charge in progress

**Reference:** #217 | **Status:** Proposed | **Existing dependency:** #210

**Purpose:** Prevent a manual payment-status change from overwriting an automatic card charge’s live processing claim and ownership token.

**Work:** Audit the manual mark-paid endpoint and similar staff-side invoice status writers. Make updates conditional on the observed invoice version or otherwise atomic, following the ownership safeguards used in customer-portal payment routes.

**Completion criteria:**
- A concurrent manual action cannot invalidate another payment process’s live claim.
- Version comparisons handle database timestamp precision consistently.
- Regression coverage demonstrates the competing-update scenario.

### Catch invoices flipped to paid when a status object is built far from the update

**Reference:** #215 | **Status:** Proposed | **Existing dependency:** #202

**Purpose:** Close a blind spot in the automated guard that detects invoice paid-status transitions requiring payment notification dispatch.

**Work:** Extend the static test to trace update objects passed into invoice updates even when those objects are created well before the database write and use an unexpected variable name.

**Completion criteria:**
- A fixture with a remotely constructed status-update object is detected.
- Existing legitimate payment paths and fixtures continue to pass.
- The guard helps prevent future paid transitions from bypassing required notifications.

## 2. Customer data and public-form protection

### Block new properties from being attached to another company’s customer

**Reference:** #220 | **Status:** Proposed | **Existing dependency:** #216

**Purpose:** Protect company data isolation when creating a property.

**Work:** Validate that the supplied customer belongs to the authenticated company before inserting a property, mirroring the existing ownership validation described for property updates.

**Completion criteria:**
- Property creation with another company’s customer ID is rejected with HTTP 400.
- Valid property creation for the caller’s own company continues to work.
- The rejected request does not create a cross-company association.

### Stop the public estimate form from flooding a company’s inbox

**Reference:** #219 | **Status:** Proposed | **Existing dependency:** #204

**Purpose:** Reduce inbox abuse that an IP-only submission limit does not prevent.

**Work:** Add a per-submitter cap on unreviewed public estimate requests, using normalized email or phone identity and the atomic admission pattern used by public booking.

**Completion criteria:**
- Repeated submissions from the same identity cannot exceed the configured pending-request cap.
- Admission remains safe under concurrent requests.
- Over-limit submissions return HTTP 429 and show a friendly message on the public estimate page.
- A focused end-to-end regression test is registered in the appropriate CI group.

## 3. Estimates and lifecycle follow-ups

### Make customer estimate signatures save successfully

**Reference:** #222 | **Status:** Archived suggestion from the documentation review

**Purpose:** Resolve a probable defect that can prevent a customer’s acceptance and signature from being saved.

**Work:** Check the public estimate-signing handler’s token handling. The reviewed code selects the estimate using a hashed public token but updates using the raw token. Use the correct token representation consistently and safely handle a missing updated row.

**Completion criteria:**
- A valid signing link saves accepted status, signer name, signature timestamp, and signature data.
- Repeat signing is rejected appropriately.
- Regression tests cover lookup and update using the expected token representation.
- Tests do not alter production records or send real customer notifications.

### Make estimate, job-completion, and invoice follow-up campaigns actually start

**Reference:** #223 | **Status:** Archived suggestion from the documentation review

**Purpose:** Ensure campaign trigger options correspond to actual lifecycle events.

**Work:** Verify the wiring for estimate-sent, appointment-completed, and invoice-sent follow-ups. The documentation review located explicit enqueue calls only for lead-created events. Add any missing lifecycle calls without changing the separate advanced automation engine.

**Completion criteria:**
- Each supported lifecycle event queues the appropriate follow-up only after its real successful transition.
- Duplicate events do not create duplicate follow-ups.
- Company and recipient boundaries remain enforced.
- Focused tests run with real email and SMS delivery disabled.

## 4. Platform-admin monitoring

### Show the “sweep recovered” all-clear in the admin dashboard too

**Reference:** #201 | **Status:** Proposed | **Existing dependency:** #191

**Purpose:** Show platform admins that a stale-admin lockout sweep outage has been resolved, rather than relying only on a recovery email.

**Work:** Where the sweep outage alert appears, compare the latest recovery activity marker with the latest alert marker and show the resolved state when recovery is newer.

**Completion criteria:**
- A newer recovery marker changes the outage display to a resolved state.
- The display includes when the sweep recovered, using the recovery metadata.
- The interface distinguishes an active warning from a resolved incident.

### Clear the sweep warning automatically when the sweep comes back

**Reference:** #213 | **Status:** Proposed | **Existing dependency:** #209

**Purpose:** Prevent an open admin screen from continuing to show an outdated warning after the sweep resumes.

**Work:** Periodically refetch lockout-run history while the history panel is mounted, instead of only recalculating warning age against the initial response.

**Completion criteria:**
- New sweep runs become visible without a manual page refresh.
- A stale warning clears when fresh run data arrives.
- A frontend test using fake timers verifies recovery while the tab remains open.

## 5. Day-to-day usability

### Offer one-click “This week” / “This month” date shortcuts on appointments

**Reference:** #212 | **Status:** Proposed | **Existing dependency:** #206

**Purpose:** Make common scheduling filters faster than entering both dates manually.

**Work:** Add date presets near the appointments page’s From/To inputs, including This week and This month, with Today where appropriate.

**Completion criteria:**
- Selecting a preset sets both date boundaries correctly.
- Active presets are visibly identified.
- Presets clear cleanly and remain consistent with manual date changes.

### Let the customers search box find people by street address too

**Reference:** #214 | **Status:** Proposed | **Existing dependency:** #205

**Purpose:** Help lawn-care operators find customers by street, city, or ZIP code.

**Work:** Extend the shared customer filter to include address fields so the customer list and matching CSV export use the same search rules. Update the search-box placeholder to mention address.

**Completion criteria:**
- Street address, city, and ZIP searches return the appropriate customers.
- The filtered CSV export matches the list’s search results.
- Existing name, email, and phone search continues working.
- Regression coverage includes an address-search case.

## 6. Test-suite reliability

### Protect the remaining payment and email test suites from breaking silently when code changes

**Reference:** #211 | **Status:** Proposed | **Existing dependency:** #203

**Purpose:** Turn opaque module-mock import crashes into clear messages when production code begins importing exports that a test mock does not provide.

**Work:** Extend the existing mock-surface preflight pattern to the remaining suites identified in the task: account-emails, admin-deactivation-note, admin-sweep-toggle, branded-emails, lockout-runs-health, platform-settings-clamp, sweep-claim-ownership, sweep-health-alert, and team-invite-email.

**Completion criteria:**
- Each affected suite checks its mock exports before importing production code.
- An intentional missing-export case produces an actionable error message.
- The normal test gate continues to pass.

## Implementation notes

- This document lists work only; no task was executed as part of compiling it.
- The two admin-monitoring tasks are related but distinct: one adds a resolved state, and one refreshes the underlying data automatically.
- The two payment-safety tasks are distinct: one protects runtime concurrency, and one strengthens automated detection of notification bypasses.
- Before implementation, confirm the current code still has the described gap and check existing dependencies to avoid duplicating completed work.
- Do not use production payment methods, send real test messages, or mutate production customer data when validating these changes.
