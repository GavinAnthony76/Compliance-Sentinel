---
name: Company notification recipient
description: How company-directed notifications resolve their recipient and why company.email alone is unsafe to gate on
---

# Company notification recipient

Company-directed notifications (booking requests, portal cancellations, etc.) must resolve their recipient via `resolveCompanyNotificationEmail(companyId, company.email)` in `artifacts/api-server/src/lib/notifications.ts`, which falls back to the company **owner's** email when `companies.email` is empty.

**Why:** `companies.email` was historically NOT populated at registration, so any send gated on `if (company.email)` silently no-op'd for self-serve signups — booking/cancel notifications never reached the business. Register now defaults `companies.email` to the owner's email, but pre-existing companies may still have it null.

**How to apply:** Never gate a company-directed email on `company.email` alone. Always route through `resolveCompanyNotificationEmail`. Call sites: portal booking + cancel (customer-portal.ts), public-booking.ts. If `companies.email` becomes editable in settings, the explicit value takes precedence over the owner fallback.
