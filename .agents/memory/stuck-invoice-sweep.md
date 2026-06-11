---
name: Stuck processing invoice sweep
description: Why interrupted autopay charges strand invoices and the safety rule for freeing them.
---
The autopay charge handler holds its "processing" claim and the captured prior
status IN MEMORY ONLY — a crash/restart mid-charge strands an invoice in
"processing" forever (unchargeable, never shown paid). A background sweep frees
these.

**Core rule:** reconcile with Stripe BEFORE reverting, and never revert without
a successful reconciliation.
**Why:** a charge may have actually succeeded before the interruption; blindly
reopening lets the customer be charged twice. This is the whole point of the
feature, so the failure paths must honor it too:
- Stripe client unavailable → defer the whole sweep (do NOT reopen).
- Stripe search fails for one invoice → defer that invoice, continue others.
- Only release after confirming no succeeded PaymentIntent exists.

**Other constraints:**
- Only sweep invoices stale beyond a safe window (~5 min); a normal charge is
  seconds.
- The invoice schema has no pre-charge-status column, so reconstruct the unpaid
  state on release (overdue if past due, else sent).
- Guard every write on status === "processing" to avoid racing a slow in-flight
  handler.
