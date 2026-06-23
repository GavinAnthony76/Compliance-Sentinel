---
name: Invoice number allocation
description: The durable decision for how per-company invoice numbers are generated safely under concurrency.
---

# Per-company invoice number allocation

Invoice numbers (`INV-NNNN`) are scoped per company and must be unique and
gap-free even when two creates race.

**Never** allocate with `SELECT MAX(...) ... FOR UPDATE` — Postgres rejects
row-locking on an aggregate ("FOR UPDATE is not allowed with aggregate
functions"), 500ing every create; and a standalone `FOR UPDATE` releases its
lock before a separate INSERT, so it never prevents the race anyway.

**The decision:** allocate inside a transaction that first takes a per-company
`pg_advisory_xact_lock` (held to COMMIT), then reads MAX and inserts. The lock
serializes same-company creates deterministically — gap-free, no retry spinning.
A `UNIQUE(company_id, invoice_number)` constraint stays as a final backstop.

**Why advisory lock over a retry-on-23505 loop:** a fixed retry loop can exhaust
under heavy same-company bursts (all collide on the same MAX+1) and 500 with no
functional reason. The lock removes the collision instead of racing on it.

**Gotchas:**
- The numeric extraction must tolerate legacy/non-numeric values, or
  `CAST('' AS INTEGER)` throws and bricks allocation for that company. Use
  `MAX(NULLIF(REGEXP_REPLACE(invoice_number,'[^0-9]','','g'),'')::int)`.
- Every creation path (manual create AND appointment-completion auto-invoice)
  must go through the shared helper — don't reinvent numbering inline.
