---
name: SendGrid managed connector
description: How email credentials are sourced — the Replit-managed SendGrid connector ships no code snippet, so the proxy fetch must be hand-written.
---

# SendGrid managed connector

The Replit-managed SendGrid connector (`searchIntegrations("sendgrid")`) returns an
**empty `renderedContent` / empty code snippets** from both `viewIntegration` and
`addIntegration`. There is no generated `getUncachable*Client()` helper to copy — you
must write the connector-proxy fetch yourself.

**Credential shape:** the connection's `settings` has exactly two keys: `api_key` and
`from_email` (verified sender). Discover this via `listConnections("sendgrid")` in the
code-execution sandbox (inspect `settings` keys / `toonSchema` — never print the value).

**Runtime fetch (in the app, not the sandbox):** the sandbox does NOT expose
`process.env`, so verify shape via `listConnections` but write the real fetch in app code:
GET `https://${REPLIT_CONNECTORS_HOSTNAME}/api/v2/connection?include_secrets=true&connector_names=sendgrid`
with header `X_REPLIT_TOKEN: "repl " + REPL_IDENTITY` (or `"depl " + WEB_REPL_RENEWAL`).
Read `data.items[0].settings.{api_key,from_email}`. Fetch fresh every send — never cache
(tokens rotate). Prefer connector creds, fall back to raw `SENDGRID_API_KEY`, else mock.

**Why:** the connector is the user-preferred email path ("email is a must in all areas").

**Gotcha:** SendGrid returns HTTP `401 Unauthorized` with body `"Maximum credits exceeded"`
when the connected account is out of credits. This is an account-billing issue, NOT a
wiring bug — the request authenticated fine. Distinguish the two when debugging delivery.
