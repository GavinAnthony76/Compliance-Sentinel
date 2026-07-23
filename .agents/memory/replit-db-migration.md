---
name: Replit DB migration (off Neon)
description: App now runs entirely on Replit-managed Postgres; how prod cutover was done and what guards exist
---

- App moved off Neon (quota lockout took prod down July 2026). lib/db and drizzle.config use ONLY `DATABASE_URL`; NEON_DATABASE_URL secret may still exist but is ignored (agent cannot delete secrets, user must).
- Full Neon dump backup at `.local/db-migration/` (neon-full.dump PG17 custom format + plain SQL). Neon is PG17; local pg tools are v16 — use `nix shell nixpkgs#postgresql_17 -c pg_dump ...` for PG17 servers.
- Prod cutover COMPLETE (July 2026): production Replit DB had stale pre-Neon demo data, so a guarded one-time replace mode (truncate + import, sentinel + immutable marker) ran on publish; verified real dataset live. Seed-import code, embedded dump, and env flags then REMOVED (dump contained PII/password hashes).
- Prod DB carries schema-comment marker `greensynk_seed_import_done` on the public schema (`COMMENT ON SCHEMA public`) — an immutable "migration done" flag; useful pattern for one-shot destructive bootstraps: never key destructive re-runs on mutable business rows alone.
- pg_dump ≥16.10 emits psql-only `\restrict`/`\unrestrict` lines and `SET search_path=''` — strip backslash lines before running via node-pg, and reset search_path on the pooled client afterwards or later queries fail "relation does not exist".
- CI harnesses no longer wipe the dev dataset: `useLocalTestDatabase()` (async, must be awaited) redirects DATABASE_URL to `<db>_test` (auto-created, idempotent for nested runners).

**Why:** dev DATABASE_URL now holds the real development dataset; tests run destructive push-force + cleanup.
**How to apply:** any new e2e harness must `await useLocalTestDatabase()` before touching the DB; never point destructive setup at plain DATABASE_URL.
