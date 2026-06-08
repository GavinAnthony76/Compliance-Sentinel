---
name: pdfkit must be externalized in api-server esbuild
description: Why pdfkit (and similar CJS-with-binary-deps) packages must be in the esbuild `external` array
---

# pdfkit must be externalized in the api-server esbuild bundle

The api-server is bundled with esbuild (`artifacts/api-server/build.mjs`). `pdfkit` cannot be
bundled — esbuild fails on its CommonJS dependencies (fontkit, brotli) with a `@swc/helpers`
resolution error, and the server then won't start.

**Why:** these deps ship CJS + binary/wasm assets that esbuild's bundler can't statically resolve.

**How to apply:** add such packages to the `external` array in `build.mjs` so they're required at
runtime from node_modules instead of bundled. The same pattern applies to any future package with
native/binary deps or problematic CJS interop.
