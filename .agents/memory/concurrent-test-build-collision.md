---
name: concurrent test-build collision
description: Why validation/test workflows intermittently fail with esbuild "SyntaxError: Unexpected end of input"
---

The `lead-access` (test:permissions:ci) and `staff-access` (test:access:ci) validation
workflows each rebuild api-server's `dist/` (via `build.mjs`/esbuild) before running.
When they run concurrently (e.g. both triggered by mark_task_complete validation, or
both workflows started together), one process can read a half-written `dist/index.mjs`
produced by the other, yielding `SyntaxError: Unexpected end of input` during build.

**Why:** both suites share the same on-disk `dist/` output path; esbuild writes are not
atomic across processes, so a concurrent reader sees a truncated bundle.

**How to apply:** a permissions/access CI build failure with "Unexpected end of input" is
almost always this flake, NOT a real syntax error. Verify by building api-server alone
(`pnpm --filter @workspace/api-server run build`) and running the suite in isolation
(`pnpm --filter @workspace/api-server run test:permissions:ci`). If both pass, treat the
validation failure as transient.
