---
name: Replit DB migration (off Neon)
description: App now runs entirely on Replit-managed Postgres; how prod data was seeded and what remains to clean up
---

- App moved off Neon (quota lockout took prod down July 2026). lib/db and drizzle.config use ONLY `DATABASE_URL` now; NEON_DATABASE_URL is ignored by code (secret may still exist — agent cannot delete secrets, user must).
- Full Neon dump saved at `.local/db-migration/` (neon-full.dump PG17 custom format + plain SQL). Neon is PG17; local pg tools are v16 — use `nix shell nixpkgs#postgresql_17 -c pg_dump ...` for Neon.
- Prod data path: one-time startup bootstrap `api-server/src/lib/seed-import.ts` + embedded dump `src/seed/production-data.ts`; runs ONLY when `SEED_IMPORT_ON_EMPTY=1` (set in production env) AND companies/platform_admins/users all empty; advisory lock + transaction; fails startup closed on error.
- **After the post-migration publish is verified: delete seed-import.ts, src/seed/, the SEED_IMPORT_ON_EMPTY prod env var, and the index.ts wiring** — the embedded dump contains PII/password hashes and must not stay in the bundle.
- pg_dump ≥16.10 emits psql-only `\restrict`/`\unrestrict` lines and `SET search_path=''` — strip backslash lines before running via node-pg, and reset search_path on the pooled client afterwards or later queries fail "relation does not exist".
- CI harnesses no longer wipe the dev dataset: `useLocalTestDatabase()` (now async, must be awaited) redirects DATABASE_URL to `<db>_test` (auto-created, idempotent for nested runners).

**Why:** dev DATABASE_URL now holds the real development dataset; tests run destructive push-force + cleanup.
**How to apply:** any new e2e harness must `await useLocalTestDatabase()` before touching the DB; never point destructive setup at plain DATABASE_URL.
