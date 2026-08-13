#!/usr/bin/env node
/**
 * End-to-end verification of the PUBLIC booking form's per-submitter cap:
 *
 *   POST /public/book/:slug/submit
 *
 * The public endpoint only had an IP rate limit (15/min), so anyone rotating
 * IPs or scripting slowly could still flood a company's inbox with
 * booking-request emails. Submissions are matched to a customer row by email
 * (or phone when no email is given), and each customer may have at most
 * MAX_PENDING_PUBLIC_REQUESTS (5) pending "portal_request" appointments.
 *
 * Checks:
 *   1. First 5 submissions from the same email -> 201.
 *   2. 6th submission from the same email -> 429 with a friendly message.
 *   3. Same email with a DIFFERENT phone -> still 429 (email is the match key).
 *   4. A different email -> 201 (cap is per-submitter, not per-IP).
 *   5. No-email submissions are capped by phone the same way.
 *   6. After the company confirms one pending request, the same email can
 *      submit again (cap counts only unreviewed/pending requests).
 *   7. A CONCURRENT burst of 8 first-time submissions from a brand-new email
 *      admits exactly 5 (201) and rejects 3 (429), and creates exactly ONE
 *      customer row — the atomic-admission guarantee (customer lookup/create
 *      + pending count + insert all inside one advisory-locked transaction).
 *
 * Black-box: talks to a RUNNING api-server over HTTP and self-provisions a
 * company + service, so the run is repeatable.
 *
 * Usage:
 *   API_BASE="https://<host>/api" node tests/public-booking-cap.e2e.mjs
 *
 * Exit code 0 = all checks passed, 1 = at least one check failed.
 */

