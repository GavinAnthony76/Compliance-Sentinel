---
name: concurrent test-build collision
description: Why validation/test workflows intermittently failed with esbuild "SyntaxError: Unexpected end of input" and the single-build gate that replaced them
---

The CI harnesses each used to rebuild api-server's shared `dist/` (esbuild) before
running. Concurrent runs could read a half-written `dist/index.mjs`, yielding
`SyntaxError: Unexpected end of input`.

**Fixed by design:** the validation gate is now a single `test-gate` workflow running
`test:all:ci` (tests/run-all-ci.mjs), which builds ONCE into `dist-ci` then runs the
permissions/access/admin groups CONCURRENTLY (Promise.all), each on its own port with
its own server, cleanup namespace, and per-group buffered output (runHarness onOutput)
flushed as contiguous blocks. This is safe because there's one shared build, not
parallel builds. Shared lifecycle lives in tests/ci-harness.mjs. The standalone
scripts (test:permissions:ci / test:access:ci / test:admin:ci) still work and build
their own isolated dists (dist-permissions/dist-access/dist-admin).

**How to apply:** an "Unexpected end of input" build failure only recurs if something
runs two builds into the same outdir concurrently — don't add parallel gate steps that
share BUILD_OUTDIR. Verify a suite in isolation via its standalone script.
