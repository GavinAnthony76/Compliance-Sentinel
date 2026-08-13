---
name: updatedAt token guards need ms-truncated compare
description: Claim-ownership guards comparing an observed updatedAt must truncate microseconds or they never match DB-written rows.
---
Rule: when a write is guarded by "updatedAt equals the value I read" (claim-ownership token), compare with `sql\`date_trunc('milliseconds', col) = ${token}\``, not `eq(col, token)`.

**Why:** Postgres `defaultNow()` stores microseconds; drizzle returns a JS Date truncated to milliseconds. A raw equality against the read-back Date never matches a row whose updatedAt was DB-written, so the guarded write silently no-ops (e.g. payments never marked paid). Tokens written from JS `new Date()` match either way.

**How to apply:** any new select-then-update writer adopting the ownership-token pattern (autopay/sweep/portal invoice writes). Also: in-memory drizzle mocks in tests must make `sql` tagged templates return a callable row predicate modeling the ms compare.