const BASE =
  process.env.API_BASE ||
  (process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}/api`
    : "http://localhost:5000/api");

const PASSWORD = "TestPass123!";
const stamp = Date.now();

let failures = 0;
let passes = 0;

function check(name, condition, detail) {
  if (condition) {
    passes++;
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function req(method, path, { token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON response is fine */
  }
  return { status: res.status, json };
}

async function registerCompany() {
  const nsPrefix = process.env.TEST_RUN_NS ? `${process.env.TEST_RUN_NS}_` : "";
  const ownerEmail = `${nsPrefix}pubcap_owner_${stamp}@example.com`;
  const reg = await req("POST", "/auth/register", {
    body: {
      firstName: "Olive",
      lastName: "Owner",
      email: ownerEmail,
      password: PASSWORD,
      companyName: `PublicCap Test ${stamp}`,
      selectedPlan: "pro",
    },
  });
  if (reg.status === 201) {
    const { markOwnerVerified } = await import("./verify-owner.mjs");
    await markOwnerVerified(ownerEmail);
    const ownerLogin = await req("POST", "/auth/login", {
      body: { identifier: ownerEmail, password: PASSWORD },
    });
    reg.status = ownerLogin.status === 200 ? 201 : ownerLogin.status;
    reg.json = ownerLogin.json;
  }
  if (reg.status !== 201 || !reg.json?.token) {
    console.error("Setup failed: could not register company", reg.status, reg.json);
    process.exit(1);
  }
  const slug = reg.json?.user?.company?.slug ?? reg.json?.company?.slug;
  if (!slug) {
    console.error("Setup failed: login response missing company slug", reg.json);
    process.exit(1);
  }
  return { ownerToken: reg.json.token, slug };
}

async function createService(ownerToken) {
  const created = await req("POST", "/services", {
    token: ownerToken,
    body: { name: `Mowing PubCap ${stamp}`, basePrice: 45, isActive: true },
  });
  if (created.status !== 201 || !created.json?.id) {
    console.error("Setup failed: could not create service", created.status, created.json);
    process.exit(1);
  }
  return created.json.id;
}

function submission(serviceId, { email, phone }) {
  return {
    firstName: "Sam",
    lastName: "Spammer",
    ...(email ? { email } : {}),
    phone,
    addressLine1: "123 Turf Lane",
    city: "Lawnville",
    state: "TX",
    zip: "75001",
    serviceId,
  };
}

async function main() {
  console.log(`Public booking cap e2e against ${BASE}`);
  const { ownerToken, slug } = await registerCompany();
  const serviceId = await createService(ownerToken);

  const spamEmail = `pubcap_spam_${stamp}@example.com`;
  const spamPhone = `555${stamp}`.slice(0, 12);

  // 1. First 5 submissions from the same email succeed.
  let firstAppointmentId = null;
  for (let i = 1; i <= 5; i++) {
    const r = await req("POST", `/public/book/${slug}/submit`, {
      body: submission(serviceId, { email: spamEmail, phone: spamPhone }),
    });
    check(`submission ${i} from same email -> 201`, r.status === 201, `got ${r.status} ${JSON.stringify(r.json)}`);
    if (i === 1) firstAppointmentId = r.json?.appointmentId ?? null;
  }

  // 2. 6th submission from the same email is capped.
  const sixth = await req("POST", `/public/book/${slug}/submit`, {
    body: submission(serviceId, { email: spamEmail, phone: spamPhone }),
  });
  check("6th submission from same email -> 429", sixth.status === 429, `got ${sixth.status}`);
  check(
    "429 body has a friendly message",
    sixth.json?.error === "TooManyRequests" && /awaiting review/i.test(sixth.json?.message ?? ""),
    JSON.stringify(sixth.json)
  );

  // 2b. Case variants of the capped email are the SAME submitter.
  const variantEmail = await req("POST", `/public/book/${slug}/submit`, {
    body: submission(serviceId, { email: spamEmail.toUpperCase().replace(/@EXAMPLE/, "@Example"), phone: spamPhone }),
  });
  check("uppercased email variant -> still 429", variantEmail.status === 429, `got ${variantEmail.status} ${JSON.stringify(variantEmail.json)}`);

  // 3. Same email + different phone still capped (email is the match key).
  const diffPhone = await req("POST", `/public/book/${slug}/submit`, {
    body: submission(serviceId, { email: spamEmail, phone: `556${stamp}`.slice(0, 12) }),
  });
  check("same email, different phone -> still 429", diffPhone.status === 429, `got ${diffPhone.status}`);

  // 4. A genuinely different submitter is unaffected.
  const other = await req("POST", `/public/book/${slug}/submit`, {
    body: submission(serviceId, { email: `pubcap_other_${stamp}@example.com`, phone: `557${stamp}`.slice(0, 12) }),
  });
  check("different email -> 201", other.status === 201, `got ${other.status} ${JSON.stringify(other.json)}`);

  // 5. No-email submissions are capped by phone.
  const noEmailPhone = `558${stamp}`.slice(0, 12);
  let phoneOk = true;
  for (let i = 1; i <= 5; i++) {
    const r = await req("POST", `/public/book/${slug}/submit`, {
      body: submission(serviceId, { phone: noEmailPhone }),
    });
    if (r.status !== 201) phoneOk = false;
  }
  check("5 no-email submissions from same phone -> 201", phoneOk);
  const phoneCapped = await req("POST", `/public/book/${slug}/submit`, {
    body: submission(serviceId, { phone: noEmailPhone }),
  });
  check("6th no-email submission from same phone -> 429", phoneCapped.status === 429, `got ${phoneCapped.status}`);

  // 5b. A formatted variant of the same phone is the SAME submitter.
  const formattedPhone = `(${noEmailPhone.slice(0, 3)}) ${noEmailPhone.slice(3, 6)}-${noEmailPhone.slice(6)}`;
  const phoneVariant = await req("POST", `/public/book/${slug}/submit`, {
    body: submission(serviceId, { phone: formattedPhone }),
  });
  check("formatted phone variant -> still 429", phoneVariant.status === 429, `got ${phoneVariant.status} ${JSON.stringify(phoneVariant.json)}`);

  // 6. Cap counts only PENDING requests: confirm one, then the capped email
  // can submit again.
  if (firstAppointmentId) {
    const confirm = await req("PUT", `/appointments/${firstAppointmentId}`, {
      token: ownerToken,
      body: { status: "confirmed" },
    });
    check("owner can confirm a pending request", confirm.status === 200, `got ${confirm.status} ${JSON.stringify(confirm.json)}`);
    const afterConfirm = await req("POST", `/public/book/${slug}/submit`, {
      body: submission(serviceId, { email: spamEmail, phone: spamPhone }),
    });
    check("after one request is confirmed, same email -> 201 again", afterConfirm.status === 201, `got ${afterConfirm.status} ${JSON.stringify(afterConfirm.json)}`);
  } else {
    check("owner can confirm a pending request", false, "no appointmentId captured from first submission");
  }

  // 7. Concurrent burst from a brand-new identity: exactly 5 admitted, no
  // duplicate customer rows. This is the race the advisory lock closes —
  // without it, N concurrent first requests each create a customer and admit.
  const burstEmail = `pubcap_burst_${stamp}@example.com`;
  const burstPhone = `559${stamp}`.slice(0, 12);
  // Alternate case/whitespace variants across the burst so the atomic
  // admission is proven for canonicalized identities, not just byte-identical
  // inputs.
  const burstVariants = [
    burstEmail,
    burstEmail.toUpperCase(),
    burstEmail.replace(/@example/, "@Example"),
    burstEmail.replace(/^pubcap/, "PUBCAP"),
  ];
  const burst = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      req("POST", `/public/book/${slug}/submit`, {
        body: submission(serviceId, { email: burstVariants[i % burstVariants.length], phone: burstPhone }),
      })
    )
  );
  const admitted = burst.filter((r) => r.status === 201).length;
  const rejected = burst.filter((r) => r.status === 429).length;
  check(
    "concurrent burst of 8 fresh-identity submissions -> exactly 5 admitted",
    admitted === 5,
    `admitted=${admitted} statuses=${burst.map((r) => r.status).join(",")}`
  );
  check("concurrent burst -> the other 3 rejected with 429", rejected === 3, `rejected=${rejected}`);

  // Exactly ONE customer row exists for the burst email.
  const custSearch = await req("GET", `/customers?search=${encodeURIComponent(burstEmail)}&limit=50`, {
    token: ownerToken,
  });
  const custRows = custSearch.json?.customers ?? custSearch.json?.data ?? (Array.isArray(custSearch.json) ? custSearch.json : []);
  const matching = custRows.filter((c) => (c.email ?? "").trim().toLowerCase() === burstEmail.toLowerCase());
  check(
    "concurrent burst created exactly ONE customer row",
    custSearch.status === 200 && matching.length === 1,
    `status=${custSearch.status} matching=${matching.length}`
  );

  console.log(`\n${passes} passed, ${failures} failed.`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
