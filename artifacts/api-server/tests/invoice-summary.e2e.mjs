#!/usr/bin/env node
/**
 * E2E test for the all-invoices payment summary cards.
 *
 * GET /invoices returns a `summary` (outstanding, paidTotal, paidOnline,
 * paidOffline) computed server-side across the FULL filtered set — not just
 * the current page. This suite guards that aggregation:
 *
 *   1. Seeds MORE invoices than one page (60 > default limit 20) in varied
 *      states: sent, overdue, draft, and paid via card, cash, legacy
 *      null-method + Stripe payment intent, and null-method without one.
 *   2. Asserts the summary matches sums computed over ALL matching invoices,
 *      on page 1 AND a later page (identical summary regardless of page).
 *   3. Asserts the online/offline split: online = paymentMethod 'card' OR
 *      (null method + Stripe payment intent); everything else is offline.
 *   4. Asserts the summary respects status / paymentMethod / customerId
 *      filters.
 *
 * Black-box over HTTP against a RUNNING api-server, except state mutation:
 * invoice status/paymentMethod/stripePaymentIntentId are set directly in the
 * test DB (mirrors verify-owner.mjs) because the HTTP "sent" transition is
 * gated on real email delivery and the legacy null-method + payment-intent
 * shape has no API path at all.
 *
 * Usage:
 *   API_BASE="https://<host>/api" node tests/invoice-summary.e2e.mjs
 *
 * Exit code 0 = all checks passed, 1 = at least one check failed.
 */

import pg from "pg";

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

function close(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.005;
}

