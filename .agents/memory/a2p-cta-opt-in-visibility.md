---
name: A2P 10DLC CTA opt-in visibility
description: Why Twilio rejects the campaign with Error 30909 and what the opt-in surface must look like.
---

Twilio 10DLC CTA verification fails (Error 30909, "insufficient consent info") when the
opt-in URL submitted in the campaign leads the reviewer to a pricing/payment/multi-step
flow before they can see the consent checkbox. A reviewer only inspects the first screen
of the submitted URL; if SMS consent is buried behind plan selection, they conclude it is
a payment flow and reject.

**Rule:** the SMS opt-in checkbox + full CTA disclosure must be visible at the submitted
URL without going through pricing or payment.

**How to apply:**
- `/register` shows the SMS consent checkbox on step 1 (Account Info), before the plan/pricing
  step. Do not push it back behind pricing again.
- A dedicated, public, payment-free page at `/sms-opt-in` is the canonical URL/screenshot to
  submit to Twilio. It must carry every required element: brand name, message types, frequency
  (approx 1–8/mo), "Message & data rates may apply", "Reply STOP to cancel, HELP for help",
  "consent is not a condition of purchase", and links to SMS Policy + Privacy + Terms.
- Keep the consent wording on `/register` and `/sms-opt-in` aligned so a reviewer cross-checking
  both sees consistent disclosures.

**Why:** GreenSynk's campaign was rejected 4× — the 4th citing greensynk.com/register leading to
a payment link instead of verifying consent. Fix was to surface consent up front + add /sms-opt-in.
