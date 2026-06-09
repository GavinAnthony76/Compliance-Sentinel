---
name: TanStack resetQueries bypasses enabled:false
description: Why a 401 onError handler that resets the auth query loops forever, and the fix.
---

In TanStack Query, `queryClient.resetQueries(key)` and `refetch()` **force a fetch
even when the query has `enabled: false`** (`enabled` only governs *automatic*
fetching, not imperative ones).

**Why it bit us:** the global `QueryCache.onError` in `lawn-saas/src/App.tsx`
handled a 401 on the auth-me query (`['/api/auth/me']`, `['/api/admin/auth/me']`,
each `enabled: !!token`) by calling `resetQueries` on that same key. reset →
forced refetch → 401 → onError → reset → ... a tight loop (~20 req/sec) that
hammered the API and spammed the console with 401s.

**How to apply:** To clear an auth/session query on 401 inside an error handler,
use `queryClient.setQueryData(key, null)` (clears cached user → isAuthenticated
false → ProtectedRoute redirects to login) — never `resetQueries`/`refetchQueries`
on a key whose error handler can re-trigger the same error.
