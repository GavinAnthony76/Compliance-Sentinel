# REVIEW-A — Identity and subscription policy matrix

Status: **review complete; policy decisions required.** No behavior was changed. The tests listed below pin current behavior, including every fail-open path, so that each policy decision lands as a deliberate, reviewed test change.

Sources reviewed: `artifacts/api-server/src/lib/auth.ts`, `src/lib/subscription.ts`, `src/routes/index.ts` and every `src/routes/*.ts` mount, `src/routes/admin-auth.ts`, `src/routes/customer-portal.ts` (`requirePortalAuth`, `/auth/send-invite`), `src/routes/team.ts`, and the `users`, `platform_admins` and `companies` schemas.

## Tests added

| Test | What it pins |
| --- | --- |
| `tests/auth-policy-characterization.test.mjs` (mocked, in `run-all-ci`) | Fault injection on the real `requireAuth`, `requireAdminAuth` and `requireActiveSubscription`: missing, malformed and wrong-type tokens; password-change revocation; deactivated, deleted and demoted principals; DB lookup failures; missing and suspended companies; all subscription states. Also a static router-mount matrix: adding or removing a router-level guard fails the test until this document's lists are updated. |
| `tests/auth-revocation-characterization.e2e.mjs` (access group, disposable DB) | Live proof of A1 and A4: a deactivated staff member cannot log in again, but their existing token still reads **and writes**; a demoted admin's old token still passes `requireRole("owner","admin")`. |

## Middleware behavior matrix

| Case | `requireAuth` (company) | `requireAdminAuth` (platform) | `requirePortalAuth` (portal) | `requireActiveSubscription` |
| --- | --- | --- | --- | --- |
| No or malformed bearer | 401 | 401 | 401 | — (relies on auth guard) |
| Wrong token type or secret | 401 | 401 | 401 | — |
| Token issued before password change | **401** | not checked | not checked | — |
| Principal deactivated (`is_active=false`) | **allowed — A1** | **allowed — A5** | not checked | — |
| Principal deleted (no row) | **allowed — A2** | **allowed — A5** | not checked | — |
| Role changed since token issued | **token role used — A4** | token role used | n/a | — |
| Identity DB lookup throws | **allowed (fail-open) — A3** | no lookup | no lookup | — |
| Company suspended (`companies.is_active=false`) | not checked | n/a | login and invites refuse; existing tokens not checked | **allowed — A8** |
| Company row missing | not checked | n/a | — | **allowed — A6** |
| Subscription DB lookup throws | — | — | — | **allowed (fail-open) — A7** |
| GET request | — | — | — | always allowed (read access by design) |
| Trial expired, canceled, or past_due beyond 7 days (writes) | — | — | — | 402 |

Token lifetimes: company users 7 days, platform admins 4 hours, portal tokens stateless.

## Router mount matrix

**Router-level identity guard:** every company router except those below.

**No router-level identity guard (reviewed):**
- `admin-auth`, `auth`, `contact`, `health`, `plans`, `platform`, `public-booking`, `public-estimates`, `public-reviews`, `sms-webhook`: public, webhook or login endpoints.
- `customer-portal`, `sms-consent`: per-route `requirePortalAuth`. `sms-consent /company/opt-in` uses per-route `requireAuth`.
- `storage`: per-route `requireAuth`, except the public-objects GET.
- `customer-portal POST /auth/send-invite` verifies a company token inline. It skips the token-type check and the password-change revocation that `requireAuth` performs (**A9**).

**Authenticated but writes not subscription-gated:** `activity`, `appointment-photos`, `autopay`, `billing`, `communications`, `dashboard`, `routes-mgmt`, `settings`. `billing` and `settings` arguably must stay ungated, so a lapsed tenant can pay or fix their account. `appointment-photos`, `autopay`, `communications` and `routes-mgmt` write data and are probably unintentional gaps (**A10**).

## Findings and decisions needed

| # | Finding | Risk | Options (recommended first) |
| --- | --- | --- | --- |
| A1 | Deactivated company user keeps API access for up to 7 days | Ex-employee retains read **and write** access to customer data | Re-read `is_active` in `requireAuth`'s existing per-request user query and return 401. It's a single-row lookup that already runs. |
| A2 | Deleted user's token still works | Same as A1 | Treat a missing row as 401 in the same query. |
| A3 | User lookup failure fails open | During a DB outage, revoked tokens work. Failing closed returns 401 or 503 for everyone during an outage. | **503 `ServiceUnavailable`** (not 401, so clients don't log out), or keep fail-open with alerting. This is the availability-versus-revocation tradeoff the handoff says needs approval. |
| A4 | Role comes from the token | A demoted admin keeps admin powers for up to 7 days | Use the DB role from the same lookup and override `req.user.role`. |
| A5 | Platform admin tokens are never re-checked | A deactivated admin keeps platform powers for up to 4 hours, including over every tenant | Add a `platform_admins.is_active` lookup in `requireAdminAuth` (admin traffic is low volume). |
| A6 | Missing company row fails open in the subscription check | Low: orphaned token | 401 or 403. |
| A7 | Subscription lookup failure fails open | Lapsed tenants can write during a DB outage. Low financial risk. | Keep fail-open (availability), log it. |
| A8 | Platform suspension (`companies.is_active=false`) doesn't stop existing company sessions | A suspended tenant keeps working | Check `companies.is_active` in `requireAuth` (join on the existing lookup), but allow `billing` and `auth` so they can resolve the suspension. |
| A9 | `send-invite` reimplements token verification | A revoked token can still send portal invites | Mount `requireAuth` on that route. |
| A10 | Several data-writing routers aren't subscription-gated | Lapsed tenants can keep using those features | Decide per router. Keep `billing` and `settings` ungated. |

Implementation of any row should be its own PR, flipping the matching FINDING check in the tests above and adding allowed and forbidden e2e cases. Suggested order: A1+A2+A4 (one lookup, one PR), then A5, then A9, then A8 and A10, then the A3 and A7 failure policy.
