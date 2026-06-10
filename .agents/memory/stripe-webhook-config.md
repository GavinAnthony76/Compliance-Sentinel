---
name: Stripe live webhook configuration
description: How the single live Stripe webhook endpoint is wired and the event-name gotcha.
---

## Single endpoint, shared signing secret
There is ONE live webhook_endpoint object in Stripe. Its URL must be the
DEPLOYED production domain: `https://greensynk.com/api/billing/webhook`. It was
once misconfigured to the dev `.replit.dev` URL, which silently breaks live
subscription activation (Stripe posts events to the dev workspace, not prod).

**Repoint by PATCHing the existing endpoint's `url`** (POST to
/v1/webhook_endpoints/<id> with url=...). Reusing the same endpoint object keeps
the signing secret, so `STRIPE_WEBHOOK_SECRET` stays valid — do NOT create a new
endpoint (new secret would require an env change in the deployment).

## Event-name gotcha
The endpoint emits `invoice.payment_succeeded` (NOT `invoice.paid`). The handler
switch in billing.ts must catch `invoice.payment_succeeded`; relying only on a
`case "invoice.paid"` means that branch never fires. Both are handled as a
fall-through now.
**Why it's low-severity if missed:** the invoice case only sets
`subscriptionStatus`; `currentPeriodEnd`/`cancelAtPeriodEnd` come from the
`customer.subscription.created/updated` handlers, which are also enabled.

## Go-live reminder
Repointing the URL is instant, but any handler CODE change only takes effect
after the app is RE-PUBLISHED (prod runs the deployed build, not dev).
