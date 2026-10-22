# REVIEW-B — Stripe ownership, reconciliation and notification audit

Status: **B1, B2, B3, B4, B5, B7 and B8 corrected** per the approved priorities, in the PR that adds `src/lib/payment-reconciliation.ts`. B6 is open: harmless today, revisit if portal payments ever take a claim. `tests/stripe-paid-paths-characterization.test.mjs` (registered in `run-all-ci`) now asserts the corrected behavior. All evidence comes from mocked Stripe, and no money moved.

### Approved corrections, as implemented

- **Retryable failures (B7/B8):** the webhook answers 503 when the Stripe client can't start, and 500 on any processing error. It never acknowledges a payment it didn't record. Every handler is replay-safe.
- **No overlapping charges (B4):**
  - Portal pay refuses a `processing` invoice.
  - Portal pay reuses the invoice's recorded open Checkout session instead of opening another; at most one open session per invoice is ever recorded.
  - If portal pay can't record a new session, it expires it and never returns its URL.
  - Autopay, after taking its claim, expires the recorded open session before charging. If that session already completed or can't be closed, it releases the claim without charging.
  - A portal payment arriving while autopay holds the claim gets 503, and Stripe redelivers once the claim resolves.
- **Additional payments are durably recorded:** a second successful payment for an already-paid invoice (webhook with a different PaymentIntent, or an autopay success after another payment) is written to the activity log as `invoice.payment_flagged` and logged at error level. It is never discarded and never refunded automatically. The flag write is not best-effort; if it fails, the webhook returns 5xx so Stripe retries.
- **Verification (B1/B3):** before marking paid, the webhook and confirm-payment require `amount_total` = invoice total in cents, currency `usd`, `metadata.companyId` = invoice company, and `metadata.invoiceId` = invoice. On a mismatch the webhook records a flag and doesn't mark paid; confirm-payment answers 409 and leaves recording to the webhook.
- **Consistent recording (B2/B5):** confirm-payment stores `paymentMethod: "card"` and the session's PaymentIntent, and answers 503 on Stripe lookup errors.
- **Money flows unchanged:** Connect destination charges for the portal, platform context for autopay.

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
