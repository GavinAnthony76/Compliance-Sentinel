---
name: Stripe Connect account mismatch
description: Replit Stripe connector uses a different Stripe account than the user's sandbox; how to resolve and keep in sync.
---

## The rule
Always set `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` secrets to the sandbox/test keys you actually want to use. The Replit Stripe connector (`stripe-replit-sync`) may be connected to a different Stripe account than the one where you've enabled Connect or created products.

**Why:** The Replit connector OAuth connects to whichever Stripe account was used at integration time. Stripe's new "sandbox" environments are isolated accounts with their own API keys — different from the connector account. `lib/stripe.ts` and `scripts/src/seed-stripe-products.ts` both check `STRIPE_SECRET_KEY` first and fall back to the connector.

**How to apply:**
1. After any Stripe account switch: update `STRIPE_SECRET_KEY` + `STRIPE_PUBLISHABLE_KEY` secrets.
2. Re-run `pnpm --filter @workspace/scripts run seed:stripe-products` to create products in the new account.
3. Update `STRIPE_STARTER_PRICE_ID`, `STRIPE_GROWTH_PRICE_ID`, `STRIPE_PRO_PRICE_ID` env vars with the new price IDs.
4. Restart the API server.

## Connect enrollment
Stripe requires Connect to be enabled on the SAME account as the API keys being used. To enable:
- Go to https://dashboard.stripe.com/connect (in the correct account/mode)
- Click "Continue setup" → may prompt "Switch to sandbox" — accept it for test mode
- Connect is now active; `stripe.accounts.create({ type: "express" })` will work

## Restricted keys (rk_) cannot do Connect onboarding
If `STRIPE_SECRET_KEY` is a **restricted key** (`rk_live_…`/`rk_test_…`), `connect/onboard` (both V2 `accounts.create`/`accountLinks.create` and the V1 Express fallback) fails with `StripePermissionError` 403: missing `rak_connected_account_write`, `rak_accounts_kyc_basic_read`, `rak_accounts_kyc_raw_bank_details_read`.

**Why:** restricted keys only carry the permissions explicitly toggled on them; Connect onboarding needs connected-account write + KYC reads that are off by default.

**How to apply:** use a **standard secret key** (`sk_live_…`/`sk_test_…`, full access) OR edit the restricted key (Dashboard → Developers → API keys → the rk → grant "Connect / Connected accounts: Write" + the account KYC reads). billing.ts now detects this and returns 403 `ConnectPermissionError` with an actionable message instead of a generic 500.

## Express onboarding test data
To get `charges_enabled: true` in test/sandbox mode, the company must complete Express onboarding with:
- SSN: `000-00-0000`
- DOB: `01/01/1901`  
- Phone: `(000) 000-0000`
- Bank: "Test (Non-OAuth)"
