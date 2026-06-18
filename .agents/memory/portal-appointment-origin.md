---
name: Portal appointment origin gating
description: How GreenSynk distinguishes customer-booked vs company-scheduled appointments and who may cancel
---

# Portal appointment origin

`appointments.origin` (text, default `company`) marks who created a visit:
`company` (incl. recurring-generated) vs `portal_request` (booked by a customer
via the portal). Customers may cancel **only** `portal_request` rows.

**Why:** A portal customer being able to cancel company-scheduled or
recurring-generated visits is a real authorization gap (flagged in review). The
portal already shows a "contact the company to change a scheduled visit" banner,
so the Cancel control must agree with that policy.

**How to apply:** Enforce on BOTH surfaces — backend
`POST /portal/appointments/:id/cancel` returns 403 when `origin !== 'portal_request'`,
and the portal UI only renders Cancel when `apt.origin === 'portal_request'`.
Any new appointment-creation path must set `origin` correctly (company flows
rely on the DB default).
