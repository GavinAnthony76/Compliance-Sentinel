# Integrations and external-service boundaries

## Stripe — three distinct financial contexts

**Owners:** `artifacts/api-server/src/lib/stripe.ts`, `src/routes/billing.ts`, `src/routes/customer-portal.ts`, `src/routes/autopay.ts`, `src/lib/stuck-invoices.ts`.

1. **GreenSynk subscriptions:** platform Stripe customers/subscriptions/checkout/billing portal. Company plan and subscription state feed entitlements and access. Plan prices are mapped through STRIPE_STARTER_PRICE_ID, STRIPE_GROWTH_PRICE_ID, STRIPE_PRO_PRICE_ID. These identifiers are account-specific.
2. **Homeowner portal payments:** invoice Checkout sessions include invoice/company/customer metadata and `transfer_data.destination` for the company’s connected account. Preserve card-payment enablement, tenant/customer checks, stored session ownership, and confirmation/webhook races.
3. **Saved-card autopay:** `routes/autopay.ts` creates off-session PaymentIntents on the platform account using saved customer/payment-method references. This is not the same Connect destination flow. Do not change account ownership to make a test pass.

The helper prefers direct STRIPE_SECRET_KEY **and** STRIPE_PUBLISHABLE_KEY together, otherwise uses the Replit connector and runtime identity. Outside Replit, use explicit sandbox configuration or mocked clients; managed identity does not transfer with Git. Do not print keys or fetch connector credentials for handoff documentation.

### Webhooks

`app.ts` captures the raw body before JSON middleware for the main billing webhook. `routes/billing.ts` verifies the appropriate Stripe signature and handles subscription/payment transitions. There are v1/v2 webhook configuration paths; v2 parsing and account onboarding logic must be considered independently.

Use STRIPE_WEBHOOK_SECRET and, where needed, STRIPE_V2_WEBHOOK_SECRET. A checked-in empty v2 setting is not proof of a configured production secret. Never copy webhook secrets into Markdown. Changes to webhook URLs/account/mode require human review; do not create duplicate production endpoints.

Financial preservation requirements:
- Verify payment ownership, paid state, invoice metadata, amount/currency correspondence, and expected connected/platform account. The inspection did not certify every one of these checks.
- Claim/revert ownership comparisons must preserve timestamp precision.
- Receipt and owner notifications must run on every genuine paid transition, be awaited where required, and avoid duplicate sends.
- Preserve provider-first recovery before releasing processing invoices.
- Handle webhook replay and confirmation races without creating a second charge or duplicate business notification.

### Safe test status

Payment/access and ownership suites exist. Positive-path money movement is skipped when explicit sandbox conditions are not met. This handoff removed provider credentials and connector identity only from test subprocesses; no live Stripe requests were required. The no-Connect access expectation currently fails in that environment because Stripe initialization returns 503 before the expected 403. See BASELINE.md, not a claim of a live-payment defect.

## Email — Resend

**Owners:** `src/lib/resend.ts`, `src/lib/notifications.ts`, `src/lib/invoice-email.ts`, `src/routes/public-estimates.ts`.

RESEND_API_KEY is used directly. RESEND_FROM_EMAIL selects the verified sender; source default is a development sender. The installed SendGrid integration is not the active mail transport in these files. `APP_BASE_URL` determines customer-facing URLs, with development-domain fallback; configure it explicitly per environment.

`sendEmail`/`sendInvoiceEmail` return delivery information. Do not mark invoice sent on failed delivery. Preserve company-notification owner fallback. Provider acceptance is not proof of inbox delivery. Signed-estimate emails currently run fire-and-forget and use a narrower company-email condition, which needs review.

`NODE_ENV=test` suppresses real email/SMS. Email-template unit suites intentionally exercise a mocked Resend SDK outside that suppression path. A log saying “Email sent via Resend” in those mocked suites is not evidence of a real send.

## SMS — Twilio

**Owners:** `src/lib/notifications.ts`, `src/lib/sms-consent.ts`, `src/routes/sms-consent.ts`, `src/routes/sms-webhook.ts`.

Configuration names: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER. Enforce subject/category consent, opt-out/STOP events, and normalized phone identity. Passing only a phone number without consent context is not equivalent to authorization to text.

Preserve the visible opt-in surfaces at `/register` and `/sms-opt-in`, portal preferences, and webhook authentication. Carrier/A2P registration and live delivery were not revalidated. Never use live customer numbers for tests.

## AI estimating

**Owners:** `src/lib/ai-estimate.ts`, `lib/integrations-openai-ai-server/src/`.

AI_INTEGRATIONS_OPENAI_API_KEY and AI_INTEGRATIONS_OPENAI_BASE_URL configure the compatible API. Replit-managed proxy access may be unavailable outside Replit; a clone needs an approved compatible configuration or a stub. Preserve lazy configuration checks, the Pro entitlement, catalog-constrained line items, validation of generated output, and explicit AI versus mock/fallback source labels.

Do not send production customer data to a new AI provider or switch models/accounts as a hidden portability fix.

## Object storage

**Owners:** `src/lib/objectStorage.ts`, `src/lib/objectAcl.ts`, `src/routes/storage.ts`, `src/routes/appointment-photos.ts`.

Uses @google-cloud/storage and Replit-managed storage/runtime identity. Configuration includes PRIVATE_OBJECT_DIR, PUBLIC_OBJECT_SEARCH_PATHS, and DEFAULT_OBJECT_STORAGE_BUCKET_ID. Presigned URLs are sensitive. Never include them in handoff documents or logs.

Preserve private read authentication and DB tenant ownership checks. Authenticated browser images may require fetch-to-blob rather than an unauthenticated img URL. Outside Replit, use a stub or approved isolated storage configuration; do not grant access to the production bucket.

`src/lib/safe-fetch.ts` protects server-side tenant-supplied image retrieval for PDFs. Preserve HTTPS/private-address/redirect restrictions.

## PostgreSQL and PDF generation

Database configuration and provisioning are described in DATABASE.md. Existing data is not sample seed data.

PDFKit generates invoice/receipt/estimate PDFs. `build.mjs` externalizes PDFKit and Twilio along with required runtime modules; removing externalization can break production startup or font loading even if source typechecks.

## Integration approval checklist

For any integration change identify account/mode, URL callbacks, tenant scope, sensitive data, timeout/retry behavior, idempotency, test stubs, production secrets, and rollback. Environment existence metadata does not establish account correctness, permissions, deliverability, or current production configuration. No credentials were exported or changed for this handoff.
