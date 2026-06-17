---
name: Email delivery gating for invoice status
description: Why invoice "sent" status must be gated on a real delivery signal, and how the email send contract reports it
---

# Email delivery must gate invoice "sent" status

`sendEmail` (and `sendInvoiceEmail`) return `EmailResult { delivered, reason }`.
A missing provider key, a provider rejection, or a thrown error all yield
`delivered: false` — they are NEVER thrown and NEVER silently treated as success.
`dispatchInvoiceEmail` returns that `delivered` boolean.

**Why:** Email helpers historically swallowed every failure and returned void, so
`dispatchInvoiceEmail` returned `true` regardless. Any caller that marked an
invoice "sent" on that boolean (automation auto-invoicing, manual send endpoint)
would record a "sent" status for an email that never went out — status that lies
about reality. A code review blocked the task on exactly this.

**How to apply:** Any flow that ties persisted state to an email actually being
delivered MUST gate on the `delivered` boolean (or the `EmailResult`), not on the
call completing. EVERY invoice "sent" transition is gated: create
(`POST /invoices` with status:"sent" persists as draft, promotes to sent only if
delivered), update (`PUT /invoices/:id` defers the draft→sent flip until
delivered), manual send (`POST /invoices/:id/send` attempts delivery first and
502s `EmailDeliveryFailed` with status unchanged on failure), and the automation
auto-invoice path. None of these are fire-and-forget — a failed/awaited send must
never invent a "sent" state. Deterministic test hook: a customer with no email
address makes delivery impossible without any mail provider.
