# Claude’s standing engineering instructions

## Authority and scope

You are working on GreenSynk, an existing application, not a greenfield replacement. The handoff does not authorize implementation of the whole backlog.

Replit remains the development/integration-validation/publishing environment. GitHub is the versioned exchange. Work independently only in an approved isolated feature branch, one selected issue or tightly related issue set per PR. Humans review before integration and separately approve production publishing.

Read README.md, BASELINE.md, BACKLOG.md, GIT-WORKFLOW.md, REGRESSION-GUARDRAILS.md, VALIDATION.md, and the relevant subsystem documents before editing.

## First response before development

Report:
- Repository identity and whether the owner approved the existing mismatched repository name.
- Current commit/branch and the approved handoff/base SHA.
- Working-tree state and selected issue.
- Reproduced source condition versus historical task description.
- Disposable database/provider setup and tests you can run safely.
- Baseline failures you expect and any blockers.

Stop if approval, safe environment, correct base, or scope is missing. Archived #222/#223 references must remain traceable; do not assume archived means implemented or rejected.

## Mandatory restrictions

- Do not publish, deploy, change production settings/secrets, trigger production CI/migrations, or modify live billing configuration.
- Do not initiate live charges/refunds or use production financial/customer records for tests.
- Do not send real fixture emails/SMS or use the production storage bucket.
- Do not merge directly into protected master or auto-merge a PR.
- Do not force-push, reset shared history, reinitialize the repository, or replace origin silently.
- Do not drop/truncate/overwrite data, delete modules/directories, remove working features, or run unrelated OS administration without explicit approval.
- Do not introduce breaking APIs/schema/configuration, significant architecture changes, or major dependency upgrades without approval.
- Never put secrets, tokens, passwords, signed URLs, customer records, or database connection strings in source, reports, PRs, or chats.

## Required development method

1. Read actual affected source and tests. Verify the issue exists; do not trust historical backlog wording alone.
2. Identify behavior and users/roles/data relationships to preserve.
3. Add a focused regression demonstrating the issue safely.
4. Make the smallest correction, retaining established structure and API conventions.
5. Run focused tests, broader safe checks, package typechecks/builds, and relevant manual acceptance.
6. Compare results with BASELINE.md; report pre-existing, environmental, new, and unresolved failures separately.
7. Inspect diff for unrelated changes, secrets, generated output, dependency churn, and schema effects.
8. Commit/push only the feature branch after repository/automation approval; prepare a PR and full completion report.
9. Stop at “ready for human review.” This is never equivalent to production approval.

Do not weaken tests, disable real-send suppression, insert production credentials, or remove an artifact to obtain a green result.

## High-risk invariants

- Validate authenticated tenant ownership for parent and linked foreign IDs.
- Keep company/admin/portal sessions and caller Authorization separate.
- Preserve claim ownership tokens and millisecond-compatible comparisons.
- Keep subscription billing, Connect portal payments, and platform-context saved-card charging distinct.
- Preserve webhook authenticity, reconciliation, idempotency, and receipt/owner dispatch.
- Await critical external I/O before responding where required under autoscale.
- Respect SMS category/subject consent and test-mode suppression.
- Preserve delivery-gated sent state, owner-recipient fallback, hashed estimate tokens, private-object ownership, and PDF SSRF protections.
- Do not run app startup against live data casually: worker imports can immediately write.

## Portability

Use the existing pnpm lockfile and documented Node/pnpm versions. Replit runtime identity, managed connectors, AI proxy, storage, artifact routing, and production secrets are not portable through Git. Use isolated equivalents/stubs and document gaps instead of silently swapping major infrastructure.

No checked-in database migration history was found. Database push is a write, not a check. Production migration approval is separate from code approval.

## Completion report template

**Task:** reference and description.

**Initial condition:** verified source/runtime issue and baseline.

**Files changed:** explicit list.

**Implementation:** minimal correction and why.

**Tests:** commands, results, skips, warnings, and failures.

**Regression review:** existing workflows, roles, and side effects checked.

**Database impact:** none or separately reviewed migration/compatibility.

**Security impact:** tenant/auth/payment/sensitive-operation effects.

**Replit requirements:** configuration/integration/deployment dependencies.

**Known limitations:** assumptions and unverified paths.

**Rollback:** safe reversible procedure and irreversible side effects.

**Review status:** ready for human review; not approved for production.
