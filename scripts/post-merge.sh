#!/bin/bash
set -e

pnpm install --frozen-lockfile

# Sync additive schema changes to the database automatically.
#
# drizzle-kit prompts for confirmation before any DESTRUCTIVE (data-loss)
# change. post-merge runs non-interactively (stdin is closed), so such a
# prompt would otherwise hang until the timeout and fail the whole setup.
#
# We deliberately do NOT pass --force: the shared database must never be
# auto-dropped by an unattended merge. If the push can't complete cleanly
# because it requires a destructive change, we log it and continue so the
# merge isn't blocked. The destructive change can then be reviewed and
# applied manually.
if ! timeout 30 pnpm --filter db push; then
  echo "WARN: 'db push' did not complete cleanly (likely a destructive/data-loss diff that needs manual review). Continuing without applying it."
fi
