---
name: SMS consent enforcement surfaces
description: All the outbound SMS call sites that must route through consent gating, plus phone-match and portal-secret pitfalls in the A2P 10DLC feature.
---

# SMS consent enforcement surfaces

**Rule:** Customer-facing SMS must go through `sendSMSWithConsent` (lib/sms-consent.ts), which checks `smsOptOut` + the per-category pref. The combined notification helpers `sendReminder` and `sendReviewRequestNotification` (lib/notifications.ts) only enforce consent when the caller passes `consent: { customerId, companyId }`; **without it they fall back to a raw `sendSMS`** that bypasses every check.

**Why:** Reminders/review-requests have *multiple* call sites and it's easy to gate some and miss others. Known callers that must all pass `consent`:
- `routes/appointments.ts` (reminder branch of `sendAppointmentNotification`)
- `routes/routes-mgmt.ts` (the daily send-appointment-reminders batch — easy to forget, it's a cron-style loop)
- `routes/review-requests.ts` (manual review request)
- `lib/automations.ts` (automation-triggered review request)

A missed call site = "we gated consent" but opted-out customers still get texted (compliance breach). Same multi-surface trap as plan-feature-surfaces / payment-notification-paths.

**How to apply:** When touching SMS sends, `rg "sendReminder\(|sendReviewRequestNotification\("` and confirm each non-lead caller passes `consent`. Lead-only paths (follow-ups.ts lead fallback, lead-assignment to staff) legitimately use raw `sendSMS` (no consent record exists for leads/staff).

## Phone matching for inbound STOP/START/HELP
Match stored `customers.phone` against the inbound number on the **trailing 10 digits**, not exact string: `right(regexp_replace(phone,'[^0-9]','','g'),10) = <last10>` (helper `customerPhoneMatches` / `findCustomersByPhone`). Stored phones are free-form (`(555) 123-4567`, `+15551234567`, `555-123-4567`); exact-string `eq()` silently matches zero rows, so STOP replies "unsubscribed" while opting nobody out.

## Portal JWT secret must match customer-portal
`routes/sms-consent.ts` portal auth must derive its secret identically to `routes/customer-portal.ts`: `(SESSION_SECRET || JWT_SECRET) + "portal:"`. A divergent fallback (e.g. `"dev_session_secret"`) makes portal tokens unverifiable → every portal SMS-preference call 401s.

## Webhook fail-closed
`validateTwilioSignature` must return **false** in production when `TWILIO_AUTH_TOKEN`/`APP_BASE_URL` are missing (only skip validation in non-prod). Failing open lets anyone forge `From` and mutate consent.
