---
name: Layered rate-limit key
description: How to stack multiple rate limiters on one route in api-server app.ts
---

The shared `rateLimit(max, windowMs)` middleware in `artifacts/api-server/src/app.ts`
keys its in-memory store by `ip:path:max:windowMs`. Because the key includes the
limiter's own max/window, you can mount MULTIPLE limiters on the same path and they
won't clobber each other's counters.

**Why:** to throttle abuse you often want both a short burst cap and a longer
sustained cap on the same endpoint (e.g. register = 10/min burst + 15/hour
sustained). If the key were only `ip:path`, two `app.use(path, rateLimit(...))`
lines would share one counter and interfere.

**How to apply:** add a second `app.use("/api/...", rateLimit(...))` line with a
different window for layered protection. Do NOT drop max/window from the key.
The limiter is in-process only (resets on restart, not shared across autoscale
instances) and is bypassed entirely when `NODE_ENV==="test"`.
