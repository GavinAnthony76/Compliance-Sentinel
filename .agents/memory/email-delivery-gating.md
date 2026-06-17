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
call completing. The manual invoice send endpoint attempts delivery FIRST and
returns an error (and leaves status unchanged) when `delivered` is false; the
automation path only flips draft→sent when `delivered` is true. Fire-and-forget
sends (where status is a user-set field, e.g. direct invoice create with
status:"sent") may ignore the result, but never invent a "sent" state from a
failed/awaited send. Deterministic test hook: a customer with no email address
makes delivery impossible without any mail provider.
