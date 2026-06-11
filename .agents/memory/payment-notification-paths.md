---
name: Invoice payment notification paths
description: An invoice flips to "paid" through several independent endpoints; payment notifications must fire once per real transition at every one.
---

# Invoice payment notification paths

An invoice in the api-server transitions to `status: "paid"` through **several
independent endpoints** (owner manual mark-paid, the Stripe portal-checkout
webhook, the portal client-side confirm-payment fallback, and the saved-card
autopay charge). A notification wired into only some of them silently misses
the others — grep `status: "paid"` / `dispatchOwnerPaymentNotification` to find
the full current set before changing one.

**Rule:** every "payment received" side-effect (customer receipt
`dispatchPaymentReceiptEmail`, owner alert `dispatchOwnerPaymentNotification`)
must be wired into ALL paid paths, and must fire **exactly once per real
status->paid transition**.

**Why:** the portal can confirm payment via the webhook OR the client fallback
(they race each other), Stripe retries/replays webhook events, and concurrent
manual/autopay calls can both pass a naive pre-read `if status==='paid'` guard.
Any of these double-sends owner + customer emails if notifications fire
unconditionally after the update.

**How to apply:** make the paid update itself the idempotency gate — conditional
update `WHERE id = ? AND status != 'paid'` with `.returning()`, and dispatch
notifications only when a row actually came back (the transition happened). Do
NOT rely on a pre-read status check followed by an unconditional update+notify;
that has a read-then-write race. For endpoints that must still return the
invoice when no transition occurred (e.g. mark-paid on an already-paid invoice),
re-select the row for the response but skip the notifications.
