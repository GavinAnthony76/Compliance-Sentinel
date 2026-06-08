---
name: Portal fetch monkey-patch collision
description: The global fetch override in App.tsx injects the company JWT on every /api/ request, which silently clobbers the portal token unless guarded.
---

## Rule
The `window.fetch` monkey-patch in `App.tsx` injects `greensync_token` as `Authorization` on every `/api/*` call. Portal pages set their own `Authorization: Bearer <portalToken>` explicitly. Without a guard, the company token overwrites the portal token, causing `/api/portal/auth/me` to 401.

**Fix applied:** Before injecting, check `existingHeaders['Authorization'] || existingHeaders['authorization']`. If present, call `originalFetch(resource, config)` unchanged so the caller's token wins.

**Why:** A business owner testing the portal in the same browser has `greensync_token` in localStorage. Every portal auth call was silently authenticated as the company, which `requirePortalAuth` correctly rejected.

**How to apply:** Any new fetch calls to portal endpoints from within the React app must pass `Authorization` explicitly in the headers object (not via a `Headers` instance constructed post-monkey-patch) so the guard detects them. `usePortalAuth.portalFetch` already does this correctly.
