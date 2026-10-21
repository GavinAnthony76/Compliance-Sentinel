# GitHub exchange and review workflow

## Verified facts versus approvals

- Local branch is **master**, not an assumed main.
- Local upstream configuration is origin/master.
- Origin is on GitHub at `GavinAnthony76/Compliance-Sentinel`; the name does not match GreenSynk.
- Remote HEAD advertises master, commit `6acb43cb99a54ff81522492008e53b8f08f55838`.
- Inspected local source baseline is `86c5de465bef127b11acd4e07041e048a1987c6f`.
- Those commits differ; ancestry/conflict status was not established.
- Replit/internal backup and numerous task-agent remotes/branches also exist. Do not delete, replace, or repurpose them.
- No existing CLAUDE.md or checked-in GitHub workflow directory was found before this handoff.
- GitHub protections, reviewer requirements, default-branch settings beyond advertised HEAD, write permission, and external deployment automation were not queried through authenticated repository administration.

**Confirmed strategy:** isolated Claude feature branches, reviewed PRs, non-production integration validation in Replit, and a separate manual production approval. **Not configured by this assignment:** repository protection, branch creation, commits, pushes, merges, CI, or deployment triggers.

## Required human setup before first push

1. Confirm the existing origin is the correct exchange repository or explicitly authorize a repository change.
2. Reconcile local baseline versus remote master without reset, force push, or overwriting either history.
3. Commit/review the handoff docs through the established repository process and record the approved handoff SHA.
4. Protect master with review approval and required status checks where supported. Restrict direct pushes; prohibit force push and branch deletion.
5. Decide whether a dedicated non-production branch is needed. Recommended name: `integration/claude`, **proposed, not currently created**.
6. Verify master/integration/feature pushes and PRs cannot invoke unapproved production publishing or production migrations. Platform-side automation may not appear in the repository.
7. Give Claude only required feature-branch permissions. Do not give production secrets or deployment authority.

## One issue per branch

Branch examples, to use only after the approved base exists:
- `claude/fix-220-tenant-isolation`
- `claude/fix-217-payment-concurrency`
- `claude/fix-222-estimate-signatures`

Do not merge convenience UI changes with payment fixes. The existing master convention remains unless a human approves a change.

## Exact lifecycle

### A. Establish base in Replit

The reviewer checks `git status --short`, `git branch --show-current`, `git rev-parse HEAD`, and the intended remote. Preserve unrelated work. Review baseline/handoff docs and record an approved commit. Do not tell Claude to start at “latest” without a SHA.

### B. Claude’s isolated checkout

After approval:

```sh
git status --short
git remote -v
git fetch origin
git switch --detach APPROVED_HANDOFF_SHA
git switch -c claude/fix-220-tenant-isolation
```

`APPROVED_HANDOFF_SHA` is an explicit operator-supplied value, not a verified current commit or a command to execute verbatim. Review remote output privately; do not paste credential-bearing URLs.

Install from the lockfile, provision disposable dependencies, reproduce relevant baseline behavior, write the focused regression, make the narrow change, and run the agreed validation. Never amend shared history to hide failed attempts.

### C. Reviewable commit and PR

Inspect `git diff --stat` and `git diff --check`; review the actual diff for secrets/generated binaries/unrelated changes. Stage explicit approved files rather than all files indiscriminately.

```sh
git add EXPLICIT_REVIEWED_PATHS
git commit -m "Fix property creation tenant ownership validation"
git push -u origin claude/fix-220-tenant-isolation
```

The paths are intentionally operator-selected, not a fabricated known file list. Push **only** the feature branch. Open a PR against the human-approved integration target; if no PR tooling is available, provide a compare link and completion report. No automatic merge.

### D. Human review and Replit integration

Review diff, baseline delta, tests, security impact, database changes, and rollback. Approve the PR only when scope matches the selected issue.

Prefer a separately approved non-production integration branch/workspace. With a clean Replit working tree and verified non-production automation route:

```sh
git fetch origin
git switch integration/claude
git pull --ff-only origin integration/claude
git rev-parse HEAD
```

These commands are **conditional instructions for a branch not yet created**. If the branch does not exist or a fast-forward is impossible, stop; do not reset, rebase shared history, or force merge. Do not run this assignment’s integration steps now.

Review any merge/setup hooks before executing them, especially `scripts/post-merge.sh`, which attempts schema writes. Install frozen dependencies, run the non-production integration checklist in VALIDATION.md, then perform human workflow acceptance.

### E. Production approval

Production publishing is a separate human decision after successful Replit validation. Claude’s responsibility ends at the tested PR/comparison and completion report. No webhook, push hook, CI job, or branch merge may bypass this boundary.

## PR completion report

Every PR must include:

- **Task:** reference and selected scope.
- **Initial condition:** reproduced issue and baseline comparison.
- **Files changed:** explicit list.
- **Implementation:** plain-English change.
- **Tests:** exact commands, results, skips, and failures.
- **Regression review:** related behavior and roles checked.
- **Database impact:** migration/data compatibility or none.
- **Security impact:** access control, payment ownership, sensitive operations.
- **Replit requirements:** configuration/integration needs.
- **Known limitations:** unverified behavior and blockers.
- **Rollback:** safe reviewed reversal.
- **Review status:** ready for human review; not approved for production.
