---
name: Drizzle constraint-add truncate prompt
description: Adding a UNIQUE/NOT-NULL constraint to a populated table makes drizzle-kit push hang on an interactive prompt — even with --force.
---

# Adding a constraint to a populated table hangs drizzle-kit push

When the schema adds a UNIQUE (or NOT NULL) constraint to a table that already
contains rows, `drizzle-kit push` prints an interactive "Do you want to truncate
<table>?" prompt and blocks. **`--force` does NOT auto-answer it** — `push-force`
hangs there too. This stalls any non-interactive runner: the post-merge `db push`
and the CI harnesses (`test:access:ci` etc., which push-force against a local
test DB that accumulates rows across runs).

**Why:** the prompt only appears when the target table has rows AND the
constraint isn't present yet. On an empty table the constraint is added silently.

**How to apply:** before merging/running, pre-apply the *same* constraint
(matching the name drizzle generates) directly via `psql` to every DB that has
rows — prod (`$NEON_DATABASE_URL`) and the local test DB (`$DATABASE_URL`, a
DIFFERENT database). Once present, push sees no diff and never prompts. Check for
existing duplicate rows first or the ALTER fails.
