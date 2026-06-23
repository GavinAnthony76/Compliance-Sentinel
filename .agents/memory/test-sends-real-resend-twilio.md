---
name: Tests must never hit real Resend/Twilio
description: Why notification sends are gated on NODE_ENV==="test" and what breaks if that guard is removed.
---

CI e2e suites run with RESEND_API_KEY and Twilio creds present, so `sendEmail`/`sendSMS`
in `artifacts/api-server/src/lib/notifications.ts` would actually dispatch to real
providers — sending thousands of messages to fixture addresses like
`accmq..._owner_...@example.com`. Those all bounce, which tanks the greensynk.com
domain's sender reputation (observed a 99% bounce rate flood in the Resend dashboard).

**Rule:** the first statement of both `sendEmail()` and `sendSMS()` must short-circuit
when `process.env.NODE_ENV === "test"` (log a "[TEST EMAIL/SMS] suppressed" line and
return a delivered/no-op result). Dev preview and production still send real messages.

**Why:** the e2e access/permissions/admin suites exercise real notification call sites
(appointment status changes, invoices, signup confirmations). Without the guard, every
test run is an outbound blast to dead addresses.

**How to apply:** never gate this on "creds absent" alone — the workspace HAS live creds,
so the mock-mode check (`isSMSMockMode()` / `resolveEmailCredentials() === null`) does not
fire in CI. The `NODE_ENV==="test"` check is the load-bearing one. Verify after changes:
run a CI suite and confirm `rg -c 'Email sent via Resend'` returns 0.

Note: this does not undo already-bounced messages; a sustained high bounce rate can get a
domain suspended at the Resend account level (out of code's control — the user must check
Resend).
