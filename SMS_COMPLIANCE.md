# GreenSynk SMS Compliance — A2P 10DLC Registration Package

This document contains all content needed to complete Twilio's A2P 10DLC brand and campaign registration, plus the required privacy/terms update copy and sample messages per category.

---

## 1. Brand Registration

| Field | Value |
|---|---|
| **Legal Business Name** | GreenSynk, Inc. |
| **Business Type** | LLC / Corporation |
| **Industry** | Software / SaaS |
| **Website** | https://greensynk.com |
| **Business Contact Email** | support@greensynk.com |
| **EIN** | *(enter your EIN)* |

---

## 2. Campaign Registration

### Use Case
**Mixed** — transactional alerts sent on behalf of lawn care businesses to their customers

### Campaign Description (Twilio field — 40 words max)
> GreenSynk sends transactional SMS alerts on behalf of lawn care businesses: appointment reminders, estimate notifications, invoice delivery, and service updates. All recipients have explicitly opted in via booking form or account registration.

### Message Flow / Opt-In Description (Twilio field)
> End users opt in by checking an unchecked-by-default checkbox on the GreenSynk public booking form or the company registration form. The checkbox label reads: "I agree to receive text messages from [Company Name] via GreenSynk at the phone number provided. Msg & data rates may apply. Reply STOP to cancel." No messages are sent before consent is recorded. Consent is stored with IP address, user agent, timestamp, and source in an immutable audit log.

### Help Message (must be exact)
```
GreenSynk Alerts: appointment reminders, estimates, and invoices from your lawn care provider. Msg & data rates may apply. ~4 msg/mo. Reply STOP to cancel. Visit greensynk.com/sms-policy for info.
```

### Stop Message (must be exact)
```
You have been unsubscribed from GreenSynk SMS alerts. You will receive no further messages. Reply START to re-subscribe. Reply HELP for help.
```

### Start / Re-Subscribe Message (must be exact)
```
You have been re-subscribed to GreenSynk SMS alerts. Message & data rates may apply. Reply STOP to cancel. Reply HELP for help.
```

---

## 3. Sample Messages Per Category

All messages append the STOP footer if not already present.

### Appointment Reminders
```
Hi Sarah, this is a reminder that GreenScapes Pro has you scheduled for Lawn Mowing on Thu Jun 26 at 9:00 AM at 123 Oak St. Reply STOP to opt out.
```
```
Hi Sarah, your lawn care appointment has been confirmed for Thu Jun 26 at 9:00 AM. We'll see you then! — GreenScapes Pro. Reply STOP to opt out.
```
```
Hi Sarah, your GreenScapes Pro appointment on Jun 26 has been rescheduled to Fri Jun 27 at 10:00 AM. Questions? Call us. Reply STOP to opt out.
```
```
Hi Sarah, your technician is on the way! Expected arrival in about 20 minutes. — GreenScapes Pro. Reply STOP to opt out.
```

### Estimate Notifications
```
Hi Sarah, your estimate from GreenScapes Pro is ready. View and sign it here: https://greensynk.com/portal/greenscapes/estimates/42. Reply STOP to opt out.
```

### Invoice Notifications
```
Hi Sarah, invoice #1042 from GreenScapes Pro for $85.00 is ready. Pay online: https://greensynk.com/portal/greenscapes/invoices/1042. Reply STOP to opt out.
```

### Service Updates
```
Hi Sarah, GreenScapes Pro has set up your customer portal. Access your appointments and invoices here: https://greensynk.com/portal/greenscapes. Reply STOP to opt out.
```

---

## 4. Opt-In CTA Text (for use on booking / registration forms)

### Booking Form (public)
> By checking this box, I agree to receive text messages from **[Company Name]** via GreenSynk at the phone number provided above. Messages may include appointment reminders, confirmations, and service updates. Message & data rates may apply. Message frequency varies. Reply **STOP** to cancel at any time, **HELP** for help. View [SMS Policy](https://greensynk.com/sms-policy) and [Privacy Policy](https://greensynk.com/privacy).

### Company Registration (owner)
> I agree to receive SMS notifications about my GreenSynk account, including appointment activity and service alerts. Message & data rates may apply. Reply **STOP** to cancel, **HELP** for help. View our [SMS Policy](https://greensynk.com/sms-policy) and [Privacy Policy](https://greensynk.com/privacy).

---

## 5. Privacy Policy Update Copy

Add the following section to the GreenSynk Privacy Policy under a heading **"SMS / Text Message Communications"**:

---

**SMS / Text Message Communications**

GreenSynk operates an SMS alert program on behalf of lawn care businesses that use our platform. If you opt in via a booking form or account registration, we may send you transactional text messages including appointment reminders, estimate notifications, invoice delivery, and service updates.

- **Consent:** SMS alerts are opt-in only. You may withdraw consent at any time by replying STOP to any message, or by updating your preferences in your customer portal.
- **Data use:** Your phone number is used solely to deliver the alerts described above. We do not sell or share your phone number with third parties for marketing.
- **Message frequency:** Approximately 1–8 messages per month, depending on your service activity.
- **Carriers:** Message and data rates may apply. Carrier availability may vary.
- **Opt-out:** Reply STOP to unsubscribe. Reply HELP for help. See our [SMS Policy](https://greensynk.com/sms-policy) for full details.

---

## 6. Terms of Service Update Copy

Add the following section to the GreenSynk Terms of Service under a heading **"SMS Communications"**:

---

**SMS Communications**

By providing your mobile phone number and opting in to SMS alerts, you agree to receive automated text messages from GreenSynk on behalf of your lawn care provider. These messages are transactional in nature (appointment reminders, estimates, invoices, service updates) and are not promotional. You acknowledge that message and data rates may apply and that consent is not a condition of purchasing any service. You may opt out at any time by replying STOP to any message.

---

## 7. Keyword Handling Summary (for Twilio registration)

| Keyword(s) | Action |
|---|---|
| STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT | Opt out — fan out across all customer records matching the phone number; send STOP_REPLY |
| START, YES, UNSTOP | Re-subscribe — fan out across all matching records; send START_REPLY |
| HELP, INFO | No opt-out; log audit event; send HELP_REPLY |

All keyword actions are logged to the `sms_consent_events` immutable audit table with timestamp, phone, keyword, and source (`"inbound_sms"`).

---

## 8. Consent Audit Trail

Every opt-in, opt-out, STOP, START, HELP, and preference change is recorded in the `sms_consent_events` table with:

- `subject_type` — `"customer"` or `"company"`
- `subject_id` — foreign key to the relevant record
- `phone` — normalized E.164-style number
- `event_type` — `opt_in | opt_out | stop | start | help | pref_update`
- `keyword` — the raw inbound keyword (for webhook events)
- `source` — `booking_form | registration | portal | inbound_sms`
- `ip_address` — captured server-side from the HTTP request
- `user_agent` — captured server-side from the HTTP request
- `created_at` — UTC timestamp

Records are **insert-only** — no updates or deletes are permitted by the application code.

---

## 9. Public Compliance URLs

| Page | URL |
|---|---|
| SMS Alerts overview | https://greensynk.com/sms |
| SMS Policy | https://greensynk.com/sms-policy |
| Privacy Policy | https://greensynk.com/privacy |
| Customer portal SMS preferences | https://greensynk.com/portal/:slug/sms-preferences |
| Admin SMS compliance dashboard | https://greensynk.com/admin/sms-compliance |
