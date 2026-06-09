---
name: Tenant URL SSRF in server-side fetches
description: Any server-side fetch of a tenant-supplied URL (e.g. company.logoUrl in PDF generation) is an SSRF vector and must be guarded.
---

# Tenant-supplied URLs are an SSRF vector

Columns like `companies.logoUrl` are tenant-controlled. Fetching them server-side
(PDF rendering, email assembly, image embedding) lets a malicious tenant point the
backend at internal/private network targets (cloud metadata, localhost services).

**Rule:** never call bare `fetch(tenantUrl)` server-side. Route every such fetch
through `fetchImageBufferSafe` (artifacts/api-server/src/lib/safe-fetch.ts), which
requires HTTPS, resolves the host and rejects private/loopback/link-local/CGNAT/
multicast IPs, and refuses redirects (redirects can bypass the host check). It
returns `null` on any failure so callers fall back gracefully (e.g. text header).

**Why:** code review flagged this as a critical SSRF in the estimate/invoice PDF
generators, which fetched `company.logoUrl` with no validation. Both PDF paths now
use the shared guard.

**How to apply:** when adding any feature that fetches a URL stored from user/tenant
input, use `fetchImageBufferSafe` (or extend it) rather than `fetch` directly.
