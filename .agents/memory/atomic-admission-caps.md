---
name: Atomic admission caps
description: Per-entity "max N pending rows" caps must be enforced atomically, not count-then-insert.
---
Rule: any "reject when a customer/company already has N open rows" check must run inside a transaction holding `pg_advisory_xact_lock(hashtext('scope:' || id))` before count+insert.

**Why:** a plain count-then-insert races — concurrent POSTs all see < N and all insert; completion code review rejects that as a cap bypass. The IP rate limiter can't backstop it (it's disabled under NODE_ENV=test and allows bursts anyway).

**How to apply:** lock keyed on the capped entity so other entities aren't serialized; commit before sending notification emails; e2e-prove with 6–10 `Promise.all` parallel POSTs asserting exactly N 201s + rest 429 and no excess rows. Mocked unit suites need the fake db to expose `transaction`/`execute`.
