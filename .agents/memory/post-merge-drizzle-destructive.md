---
name: post-merge drizzle destructive-diff hang
description: why post-merge db push can hang/block merges, and the safe non-force handling
---

# Post-merge `drizzle-kit push` hangs on destructive diffs

`scripts/post-merge.sh` runs `pnpm --filter db push` (drizzle-kit) after every
task merge. drizzle prompts before any DATA-LOSS change (e.g. "You're about to
delete <table>"). post-merge runs non-interactively (stdin closed), so that
prompt stalls until timeout and the whole setup fails — surfacing to the user as
"changes won't go through / git won't push".

**Root cause of the drift:** an in-flight task agent can create a table directly
in the shared NEON DB (during its own dev `push`) BEFORE its code is merged. Main's
schema doesn't define that table yet, so the post-merge push for *other* merges
sees an "extra" table and wants to DROP it. It reconciles cleanly once the owning
task merges and brings the table definition into the schema.

**Fix / rule:** do NOT switch post-merge to `--force` (the skill's default
suggestion) — `--force` would auto-drop tables on the shared/prod DB and destroy
in-flight task data. Instead wrap the push so it never hangs and never drops:
`if ! timeout 30 pnpm --filter db push; then echo WARN...; fi`. Additive changes
still apply automatically; a destructive diff is skipped + logged for manual
review, and the merge is never blocked.

**Why:** the shared NEON DB is effectively prod; unattended merges must never
auto-drop. Also bumped post-merge `timeoutMs` to 60000 (was 20000) — `pnpm
install --frozen-lockfile` + schema pull alone ran ~18s, leaving no headroom.

**How to apply:** if a merge's post-merge log shows a drizzle data-loss prompt,
it's almost always an orphaned table from an unmerged task — let that task merge
(it adopts the table) rather than forcing a drop.
