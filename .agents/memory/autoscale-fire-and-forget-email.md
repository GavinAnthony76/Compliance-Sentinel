---
name: Autoscale drops fire-and-forget email/SMS sends
description: Why "email works everywhere except endpoint X" on the autoscale deployment — unawaited post-response sends get throttled away.
---

# Post-response background I/O is unreliable on the autoscale (Cloud Run) deployment

The GreenSynk deployment is autoscale (cloud_run). After an HTTP response is
flushed, the instance's CPU is throttled toward zero until the next request. Any
**fire-and-forget** async work kicked off *after* `res.json()` (e.g.
`sendSomethingEmail({...}).catch(...)` without `await`) frequently never gets CPU
to finish its outbound Resend/Twilio HTTP call — so the email/SMS is silently
never sent, even though the endpoint returned 200/201.

**Symptom that points here:** "email works in all areas except endpoint X."
The working endpoints `await` their sends (invoices, portal invites, appointment
confirmations); the broken one was the lone fire-and-forget call site.

**Why:** the request handler resolves and the response is sent before the
background promise completes; the runtime suspends the instance, abandoning it.

**How to apply:**
- For any delivery-critical external I/O (email/SMS/webhooks), `await` it inside
  the handler before responding — do NOT use `void send(...).catch()`.
- Don't let a send failure roll back the primary mutation: create the row first,
  then `await` the send in a try/catch, log delivery result, and still return
  success (the entity already exists).
- Fixed call sites (all now awaited + logged, never throw): team invite (POST
  /team), registration email-verification (issueEmailVerification, used by
  register + resend-confirmation), and post-verify welcome email. If you add a
  NEW email/SMS send, await it the same way — never reintroduce `void send()`.
