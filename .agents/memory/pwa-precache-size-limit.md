---
name: PWA precache size limit breaks the build
description: vite-plugin-pwa fails the lawn-saas production build when a precache-eligible asset exceeds workbox's 2 MiB limit.
---

# Oversized public/ assets fail the lawn-saas (and any vite-plugin-pwa) build

The lawn-saas vite config registers `VitePWA` with a workbox
`globPatterns` that includes `png,webp,jpg,jpeg,svg,ico` etc. Any matching file
in `public/` larger than workbox's default 2 MiB `maximumFileSizeToCacheInBytes`
makes the production build **error out** (not just warn) — e.g. a 16 MB
`images/smartroute.png` aborted a publish with "Assets exceeding the limit ...".

**Why it bites at publish but not in dev:** the precache manifest is only built
for production (`vite build`); `pnpm dev` never runs workbox, so an oversized
asset sits unnoticed until a deploy build fails.

**How to apply:**
- Don't drop large images/videos into `artifacts/lawn-saas/public/`. Optimize to
  a small webp/jpg, or serve big media from object storage instead.
- mp4/other extensions NOT in the glob are ignored by precache (a 12 MB mp4 was
  fine; the png was not), so the trap is specifically image extensions.
- If a large asset must ship, exclude it via workbox `globIgnores` rather than
  raising the size limit (you don't want a multi-MB file in the service-worker
  precache anyway).

A separate reproduction gotcha: `vite.config.ts` reads `PORT` at config-load
time and throws "PORT environment variable is required" — to build locally you
must set `PORT` (and BASE_PATH/API_PORT), which the deploy env provides.
