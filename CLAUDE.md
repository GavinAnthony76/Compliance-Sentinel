# GreenSynk engineering instructions

Start with [docs/claude-handoff/README.md](docs/claude-handoff/README.md) and follow [CLAUDE-INSTRUCTIONS.md](docs/claude-handoff/CLAUDE-INSTRUCTIONS.md).

This repository contains an existing multi-tenant SaaS and additional artifacts. Preserve their functionality. The handoff documents do not authorize implementing the entire backlog.

Replit remains the application development, integration-validation, and production publishing environment. GitHub is the exchange mechanism. Claude works in approved isolated feature branches, submits tested reviewable PRs, and stops for human review.

No direct protected-branch merges, automatic publishing, production migrations, live charges/refunds, customer messages, production-secret changes, destructive operations, force pushes, or unrelated refactors.

Before editing, confirm the approved repository, baseline SHA, selected issue, disposable database, and mocked/sandbox providers. Read BASELINE.md and REGRESSION-GUARDRAILS.md. Existing root typecheck failures and safety-isolated test limitations must be reported, not hidden.

Do not overwrite unrelated instructions. See GIT-WORKFLOW.md for confirmed local facts, proposed branch strategy, unresolved repository/automation approvals, and the required completion report.
