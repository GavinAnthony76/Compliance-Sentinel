---
name: GreenSynk rebrand & email setup
description: App renamed from GreenSync/Goshen Lawn Care Management to GreenSynk (greensynk.com). Email delivery live via Resend.
---

**Why:** User purchased greensynk.com and rebranded the platform.

**What changed:**
- App name: GreenSynk everywhere (was GreenSync / Goshen Lawn Care Management)
- Logo: SVG-based leaf icon in assets/greensynk-logo.svg + white variant
- Email: Resend sending from noreply@greensynk.com (domain verified on Bluehost)
- RESEND_FROM_EMAIL env var set to noreply@greensynk.com

**How to apply:**
- Any new UI text should say "GreenSynk"
- Email templates in notifications.ts sign off as "The GreenSynk Team"
- Domain for Resend is greensynk.com (verified, all DNS records in Bluehost)

**Brand positioning (broadened beyond lawn care):**
- GreenSynk is positioned as "the operating system for outdoor service businesses" — NOT lawn-care-only.
- Public copy/SEO use "outdoor service businesses/professionals"; keep "lawn care" only as ONE named vertical inside lists like "landscaping, lawn care, irrigation, and outdoor service". Do not blanket-delete "lawn care".
- Homepage title is "GreenSynk | Outdoor Service Business Management Software" (pipe separator). SEO lives in 5 synced places: index.html, prerender.mjs (`/` route), ssr-server.mjs STATIC_META, vite.config.ts DEV_STATIC_META, and use-page-meta.ts DEFAULT_DESCRIPTION — update all together.
- Pricing is fixed at Starter $49 / Growth $99 / Pro $199 — never change in a copy/branding task.

**Generated "GreenSync"(C) brand headers come from the spec, not the code:**
- The "GreenSync Lawn Care SaaS API" header in lib/api-zod and lib/api-client-react generated/*.ts is sourced from `lib/api-spec/openapi.yaml` `info.description`. Fix the spec source (now "GreenSynk Outdoor Service SaaS API") — generated files reproduce it on next codegen; sync them manually if not re-running codegen.
