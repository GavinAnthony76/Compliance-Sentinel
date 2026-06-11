#!/bin/bash
set -e

pnpm install --frozen-lockfile

# Sync schema changes to the database.
#
# drizzle-kit push prompts for confirmation before any DESTRUCTIVE (data-loss)
# change. post-merge runs non-interactively (stdin closed), so drizzle receives
# EOF on that prompt and aborts the push with a non-zero exit.
#
# We deliberately do NOT pass --force: the shared database must never be
# auto-dropped by an unattended merge (an "extra" table is usually owned by an
# in-flight task that hasn't merged its schema yet, and reconciles once it does).
#
# But we must not blindly swallow every failure either — a real problem
# (connectivity, auth, a broken migration) must still fail post-merge so the
# schema drift is surfaced. So: capture the result, continue ONLY when the
# failure is the known data-loss confirmation; fail fast otherwise.
set +e
push_output="$(pnpm --filter db push 2>&1)"
push_status=$?
set -e
echo "$push_output"

if [ "$push_status" -ne 0 ]; then
  if echo "$push_output" | grep -qiE 'data.loss|want to (remove|delete)|delete .* table'; then
    echo "WARN: 'db push' skipped a DESTRUCTIVE (data-loss) change that needs manual review. Continuing — the merge is not blocked."
  else
    echo "ERROR: 'db push' failed for a non-destructive reason. Failing post-merge so the schema drift is surfaced."
    exit "$push_status"
  fi
fi
