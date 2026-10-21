# GreenSynk engineering handoff

Prepared October 21, 2026. This package is an evidence-based handoff, not authorization to fix issues, change production, or publish.

## Start here

GreenSynk is an existing multi-tenant SaaS for lawn-care and outdoor-service businesses. It combines customer/property management, scheduling and field operations, estimates, invoices, homeowner payments, subscription billing, messaging, recurring work, and platform administration.

The controlling requirement is to preserve existing functionality. Replit remains the development, integration-validation, and production publishing environment. GitHub is the exchange mechanism. Claude works only in isolated feature branches. Humans review changes before they enter Replit, and publishing requires separate explicit human approval.

### Reading order

1. [Baseline and blockers](BASELINE.md)
2. [Architecture](ARCHITECTURE.md) and [feature inventory](FEATURE-INVENTORY.md)
3. [Prioritized backlog](BACKLOG.md)
4. [Database](DATABASE.md), [integrations](INTEGRATIONS.md), and [Replit environment](REPLIT-ENVIRONMENT.md)
5. [Regression guardrails](REGRESSION-GUARDRAILS.md) and [validation](VALIDATION.md)
6. [Git workflow](GIT-WORKFLOW.md), [rollback](ROLLBACK.md), and [Claude instructions](CLAUDE-INSTRUCTIONS.md)

## Evidence and scope

- Baseline source commit: `86c5de465bef127b11acd4e07041e048a1987c6f`.
- Inspected local branch: `master`; working tree was clean before this assignment.
- Documentation added during this assignment is not part of that baseline commit.
- Actual source and manifests were inspected. Task records and their dependency states were retrieved independently.
- Safe baseline checks were executed; results and environmental limitations are in BASELINE.md.
- Runtime production metadata reported a public, successfully built autoscale deployment at `https://greensynk.com`. This is metadata, not proof that every workflow works.
- No production database inspection, live payment, refund, customer message, repository push, merge, branch-protection change, or publishing operation was performed.
- Tests use an isolated disposable database through the existing guard. Test fixtures and cleanup are not equivalent to production verification.

## Deliverables

This directory contains the thirteen requested handoff documents. Repository-root `CLAUDE.md` points here. The downloadable archive includes these documents and the existing product guide and task list as historical supporting references.

The old `GREENSYNK_OVERVIEW.md`, `docs/GREENSYNK_PRODUCT_AND_TECHNICAL_GUIDE.md`, `docs/List of Tasks.md`, and `replit.md` provide context, but do not override verified source findings in this handoff. Notably, the historical public-estimate submission-abuse task does not match the currently registered estimate routes.

## Proposed first batch — awaiting approval

1. Approve the correct GitHub repository and protected branch/integration policy.
2. Restore a trustworthy validation baseline in a separate narrowly scoped branch: address existing typecheck failures without deleting tests or excluding working artifacts.
3. First application fix branch: #220, property creation tenant-ownership validation, with positive and cross-tenant regression tests.
4. Next independent branch: #217, manual invoice/payment-claim concurrency safeguards.
5. Then #222, public estimate token consistency across signing and PDF retrieval; preserve archived reference until accepted for work.

Do not combine these into one large payment, security, and UI refactor. No proposed development batch has been started.

## Outstanding approvals and blockers

- Confirm that the existing `origin` repository, whose name is not GreenSynk, is the intended exchange repository. Do not replace it silently.
- GitHub default branch, branch protections, required reviewers, credentials, and deployment automation are not established by local configuration alone.
- Approve a baseline documentation commit and record its SHA before Claude starts. The current source SHA is not a substitute for the later handoff commit.
- Confirm an integration branch cannot trigger production automation before permitting Claude to push.
- Establish isolated PostgreSQL and mocked providers outside Replit; managed integrations and storage do not become portable merely by cloning Git.
- Review pre-existing validation failures and missing migration history reported in BASELINE.md.
- Scope and approve any schema, dependency major-version, architecture, or production-affecting change separately.

## Exact initial instruction to Claude

Read repository-root CLAUDE.md and docs/claude-handoff/README.md, BASELINE.md, GIT-WORKFLOW.md, REGRESSION-GUARDRAILS.md, and CLAUDE-INSTRUCTIONS.md. Stop if the approved repository, baseline commit, isolated test database, or branch policy is not confirmed. Do not implement the whole backlog. First report your understanding, current commit, current branch, baseline comparison, and blockers. After a human selects one issue, create a new isolated claude/ feature branch from the approved base; add a regression test, make the smallest correction, run focused and broader safe checks, and submit a reviewable feature-branch PR. Never publish, merge into the protected branch, access production data for testing, send live messages, initiate live payments/refunds, or run destructive operations.
