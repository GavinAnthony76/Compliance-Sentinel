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

## The same race also threatens the Stripe CHARGE, not just notifications

The transition-guarded update above only protects the *post-charge* DB write +
emails. The actual `stripe.paymentIntents.create` (autopay) and
`stripe.checkout.sessions.create` (portal pay) happen BEFORE that update, gated
only by a pre-read `if status==='paid'` — so two concurrent unpaid-invoice
requests can both reach Stripe and double-charge.

**Rule:** before initiating any Stripe charge, serialize at the row level.
- Autopay immediate charge: CLAIM the invoice first with a conditional update
  `SET status='processing' WHERE id=? AND status NOT IN ('paid','processing')
  RETURNING id`. Zero rows back ⇒ another request won the claim (return 409
  ChargeInProgress) or it's already paid (400 AlreadyPaid). Only the claim
  winner calls Stripe; revert to the prior status on any non-success outcome so
  the invoice can be retried. `processing` is a transient text status (no enum),
  invisible to the `paid`-only reporting/dashboard filters.
- Portal checkout-session creation: do NOT use a `processing` claim (the
  customer may abandon the session, wedging the invoice). Instead pass a stable
  Stripe `idempotencyKey` (`portal-checkout-inv-<id>-<amountCents>`) so
  concurrent/retried creates return the SAME session. Add the same key style to
  autopay's PaymentIntent create as defense-in-depth.

**Black-box test limit:** `tests/payment-access.e2e.mjs` can't reach Stripe (no
saved card / no Connect), so concurrent requests short-circuit at the pre-charge
guard. The concurrency check there asserts the *safety invariants* (≤1 success,
no 5xx, invoice never left `paid` or stuck `processing`), not the claim's
mutual-exclusion path itself.
