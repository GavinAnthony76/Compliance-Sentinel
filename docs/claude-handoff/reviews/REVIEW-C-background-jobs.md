# REVIEW-C — Background job reliability under Autoscale

Status: **review complete; corrections require approval.** No behavior was changed. `tests/background-jobs-characterization.test.mjs` (registered in `run-all-ci`) pins current behavior, and its **FINDING** checks flip when a correction is approved.

Context: `src/app.ts` starts every job **in every process** at import time. A job runs on startup, then on an in-memory `setInterval`. Under Autoscale that means:
- several instances can run the same job at the same moment;
- an instance can be suspended or killed mid-run;
- **when no instance is awake, nothing runs.**

## Job inventory

| Job | Cadence | Claim / lock | Due state | Idempotency | Failure recording | Recovery | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Appointment 24h reminders (`lib/automations.ts` `startAutomationScheduler`) | 5 min, on each instance | **none**: select `reminder_sent=false` in a 24–25h window, fire, then set the flag | `reminder_sent` flag (set *after* firing) | none across instances | swallowed (`catch {}`) | none | **C1, C3** |
| Follow-up campaigns (`lib/follow-ups.ts` `processPendingFollowUps`) | 5 min | atomic `pending → processing` claim ✓ | `created_at + delay_hours` | the claim prevents double sends ✓ | final status write; errors swallowed | **none for `processing`** | **C2, C5** |
| Recurring appointments (`lib/recurring.ts`) | 1 hour | **none**: select-then-insert per slot, no unique key | `next_run_at` (advanced after the loop) | **none across instances** | swallowed | the next run continues from `next_run_at` ✓ | **C4** |
| Stuck-invoice release (`lib/stuck-invoices.ts`) | 5 min | per-row `status = processing` + `updated_at` ownership token ✓ | `updated_at` older than 5 minutes ✓ | guarded writes; Stripe reconcile first ✓ | logged warnings ✓ | defers on a Stripe failure ✓ | **sound** (see REVIEW-B) |
| Stale-admin lockout (`lib/stale-admins.ts`) | hourly check of a persisted daily cadence | **`pg_try_advisory_lock`** ✓ | last run from the activity log ✓ | lock + due check ✓ | logged + run record ✓ | watchdog below ✓ | **sound (reference pattern)** |
| Sweep-health watchdog (`lib/sweep-health.ts`) | 1 hour | atomic claim on a platform-settings marker ✓ | the 48h staleness check ✓ | 24h dedupe + per-incident claim ✓ | the claim is released for retry on total delivery failure ✓ | ✓ | **sound** |

## Findings

| # | Finding | Evidence | Impact | Recommended correction (needs approval) |
| --- | --- | --- | --- | --- |
| **C1** | Reminders have no claim: two instances in the same tick both select `reminder_sent=false` and both fire | source: the select, `fireAutomations`, then an unconditional flag update | **Duplicate reminder email/SMS to customers** | Claim first: `UPDATE appointments SET reminder_sent=true WHERE id=? AND reminder_sent=false RETURNING`, and fire only for claimed rows. If no rule exists, release the claim (preserves today's "enable later" behavior). |
| **C2** | A follow-up interrupted after its claim (instance suspended or killed, or the final write fails) stays `processing` forever | test: an interrupted run, then two more runs → still `processing` | **The message may or may not have been sent; it's never retried or surfaced** | Add a claim timestamp (schema change) or reuse a field. Release `processing` rows older than N minutes as `failed` + "interrupted" (not resent, to avoid duplicates) and surface them in the UI. |
| **C3** | All jobs only run while some instance is awake. The reminder window is a fixed 1-hour slot. | source | **A reminder is silently skipped** if no instance runs during that hour (scale-to-zero overnight) | Make reminders catch up: `scheduled_start` between now and +24h with `reminder_sent=false`, rather than the 24–25h slot. Longer term, an external scheduler pinging a guarded endpoint, which needs approval as an architecture change. |
| **C4** | Recurring generation has no lock or unique key: overlapping runs both see an empty slot and both insert | test: 2 concurrent runs → every slot duplicated (4 rows for 2 slots) | **Duplicate jobs on the schedule, possibly double-billed visits** | Wrap the per-plan work in `pg_try_advisory_xact_lock(plan_id)` (no schema change), or add a unique index on `(recurring_plan_id, scheduled_start)` (schema change, needs dedup of existing rows first). |
| **C5** | Follow-up emails are recorded `sent` (and a `sent` communication event is logged) even when `sendEmail` returns `delivered:false` | test | False "sent" history; violates the guardrail "do not mark sent unless delivery confirms it" | Check `EmailResult.delivered`, and record `failed` with the reason. |

## Suggested PR order

1. C5: a tiny change in `processLog`, no schema change.
2. C4: advisory lock per plan, no schema change.
3. C1 + C3: reminder claim plus catch-up window. Changes reminder timing semantics, so it needs your approval.
4. C2: needs a claim timestamp (schema) or an agreed stale-processing policy.

No queue-platform migration is proposed. The stale-admin sweep's lock + persisted due-check pattern is the in-repo model to follow.
