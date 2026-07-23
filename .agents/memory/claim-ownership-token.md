---
name: Claim ownership token for CAS reverts
description: Reverts of transient "processing" claims must match the claim's own updatedAt, not just status
---

Any writer that claims a row with a transient status (e.g. invoice "processing") and later reverts on failure must guard the revert by the exact `updatedAt` its claim wrote (returned via `.returning`), not just `status === "processing"`.

**Why:** A status-only revert can't tell whose claim it is releasing. Sequence: sweep releases a stale claim → a new writer re-claims → the old slow writer fails and its revert flips the NEW live claim back to chargeable — triple-charge window. Fixed in the autopay charge route; locked in by `tests/autopay-claim-ownership.test.mjs` (source assertions on `claimToken`).

**How to apply:** When adding new claim/revert flows (or touching the stuck-invoice sweep, which still has this gap between its stale-select and status-only updates — see follow-up), have the claim return `updatedAt` and include `eq(table.updatedAt, claimToken)` in the revert's WHERE. No schema change needed — updatedAt works as an optimistic version.
