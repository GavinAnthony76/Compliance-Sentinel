---
name: Autopay charge path vs Connect, and live-key test gating
description: How autopay invoice charging differs from portal pay re: Stripe Connect, and why positive-path autopay e2e must gate on sk_test_ keys.
---

# Autopay charge vs portal pay, and Stripe test-key gating

## Two different money paths
- **Autopay charge** (`POST /autopay/invoices/:id/charge`, src/routes/autopay.ts) bills the **platform** Stripe account directly via `paymentIntents.create` with `customer` + saved `payment_method`, `off_session: true`. It does **NOT** use Connect / `transfer_data`. So a connected account is NOT required for autopay to work.
- **Portal pay** (`POST /portal/invoices/:id/pay`, src/routes/customer-portal.ts) DOES require a connected account — returns `ConnectRequired` (and `transfer_data.destination`) when the company has no `stripeConnectAccountId`.

**Why it matters:** when writing/verifying autopay charge tests, don't gate on Connect — gate only on having a saved payment method + a usable Stripe key.

## Live keys in the workspace env → positive-path autopay tests must SKIP
- The workspace `STRIPE_SECRET_KEY` is a **live** key (`sk_live_…`), not test. Stripe rejects test artifacts (`pm_card_visa`, `tok_visa`) in livemode: "You cannot use the test ID … in livemode."
- **Therefore** any e2e that actually charges (autopay positive path) must detect test mode (`STRIPE_SECRET_KEY.startsWith("sk_test_")`) and gracefully SKIP otherwise — never fail. Charging a real card in tests is unacceptable. See `tests/payment-access.e2e.mjs` section "Autopay positive path".

**How to apply:** when adding any test that moves real money, branch on `sk_test_` and skip (log a SKIP line, add no checks) when keys aren't test keys, so the access-CI gate stays green in live-key environments.
