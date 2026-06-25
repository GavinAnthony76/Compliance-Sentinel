---
name: Private object storage read-route auth
description: How private object-storage reads must be authorized, and why <img> needs blob fetch
---

# Private object storage must be auth + tenant-scoped

The scaffold's `GET /api/storage/objects/*` route ships with auth/ACL **commented out** (template boilerplate). Any feature that persists *private* objects there (e.g. appointment photos with `fileUrl = /api/storage/objects/...`) makes those objects world-readable by URL until you lock the route down.

**Rule:** the private object read route must `requireAuth` AND authorize against our own DB ownership records (look up the object's `fileKey` in the owning table scoped to `req.user.companyId`; 403 if not found). Do NOT rely on object-store ACL metadata — `objectAcl.ts` `ObjectAccessGroupType` enum is empty (group ACL unimplemented), and owner-only ACL would block company-wide access.

**Why:** tenant isolation. Private photos are company data; another tenant must never read them by guessing/leaking a URL.

**How to apply:** when adding any new private-object feature, extend the read-route authorization to also accept that feature's ownership table (currently only `appointment_photos`).

## Customer-portal object reads need OBJECT-level ownership, not just companyId
Portal byte-serving endpoints (e.g. `/api/portal/photos/:id/image`) must authorize down to the *logged-in customer*, not just `req.portal.companyId`. Scoping a portal read only by `companyId` is an IDOR: any portal customer can enumerate IDs and read a sibling customer's data within the same company.

**Rule:** after loading the object row (scoped by companyId), join through to the owning appointment/record and require `appointments.customerId === req.portal.customerId`; 404 otherwise. The list endpoints already do this — every byte-serving sibling must match.

**Why:** portal customers share a company tenant; companyId scoping alone does not isolate them from each other.


## Rendering authed images in the React app
`<img src="/api/storage/objects/...">` does NOT send the `Authorization` header (the app attaches the bearer token via a monkey-patched `window.fetch` in App.tsx, which native `<img>` requests bypass). So a locked-down route returns 401 for `<img>`.

**Fix:** render via an `AuthedImage` component that does `fetch(src, { headers: { Authorization } })` → `blob()` → `URL.createObjectURL`, and revokes the object URL on unmount. See `artifacts/lawn-saas/src/pages/tech.tsx`.
