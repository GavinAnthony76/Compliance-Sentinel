---
name: composite library dist staleness
description: Why tsc fails with TS2724/TS2305 after editing a @workspace/* library's exports even though the app runs fine.
---

When you add/rename an export in a `@workspace/*` library that is a TypeScript
**composite** project (e.g. `@workspace/db`, `@workspace/api-client-react` — they
have `composite: true`, `emitDeclarationOnly`, `outDir: dist`), consuming packages
resolve types through the library's **built `dist/*.d.ts`**, not its `src`.

**Symptom:** `tsc --noEmit` in a consumer fails with `TS2724`/`TS2305`
("no exported member named X") even though vite/esbuild run fine and the running
server works — because the bundlers resolve via the package `exports` field
(`./src/index.ts`) at runtime, while `tsc` project references read the stale `dist`.

**Fix:** rebuild the library's declarations after changing its exports:
`pnpm --filter @workspace/<lib> exec tsc -b`

**How to apply:** after editing schema exports (db) or running orval codegen
(api-client-react), rebuild that library's dist before trusting/relying on a
consumer typecheck. Don't waste time hunting a phantom export bug.
