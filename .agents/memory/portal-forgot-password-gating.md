---
name: Portal forgot-password must not gate on existing password
description: Customer portal "forgot password" silently did nothing for magic-link-only customers because it only emailed when a password hash already existed.
---

The customer portal has two parallel email-link auth paths that share the
`portalInviteToken`/`portalInviteExpiresAt` columns and the `/portal/set-password`
page: passwordless magic login (`/portal/auth/request-link`) and password
set/reset (`/portal/auth/forgot-password`).

**Rule:** Any portal flow that lets a customer (re)gain access must send to *any*
customer with an email — never gate on `portalPasswordHash` being present.

**Why:** Customers who only ever used magic links have `portalPasswordHash = null`.
The old forgot-password handler ran `if (customer && customer.portalPasswordHash)`,
so it returned HTTP 200 with the generic "if that email has an account…" message
but sent nothing — the customer was permanently unable to create a password. The
magic-link path worked because it had no such gate. Customer portal is a feature on
ALL plan tiers (starter/growth/pro), so every tier's customers must be able to log
back in each time.

**How to apply:**
- forgot-password sends to `if (customer && customer.email)`; pick intent
  `reset` vs `set` from whether `portalPasswordHash` exists. The set-password page
  handles both first-time-set and reset via the same token.
- `sendPortalAccessEmail` (lib/notifications.ts) supports intents
  `invite | login | set | reset`.
- Keep all branches of these endpoints returning an identical generic success
  payload (incl. the unknown-company branch) to avoid slug/email enumeration.
- Verify delivery via the "Email sent via Resend" log line, NOT just HTTP 200.
