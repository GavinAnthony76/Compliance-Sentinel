---
name: Platform-admin deactivation testing
description: Hidden hazards when testing the platform-admin dormant-deactivation endpoints against the shared prod DB.
---

# Testing platform-admin deactivation endpoints

`POST /admin/admins/deactivate-stale` is GLOBAL and has real side effects: it
deactivates EVERY admin idle 90+ days (or never signed in) AND emails each one a
"your access was disabled" notice. The api-server runs against the shared
production Neon DB, so testing this endpoint can lock out and falsely email real
operators.

**Why this matters:** a DB-state restore can undo `is_active`, but it cannot
un-send an email. So the only safe way to exercise the global sweep is to make
the server itself unable to send mail.

**How to apply when writing/maintaining these tests:**
- Run the suite through a CI harness that starts the server with email disabled
  (unset `RESEND_API_KEY` — that alone makes `sendEmail` a no-op mock). Don't
  expose a convenience script that points the suite at a live-email server.
- Platform admins can't be created over HTTP without an existing admin token
  (chicken/egg), so seed throwaway admins directly via `pg` with
  `must_change_password=false` (else the admin router's gate 403s), then log in
  to get a real token.
- After the sweep, re-activate any returned id you did NOT seed (real dormant
  admins the global sweep caught), and verify the restore took.
