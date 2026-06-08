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
