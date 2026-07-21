---
name: Module-mock tests must track new named imports
description: node:test mock.module suites break when mocked modules gain new named imports
---
Suites using `node --experimental-test-module-mocks` (billing-status-email, payment-receipt-email in api-server/tests) mock `@workspace/db` / `drizzle-orm` with explicit `namedExports`. When production code (esp. notifications.ts or the routes) starts importing a NEW name from a mocked module, these tests crash at import with `SyntaxError: does not provide an export named '...'`.

**Why:** ESM named imports are validated against the mock's export list at instantiation; there is no wildcard/proxy fallback for namedExports.

**How to apply:** After adding an import from `@workspace/db`/`drizzle-orm` in code covered by these suites, add the name to each test's mock and rerun `pnpm run test:payment-receipts` / `test:billing-emails`. Pattern for faithful conditional-UPDATE+RETURNING semantics lives in payment-receipt-email.test.mjs.
