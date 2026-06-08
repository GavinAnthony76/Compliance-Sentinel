---
name: API codegen → typecheck pipeline gotchas
description: Order of operations after editing the OpenAPI spec, and the api-zod index export collision fix.
---

# After editing `lib/api-spec/openapi.yaml`

Run in this order or you get stale/confusing failures:
1. `pnpm --filter @workspace/api-spec run codegen` (regenerates api-client-react + api-zod).
2. `npx tsc -b lib/api-client-react` (rebuild the client's `dist`).
3. Frontend typecheck `cd artifacts/lawn-saas && npx tsc -p tsconfig.json --noEmit`.

**Why:** the frontend consumes `@workspace/api-client-react` via TS project references, which read the built `dist`. If you skip step 2, the frontend typechecks against a STALE client and you chase phantom errors (or miss real ones). Codegen's "Cleaning output folder" step briefly deletes `generated/*.ts`, which can throw a transient Vite "Failed to load url …/generated/api.ts" pre-transform error — restart the `lawn-saas: web` workflow to clear it.

# api-zod index export collision (TS2308)

`lib/api-zod/src/index.ts` star-exports BOTH `./generated/types` (TS schema types) and `./generated/api` (zod validators). orval emits the same name for request-body schemas in both (e.g. `*Body` for POST/PUT bodies), so `export *` from both is ambiguous → `TS2308 already exported a member named …`.

**Fix:** after the two `export *` lines, add an explicit named re-export of the colliding names from `./generated/api` (zod validators win). A direct named re-export overrides the ambiguous star exports. Re-add any new colliding `*Body` names here whenever the spec adds admin/body endpoints.

# Optional native deps (twilio, pdfkit) under esbuild

The api-server SMS path imports `twilio`, but it is neither installed nor in build.mjs `external`, so SMS fails at runtime with `ERR_MODULE_NOT_FOUND` (caught, non-fatal — email still sends). Same class as the pdfkit externalize note: a dep imported by the server must be both installed AND listed in build.mjs `external`, or the bundled `dist/index.mjs` cannot resolve it.