function checkSummary(label, summary, expected) {
  check(
    `${label}: summary present`,
    summary && typeof summary === "object",
    JSON.stringify(summary),
  );
  if (!summary) return;
  for (const key of ["outstanding", "paidTotal", "paidOnline", "paidOffline"]) {
    check(
      `${label}: ${key} = ${expected[key].toFixed(2)}`,
      close(summary[key], expected[key]),
      `got ${summary[key]}`,
    );
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

async function registerCompany(label) {
  const nsPrefix = process.env.TEST_RUN_NS ? `${process.env.TEST_RUN_NS}_` : "";
  const ownerEmail = `${nsPrefix}invsum_${label}_owner_${stamp}@example.com`;
  const reg = await req("POST", "/auth/register", {
    body: {
      firstName: "Olive",
      lastName: "Owner",
      email: ownerEmail,
      password: PASSWORD,
      companyName: `Invoice Summary Test ${label} ${stamp}`,
      selectedPlan: "pro",
    },
  });
  if (reg.status === 201) {
    const { markOwnerVerified } = await import("./verify-owner.mjs");
    await markOwnerVerified(ownerEmail);
    const ownerLogin = await req("POST", "/auth/login", { body: { identifier: ownerEmail, password: PASSWORD } });
    reg.status = ownerLogin.status === 200 ? 201 : ownerLogin.status;
    reg.json = ownerLogin.json;
  }
  if (reg.status !== 201 || !reg.json?.token) {
    console.error(`Setup failed: could not register company ${label}`, reg.status, reg.json);
    process.exit(1);
  }
  return reg.json.token;
}

async function createCustomer(ownerToken, label) {
  const created = await req("POST", "/customers", {
    token: ownerToken,
    body: { firstName: "Cara", lastName: `Customer${label}`, phone: `555${stamp}`.slice(0, 11) + label },
  });
  if (created.status !== 201 || !created.json?.id) {
    console.error(`Setup failed: could not create customer ${label}`, created.status, created.json);
    process.exit(1);
  }
  return created.json.id;
}

// The seeded state matrix. 60 invoices — three full default pages — spread
// across every state the summary cares about. Each spec drives one invoice.
//   status: final invoice status
//   method: payment_method column (null = legacy)
//   pi:     whether a Stripe payment intent id is set
function buildSpecs() {
  const specs = [];
  const push = (n, status, method, pi) => {
    for (let i = 0; i < n; i++) specs.push({ status, method, pi });
  };
  push(12, "sent", null, false); //   outstanding
  push(8, "overdue", null, false); // outstanding
  push(10, "draft", null, false); //  excluded from every bucket
  push(12, "paid", "card", false); // paid ONLINE (card)
  push(8, "paid", null, true); //     paid ONLINE (legacy null + payment intent)
  push(6, "paid", "cash", false); //  paid OFFLINE
  push(4, "paid", null, false); //    paid OFFLINE (null method, no intent)
  return specs;
}

function expectationFor(invoices) {
  const isOnline = (s) => s.method === "card" || (s.method === null && s.pi);
  let outstanding = 0;
  let paidTotal = 0;
  let paidOnline = 0;
  for (const inv of invoices) {
    if (inv.status === "sent" || inv.status === "overdue") outstanding += inv.total;
    if (inv.status === "paid") {
      paidTotal += inv.total;
      if (isOnline(inv)) paidOnline += inv.total;
    }
  }
  return {
    outstanding,
    paidTotal,
    paidOnline,
    paidOffline: paidTotal - paidOnline,
  };
}

async function main() {
  console.log(`Invoice summary aggregation e2e against: ${BASE}\n`);

  const ownerToken = await registerCompany("A");
  const custA = await createCustomer(ownerToken, "A");
  const custB = await createCustomer(ownerToken, "B");

  // --- Seed 60 invoices via the API, then set their state in the DB ---------
  const specs = buildSpecs();
  console.log(`Seeding ${specs.length} invoices (default page size is 20)…`);
  const seeded = [];
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const customerId = i % 2 === 0 ? custA : custB;
    const total = 10 + i; // distinct totals so a bucket swap changes the sums
    const r = await req("POST", "/invoices", {
      token: ownerToken,
      body: {
        customerId,
        status: "draft",
        lineItems: [{ description: `Lawn service ${i}`, quantity: 1, unitPrice: total }],
      },
    });
    if (r.status !== 201 || !r.json?.id) {
      console.error(`Setup failed: invoice create #${i} -> ${r.status}`, r.json);
      process.exit(1);
    }
    seeded.push({ id: r.json.id, customerId, total, ...spec });
  }

  const cs = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
  if (!cs) {
    console.error("NEON_DATABASE_URL / DATABASE_URL not set; cannot seed invoice states.");
    process.exit(1);
  }
  const client = new pg.Client({
    connectionString: cs,
    ssl: process.env.NEON_DATABASE_URL ? true : undefined,
  });
  await client.connect();
  try {
    for (const inv of seeded) {
      if (inv.status === "draft") continue; // created as draft already
      await client.query(
        `UPDATE invoices
            SET status = $1,
                payment_method = $2,
                stripe_payment_intent_id = $3,
                paid_at = CASE WHEN $1 = 'paid' THEN now() ELSE NULL END
          WHERE id = $4`,
        [inv.status, inv.method, inv.pi ? `pi_test_${stamp}_${inv.id}` : null, inv.id],
      );
    }
  } finally {
    await client.end();
  }

  const all = expectationFor(seeded);

  // --- 1. Unfiltered: summary spans ALL invoices, not just page 1 -----------
  console.log("\nUnfiltered list — summary must aggregate over all 60 invoices:");
  const page1 = await req("GET", "/invoices", { token: ownerToken });
  check("GET /invoices -> 200", page1.status === 200, `got ${page1.status}`);
  check(
    "page 1 returns one page (20), total reports all 60",
    page1.json?.invoices?.length === 20 && Number(page1.json?.total) === 60,
    `got ${page1.json?.invoices?.length} rows, total ${page1.json?.total}`,
  );
  checkSummary("page 1", page1.json?.summary, all);
  check(
    "sanity: page-1 rows alone sum to LESS than the summary (proves full-set aggregation)",
    (page1.json?.invoices ?? []).reduce((s, i) => s + Number(i.total), 0) <
      all.outstanding + all.paidTotal,
    "page-1 rows cover the whole set — seed more invoices",
  );

  // --- 2. A later page reports the IDENTICAL summary ------------------------
  console.log("\nPage 3 — summary must be identical to page 1:");
  const page3 = await req("GET", "/invoices?page=3", { token: ownerToken });
  check("GET /invoices?page=3 -> 200", page3.status === 200, `got ${page3.status}`);
  check(
    "page 3 has rows (data really spans multiple pages)",
    (page3.json?.invoices?.length ?? 0) > 0,
    `got ${page3.json?.invoices?.length}`,
  );
  checkSummary("page 3", page3.json?.summary, all);

  // --- 3. status filter ------------------------------------------------------
  console.log("\nstatus=paid filter — only paid invoices count:");
  const paidOnly = expectationFor(seeded.filter((i) => i.status === "paid"));
  const paidRes = await req("GET", "/invoices?status=paid", { token: ownerToken });
  check("GET ?status=paid -> 200", paidRes.status === 200, `got ${paidRes.status}`);
  checkSummary("status=paid", paidRes.json?.summary, paidOnly);
  check(
    "status=paid outstanding is 0",
    close(paidRes.json?.summary?.outstanding, 0),
    `got ${paidRes.json?.summary?.outstanding}`,
  );

  console.log("\nstatus=sent filter — outstanding only, nothing paid:");
  const sentOnly = expectationFor(seeded.filter((i) => i.status === "sent"));
  const sentRes = await req("GET", "/invoices?status=sent", { token: ownerToken });
  check("GET ?status=sent -> 200", sentRes.status === 200, `got ${sentRes.status}`);
  checkSummary("status=sent", sentRes.json?.summary, sentOnly);

  // --- 4. paymentMethod filter -----------------------------------------------
  console.log("\npaymentMethod=card filter — all paid volume is online:");
  const cardOnly = expectationFor(seeded.filter((i) => i.method === "card"));
  const cardRes = await req("GET", "/invoices?paymentMethod=card", { token: ownerToken });
  check("GET ?paymentMethod=card -> 200", cardRes.status === 200, `got ${cardRes.status}`);
  checkSummary("paymentMethod=card", cardRes.json?.summary, cardOnly);
  check(
    "paymentMethod=card paidOffline is 0",
    close(cardRes.json?.summary?.paidOffline, 0),
    `got ${cardRes.json?.summary?.paidOffline}`,
  );

  console.log("\npaymentMethod=cash filter — all paid volume is offline:");
  const cashOnly = expectationFor(seeded.filter((i) => i.method === "cash"));
  const cashRes = await req("GET", "/invoices?paymentMethod=cash", { token: ownerToken });
  check("GET ?paymentMethod=cash -> 200", cashRes.status === 200, `got ${cashRes.status}`);
  checkSummary("paymentMethod=cash", cashRes.json?.summary, cashOnly);
  check(
    "paymentMethod=cash paidOnline is 0",
    close(cashRes.json?.summary?.paidOnline, 0),
    `got ${cashRes.json?.summary?.paidOnline}`,
  );

  // --- 5. customerId filter ----------------------------------------------------
  console.log("\ncustomerId filter — sums restricted to that customer:");
  const aOnly = expectationFor(seeded.filter((i) => i.customerId === custA));
  const aRes = await req("GET", `/invoices?customerId=${custA}`, { token: ownerToken });
  check("GET ?customerId=A -> 200", aRes.status === 200, `got ${aRes.status}`);
  checkSummary("customerId=A", aRes.json?.summary, aOnly);

  const bOnly = expectationFor(seeded.filter((i) => i.customerId === custB));
  const bRes = await req("GET", `/invoices?customerId=${custB}`, { token: ownerToken });
  check("GET ?customerId=B -> 200", bRes.status === 200, `got ${bRes.status}`);
  checkSummary("customerId=B", bRes.json?.summary, bOnly);
  check(
    "customer A + B summaries add up to the unfiltered totals",
    close(aOnly.paidTotal + bOnly.paidTotal, all.paidTotal) &&
      close(aOnly.outstanding + bOnly.outstanding, all.outstanding),
    `A=${JSON.stringify(aOnly)} B=${JSON.stringify(bOnly)}`,
  );

  // --- 6. Combined filters ------------------------------------------------------
  console.log("\nCombined status=paid + customerId filter:");
  const paidA = expectationFor(seeded.filter((i) => i.status === "paid" && i.customerId === custA));
  const paidARes = await req("GET", `/invoices?status=paid&customerId=${custA}`, { token: ownerToken });
  check("GET ?status=paid&customerId=A -> 200", paidARes.status === 200, `got ${paidARes.status}`);
  checkSummary("status=paid & customerId=A", paidARes.json?.summary, paidA);

  // --- 7. Date-range filter ---------------------------------------------------
  // Shift every 3rd invoice's effective date ~40 days back (paid_at for paid
  // invoices, created_at otherwise — the same column the API filters on), then
  // assert from/to slices the summary into the right periods.
  console.log("\nDate-range filter — summary respects from/to:");
  const DAY = 24 * 60 * 60 * 1000;
  const oldDate = new Date(Date.now() - 40 * DAY);
  const shifted = [];
  const dbc = new pg.Client({
    connectionString: cs,
    ssl: process.env.NEON_DATABASE_URL ? true : undefined,
  });
  await dbc.connect();
  try {
    for (let i = 0; i < seeded.length; i++) {
      if (i % 3 !== 0) continue;
      const inv = seeded[i];
      shifted.push(inv.id);
      inv.period = "old";
      await dbc.query(
        `UPDATE invoices
            SET created_at = $1::timestamptz,
                paid_at = CASE WHEN status = 'paid' THEN $1::timestamptz ELSE paid_at END
          WHERE id = $2`,
        [oldDate.toISOString(), inv.id],
      );
    }
    // Stale paid_at on a NON-paid invoice: pick a recent "sent" invoice and
    // give it an old paid_at. The date filter is status-aware (non-paid
    // invoices bucket by created_at), so this invoice must stay in the recent
    // window and stay OUT of the old window — the recent/old summary checks
    // below fail if paid_at presence alone shifted its bucket.
    const staleSent = seeded.find((i, idx) => idx % 3 !== 0 && i.status === "sent");
    if (!staleSent) {
      console.error("Setup failed: no recent 'sent' invoice available for stale paid_at case.");
      process.exit(1);
    }
    await dbc.query(`UPDATE invoices SET paid_at = $1::timestamptz WHERE id = $2`, [
      oldDate.toISOString(),
      staleSent.id,
    ]);
  } finally {
    await dbc.end();
  }
  for (const inv of seeded) if (!inv.period) inv.period = "recent";
  const ymd = (d) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

  const recentOnly = expectationFor(seeded.filter((i) => i.period === "recent"));
  // `to` = today (date-only) must be INCLUSIVE of the whole day.
  const recentFrom = ymd(new Date(Date.now() - 2 * DAY));
  const recentTo = ymd(new Date());
  const recentRes = await req(
    "GET",
    `/invoices?from=${recentFrom}&to=${recentTo}`,
    { token: ownerToken },
  );
  check("GET ?from/to (recent window) -> 200", recentRes.status === 200, `got ${recentRes.status}`);
  check(
    "recent window total counts only unshifted invoices",
    Number(recentRes.json?.total) === seeded.length - shifted.length,
    `got ${recentRes.json?.total}, want ${seeded.length - shifted.length}`,
  );
  checkSummary("recent window", recentRes.json?.summary, recentOnly);

  const oldOnly = expectationFor(seeded.filter((i) => i.period === "old"));
  const oldFrom = ymd(new Date(oldDate.getTime() - 2 * DAY));
  const oldTo = ymd(new Date(oldDate.getTime() + 2 * DAY));
  const oldRes = await req("GET", `/invoices?from=${oldFrom}&to=${oldTo}`, { token: ownerToken });
  check("GET ?from/to (old window) -> 200", oldRes.status === 200, `got ${oldRes.status}`);
  check(
    "old window total counts only shifted invoices",
    Number(oldRes.json?.total) === shifted.length,
    `got ${oldRes.json?.total}, want ${shifted.length}`,
  );
  checkSummary("old window", oldRes.json?.summary, oldOnly);

  check(
    "recent + old summaries add up to the unfiltered totals",
    close(recentOnly.paidTotal + oldOnly.paidTotal, all.paidTotal) &&
      close(recentOnly.outstanding + oldOnly.outstanding, all.outstanding),
    `recent=${JSON.stringify(recentOnly)} old=${JSON.stringify(oldOnly)}`,
  );

  // from-only (open-ended) range: everything from the recent window onward.
  const fromOnlyRes = await req("GET", `/invoices?from=${recentFrom}`, { token: ownerToken });
  check("GET ?from= (open-ended) -> 200", fromOnlyRes.status === 200, `got ${fromOnlyRes.status}`);
  checkSummary("from-only (open-ended)", fromOnlyRes.json?.summary, recentOnly);

  // to-only (open-ended) range ending before the recent window: old only.
  const toOnlyRes = await req("GET", `/invoices?to=${oldTo}`, { token: ownerToken });
  check("GET ?to= (open-ended) -> 200", toOnlyRes.status === 200, `got ${toOnlyRes.status}`);
  checkSummary("to-only (open-ended)", toOnlyRes.json?.summary, oldOnly);

  // Date range combined with an existing filter.
  console.log("\nCombined status=paid + date-range filter:");
  const paidOld = expectationFor(seeded.filter((i) => i.status === "paid" && i.period === "old"));
  const paidOldRes = await req(
    "GET",
    `/invoices?status=paid&from=${oldFrom}&to=${oldTo}`,
    { token: ownerToken },
  );
  check("GET ?status=paid&from/to -> 200", paidOldRes.status === 200, `got ${paidOldRes.status}`);
  checkSummary("status=paid & old window", paidOldRes.json?.summary, paidOld);

  // An empty window between the two clusters matches nothing.
  const emptyFrom = ymd(new Date(Date.now() - 30 * DAY));
  const emptyTo = ymd(new Date(Date.now() - 20 * DAY));
  const emptyRes = await req("GET", `/invoices?from=${emptyFrom}&to=${emptyTo}`, { token: ownerToken });
  check("GET ?from/to (empty window) -> 200", emptyRes.status === 200, `got ${emptyRes.status}`);
  check(
    "empty window total is 0",
    Number(emptyRes.json?.total) === 0,
    `got ${emptyRes.json?.total}`,
  );
  checkSummary("empty window", emptyRes.json?.summary, {
    outstanding: 0,
    paidTotal: 0,
    paidOnline: 0,
    paidOffline: 0,
  });

  // --- Summary --------------------------------------------------------------
  console.log(`\nInvoice summary e2e: ${passes} passed, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Unexpected error in invoice-summary e2e:", err);
  process.exit(1);
});
