---
name: Admin billing-status overrides must not desync Stripe
description: When admin tooling writes companies.subscriptionStatus, never silently flip an active (paying) company.
---

# Admin billing-status overrides must not desync Stripe

**Rule:** Any admin action that writes `companies.subscriptionStatus` must treat `"active"` specially. A company in `active` is paying through Stripe and Stripe owns its billing lifecycle; locally flipping it to `trialing`/`canceled`/etc. desyncs the DB from Stripe until some future webhook happens to correct it (or never does), and changes access-gating in `lib/subscription.ts` in the meantime.

**Why:** The "extend trial by N days" admin endpoint originally set `subscriptionStatus = "trialing"` unconditionally, which would have downgraded paying customers. Caught in code review.

**How to apply:** For trial-extension / comp-style grants, only move *non-active* states (`trialing`/`past_due`/`canceled`/null) into `trialing`; leave `active` untouched (extend `trialEndsAt` only). If you ever need to pull a paying company off Stripe billing, do it through Stripe (cancel the subscription) so the webhook updates the DB — don't just rewrite the status column.
