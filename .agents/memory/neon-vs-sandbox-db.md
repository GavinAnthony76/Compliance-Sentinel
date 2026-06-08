---
name: NEON vs sandbox database split
description: The running app and drizzle push use a different Postgres DB than the code_execution sandbox / psql $DATABASE_URL — seed and verify against the right one.
---

# NEON vs sandbox database split

The API runtime (`lib/db/src/index.ts`) and `pnpm --filter @workspace/db push` both
connect using `NEON_DATABASE_URL` (falling back to `DATABASE_URL`). But the
code_execution `executeSql` helper and a plain `psql "$DATABASE_URL"` connect to a
**different** Postgres instance.

**Why:** Two distinct databases are provisioned in this repl; `NEON_DATABASE_URL` is the
one the app actually reads/writes. Seeding or verifying via the sandbox DB silently
edits rows the app never sees, which looks like "my seed didn't take."

**How to apply:** For any seed/verify/inspect of data the running app uses (e.g.
platform_admins, tenant tables), use `psql "$NEON_DATABASE_URL"`. Only trust
`NEON_DATABASE_URL` results when reasoning about app behavior.

Related: bcryptjs (cost 12) is the app's password hasher but is NOT installed at the
sandbox/repo root — generate hashes via `cd artifacts/api-server && node -e "require('bcryptjs')..."`.
