---
name: AI integration lazy import
description: Why the OpenAI integration client must be imported lazily inside functions, not at module top-level.
---

The `@workspace/integrations-openai-ai-server` client (and the Replit AI integration clients generally) **throws at module-evaluation time** if `AI_INTEGRATIONS_OPENAI_BASE_URL` / `AI_INTEGRATIONS_OPENAI_API_KEY` are unset.

**Rule:** Never `import { openai } from "@workspace/integrations-openai-ai-server"` at the top of a file that is imported during server startup. Import it lazily with `const { openai } = await import(...)` *inside* the function, after an env-presence check that returns a mock fallback.

**Why:** A top-level import propagates the throw up through every route file that imports the consumer, taking the whole API server down at boot when the integration env is missing — defeating any intended mock/fallback path. Verified in `lib/ai-estimate.ts`.

**How to apply:** Any new feature using a Replit AI integration: guard with `if (!process.env.<BASE_URL> || !process.env.<API_KEY>) return mock;` then `await import(...)` the client below that guard.
