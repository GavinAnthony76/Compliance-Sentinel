---
name: Email case normalization
description: Store user emails lowercased everywhere because login looks them up lowercased; any raw-case write path is a silent "can't log in" bug
---

# Email case normalization

Company-user login resolves the account by a **lowercased** email identifier. The durable rule: any code path that writes or looks up a user email must apply the same normalization, or accounts become un-loginable / unreachable for recovery.

**Why:** A login that lowercases the identifier while a write path stores raw case produces a case-sensitive mismatch — the row exists but `=` never matches, surfacing as 401 "Invalid credentials" (or recovery emails silently not sent). This bit self-serve register, team-create, and admin-created users when phone-or-email login was added.

**How to apply:**
- Normalize at the boundary (zod `.email().transform(s => s.trim().toLowerCase())`) so the uniqueness check and the insert both use the canonical value — keep write and lookup in lockstep.
- Applies to every user-email write/lookup: register, team invite, admin company/user creation, and recovery (forgot-password/username, resend-confirmation).
- Platform-admin and customer-portal auth are **separate** login paths — only normalize their storage if their own login lookup also lowercases, otherwise you introduce the inverse asymmetry.
- Test helpers that touch users by email must lowercase too, or they no-op against normalized rows.
