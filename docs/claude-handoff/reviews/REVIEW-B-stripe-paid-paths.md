# REVIEW-B — Stripe ownership, reconciliation and notification audit

Status: **review complete; corrections require approval.** No behavior was changed and no money moved; all evidence comes from mocked Stripe. `tests/stripe-paid-paths-characterization.test.mjs` (registered in `run-all-ci`) pins current behavior, and its **FINDING** checks flip when a correction is approved.

## Paid-transition inventory

| Path | Trigger | Money flow | Writes `paid` when | Guard on the write | Records method / PI | Notifications |
| --- | --- | --- | --- | --- | --- | --- |
| Manual mark-paid | `POST /invoices/:id/mark-paid` | none (offline) | always | `status NOT IN (paid, processing)` (after #3) | method from body | awaited, once |
| Portal Checkout webhook | `checkout.session.completed`, `source=customer_portal` | **Connect destination charge** to the company account, optional platform fee | `session.payment_status === "paid"` | `id = metadata.invoiceId AND status <> paid` | `card` + `payment_intent` | awaited, once |
| Portal confirm fallback | `POST /portal/invoices/:id/confirm-payment` | same as above | the stored session ID retrieves as paid | invoice owned by the portal customer + `updatedAt` claim token | **none** | awaited, once |
| Autopay charge | `POST /autopay/invoices/:id/charge` | **platform-context** PaymentIntent on the saved card; no `transfer_data` (intentionally distinct, per guardrails) | PI `succeeded` | `processing` claim + idempotency key `autopay-charge-inv-{id}-{cents}` | `card` + PI | awaited, once |
| Stuck-invoice sweep | `processing` older than 5 minutes | reconciles via `paymentIntents.search(metadata.invoiceId)` | a succeeded PI is found | `status = processing` + `updatedAt` claim token | `card` + PI | awaited, once |
| Subscription billing | `checkout.session.completed` with `plan` / `customer.subscription.*` / `invoice.*` | platform subscription | n/a (company status, not invoices) | n/a | n/a | billing-status emails |

**Verified protections:**
- The webhook signature is mandatory, so forged events are rejected with 400.
- Replays mark paid once and send one receipt.
- Confirm-payment refuses unpaid sessions and uses a server-stored session ID, never a client-supplied one.
- Autopay and the sweep use ownership tokens plus millisecond-truncated compares.
- Every genuine paid path dispatches both notifications, awaited.

## Findings

| # | Finding | Evidence | Risk | Recommended correction (needs approval) |
| --- | --- | --- | --- | --- |
| **B4** | The portal webhook overwrites a live autopay `processing` claim. Its guard is only `status <> paid`. | test: webhook takes the row mid-charge, the autopay charge still succeeds, and the second charge is recorded nowhere | **Double charge with no record of the second payment** if a customer pays in the portal while autopay runs | When the row is `processing`, don't overwrite it: record the portal payment for reconciliation (log + alert) and let the sweep or ops resolve. Alternatively, refuse portal checkout creation while `processing`. Coordinate with #3 and #5 semantics. |
| **B7** | If the Stripe client fails to initialize, the webhook returns `200 {received:true}` before any processing | test | Paid events are acknowledged but dropped. Stripe never retries, so the payment is recorded only if the customer triggers confirm-payment. | Return 5xx so Stripe retries (replays are already idempotent). |
| **B8** | Any exception while processing an event is logged, then answered with `200 {success:true}` | test (DB write failure) | Same loss as B7 for transient DB errors | Return 5xx on processing errors. Keep 2xx for intentionally ignored event types. |
| **B1** | Neither the webhook nor confirm-payment compares `amount_total` / `currency` with the invoice | test: a $100 invoice is marked paid by a €1.00 session | An invoice edited after checkout was created (PUT can change totals while `sent`) is marked paid at a different amount | Compare `amount_total === round(total*100)` and `currency === "usd"`. On mismatch, record and alert instead of marking paid. |
| **B2** | Confirm-payment doesn't set `paymentMethod` or the PaymentIntent ID (the session ID stays in `stripe_payment_intent_id`) | test | Reconciliation gap if the webhook never arrives | Set `paymentMethod: "card"` and `session.payment_intent`. |
| **B3** | The webhook paid update is scoped by `invoiceId` only, not `metadata.companyId` | test | Low: the metadata is created server-side and Stripe-signed. Defense in depth only. | Add `companyId` to the WHERE clause. |
| **B5** | Confirm-payment calls `checkout.sessions.retrieve` without try/catch | source | Stripe API errors become 500s instead of a retryable 503 | Wrap and return 503. |
| **B6** | Checkout PaymentIntents carry no `metadata.invoiceId` (only the session does) | source | The stuck-invoice sweep's search can't find portal payments. Today that's harmless because portal checkout never claims `processing`. | Copy the metadata into `payment_intent_data.metadata` if portal payments ever take a claim. |

**Not findings** (confirmed intentional per the handoff guardrails):
- Autopay charges in the platform context, while portal payments are Connect destination charges.
- The currency is hard-coded to USD.
- The autopay idempotency key includes the amount.

## Suggested PR order

1. B7 + B8: webhook error semantics. Small, and stops silent loss.
2. B4: needs your decision on portal-vs-autopay semantics.
3. B1 + B2 + B3 + B5: verification hardening on the existing paths.

Each should flip the matching FINDING checks and add sandbox or stub evidence. No live money.
