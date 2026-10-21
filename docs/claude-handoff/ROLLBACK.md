# Safe rollback and recovery

## Principles

Rollback is not a single command. Source code, a deployed image, database schema/data, Stripe state, message delivery, and stored files have separate histories. A Git revert cannot undo an email, payment, signature, or data deletion.

Preserve existing working production until the integrated change has passed validation and received human publishing approval. This assignment did not create a production backup, change deployment, or test disaster recovery.

## Before accepting a PR

Record:
- Approved baseline and integrated commit SHAs.
- Explicit changed paths, dependencies, configuration names, and build commands.
- Database/schema impact and whether old code still works with new data.
- New worker/event/notification behavior and any side effects.
- A human-owned recovery path and operator with required access.
- Provider/payment ownership impact and supported reconciliation process.

Reject a “rollback plan” consisting solely of reset --hard, force-push, or dropping new tables.

## Feature-branch failure before merge

Keep the failing branch and test evidence. Stop integration; leave approved source/deployment unchanged. Submit a small corrective commit or close the PR after review. Do not force-push or rewrite shared history to hide failure.

## Integrated source failure before publishing

Use the reviewed Git workflow to create a corrective/revert PR. A normal revert commit can reverse an approved code change without resetting history, but must be reviewed for dependency/schema compatibility.

Do not run git revert on unknown local work, guess a merge parent, discard uncommitted changes, or use hard reset. If a merge cannot be safely reversed, report the precise blocker and ask the reviewer.

## Published regression

1. Human operator stops further release activity and assesses availability, financial side effects, and data impact.
2. Identify the last known working published build and matching code/configuration.
3. Use the approved Replit publishing/recovery controls and platform documentation under operator review.
4. Treat workspace checkpoint restore and published-image selection as distinct unless their relationship is confirmed.
5. Review any production database restoration separately. Never assume a checkpoint or code rollback reverses PostgreSQL/provider state.
6. Validate health and the affected workflow after any authorized recovery; preserve incident evidence without disclosing private data.

The platform offers checkpoints and rollbacks, but their exact content/retention and production consequences need operator confirmation. A future Replit Agent should consult current deployment/database guidance before a production recovery.

## Database changes

- Require a verified backup/restore procedure before a risky schema/data change.
- Confirm old-code/new-schema compatibility before reverting code.
- Never automatically run down migrations, drop/truncate, import an old full dump over live data, or force schema push.
- Backfill reversal is not necessarily safe if users wrote new data.
- Restoring a database may lose records created after the backup; explain that consequence and obtain explicit approval.
- A rollback involving production data is human-controlled; Claude has no authorization for it.

## Financial/message/storage side effects

- Do not issue a refund, new charge, transfer, or ownership rewrite to “undo a test.”
- Reconcile invoice states against Stripe’s verified state using the approved application process.
- Do not resend receipt/owner notifications blindly after code rollback.
- SMS/email cannot be recalled; preserve suppression and deduplication markers.
- Do not delete stored photos/documents to compensate for a code regression.

## Recovery exit criteria

The operator verifies expected commit/build, startup, authorization/tenant boundaries, financial state consistency, worker health, and the affected workflow. Record remaining uncertainty. Explicitly state which layers were restored and which were not; do not declare full recovery from an HTTP 200 alone.
