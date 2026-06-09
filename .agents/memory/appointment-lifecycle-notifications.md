---
name: Appointment lifecycle customer notifications
description: Where status-change customer emails/SMS are wired, and why the /complete endpoint missed them; plus the Twilio-not-installed SMS failure.
---

# Appointment lifecycle customer notifications

## Completion email gap (fixed)
Customer status-change notifications (`sendAppointmentStatusNotification`) are wired in `PUT /api/appointments/:id` on any status transition. But the dedicated lifecycle endpoint `POST /api/appointments/:id/complete` historically only set status=completed + called `fireAutomations("appointment_completed")` — it did NOT call `sendAppointmentStatusNotification`.

**Effect:** a fresh company with no configured automations never emailed the customer on job completion (the most common "Complete job" button path), even though confirmed/in_progress emails worked.

**Rule:** any customer-facing notification that should fire on a status change must be wired in BOTH the generic `PUT /:id` path AND each dedicated lifecycle endpoint (`/complete`, etc.). Don't rely on the automations engine for baseline notifications — automations require the company to set up a rule first.

**Why:** lifecycle endpoints bypass the PUT status-change branch, so notification logic added only to PUT silently doesn't run for them.

**How to apply:** when adding/auditing status emails, guard side-effects on `existing.status !== "<newStatus>"` (mirrors PUT) so re-calling the endpoint doesn't double-notify or re-run automations.

## SMS broken when Twilio creds set but package absent
`sendSMS` only enters mock mode (`[MOCK SMS]`) when any of `TWILIO_ACCOUNT_SID/AUTH_TOKEN/PHONE_NUMBER` is unset. When all three ARE set it does `await import("twilio")`. If the `twilio` package isn't installed, every SMS throws `ERR_MODULE_NOT_FOUND: Cannot find package 'twilio'` (logged "Failed to send SMS") — i.e. SMS is fully broken for Growth/Pro, not mocked.

**Rule:** if Twilio creds are present, `twilio` must be a real dependency in `artifacts/api-server/package.json` AND externalized in `build.mjs` (esbuild can't bundle it). Otherwise unset the creds to fall back to mock mode.

## Verifying email delivery in tests
`sendEmail` swallows all errors (never throws), so HTTP 200 does NOT mean an email sent. Verify via api-server logs: success = `"Email sent via Resend"`, failure = `"Resend rejected email"` / `"Failed to send email via Resend"`, no-creds = `"[MOCK EMAIL]"`. Use Resend sandbox sink `delivered@resend.dev` as the recipient to exercise the pipeline without hitting real inboxes.
