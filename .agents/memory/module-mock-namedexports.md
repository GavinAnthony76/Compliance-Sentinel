---
name: Module-mock tests must track new named imports
description: node:test mock.module suites break when mocked modules gain new named imports
---
Suites using `node --experimental-test-module-mocks` (billing-status-email, payment-receipt-email in api-server/tests) mock `@workspace/db` / `drizzle-orm` with explicit `namedExports`. When production code (esp. notifications.ts or the routes) starts importing a NEW name from a mocked module, these tests crash at import with `SyntaxError: does not provide an export named '...'`.

**Why:** ESM named imports are validated against the mock's export list at instantiation; there is no wildcard/proxy fallback for namedExports.

**How to apply:** After adding an import from `@workspace/db`/`drizzle-orm` in code covered by these suites, add the name to each test's mock and rerun `pnpm run test:payment-receipts` / `test:billing-emails`. Pattern for faithful conditional-UPDATE+RETURNING semantics lives in payment-receipt-email.test.mjs.

Now guarded: tests/mock-surface-check.mjs runs a preflight in both suites that statically walks the production import graph and fails with "add X to the mock" naming the missing exports before any opaque SyntaxError. Both suites also run inside `test:all:ci` (the test-gate validation), so the breakage is caught in CI. New module-mock suites should reuse assertMockCovers.

Relative mocks now guarded too: payment-receipt-email.test.mjs keeps its ~12 relative mock.module calls in one `relativeMocks` map and preflights each via assertRelativeMockCovers (path-keyed, resolves "../lib/x" and "./x" alike, also flags stale mock paths). Other module-mock suites (stuck-invoices, autopay-sweep-race, billing-status-email) should adopt the same pattern for their relative mocks.

**Update (Aug 2026):** tests/mock-surface-check.mjs preflights (assertMockCovers / assertRelativeMockCovers) now guard all payment module-mock suites and also scan dynamic-import destructuring (`const {x} = await import(...)`). Any new mocked module in a suite must be added to its `relativeMocks` map so the preflight covers it.
