#!/usr/bin/env node
/**
 * E2E test: GET /export/invoices honors the same filters as GET /invoices
 * (status, paymentMethod, customerId, from/to date range), so the CSV a
 * manager downloads matches the filtered list on screen.
 *
 * Seeds invoices in varied states via the API + direct DB tweaks (same
 * pattern as invoice-summary.e2e.mjs), then downloads the CSV with each
 * filter combination and asserts exactly the expected invoice IDs appear.
 *
 * Date semantics mirror the list endpoint: paid invoices bucket by
 * coalesce(paid_at, created_at); everything else by created_at; a date-only
 * `to` is inclusive of the whole day.
 *
 * Usage: API_BASE="https://<host>/api" node tests/invoice-export-filters.e2e.mjs
 * Exit code 0 = all checks passed, 1 = at least one failed.
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
    /* CSV or non-JSON is fine */
  }
  return { status: res.status, json };
}

async function fetchCsv(path, token) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  return { status: res.status, text };
}

// Parse the exported CSV and return the set of invoice IDs (first column).
function csvInvoiceIds(text) {
  const lines = text.trim().split("\n");
  const ids = new Set();
  for (let i = 1; i < lines.length; i++) {
    const first = lines[i].split(",")[0];
    const n = Number(first);
    if (!Number.isNaN(n)) ids.add(n);
  }
  return ids;
}

function sameIds(actual, expectedArr) {
  const expected = new Set(expectedArr);
  if (actual.size !== expected.size) return false;
  for (const id of expected) if (!actual.has(id)) return false;
  return true;
}

async function checkExport(label, path, token, expectedInvoices) {
  const { status, text } = await fetchCsv(path, token);
  check(`${label}: -> 200`, status === 200, `got ${status}`);
  const ids = csvInvoiceIds(text);
  check(
    `${label}: CSV rows match expected invoices (${expectedInvoices.length})`,
    sameIds(ids, expectedInvoices.map((i) => i.id)),
    `got [${[...ids].sort((a, b) => a - b)}], want [${expectedInvoices.map((i) => i.id).sort((a, b) => a - b)}]`,
  );
}

async function main() {
  console.log(`Invoice CSV export filter e2e against: ${BASE}\n`);

  const nsPrefix = process.env.TEST_RUN_NS ? `${process.env.TEST_RUN_NS}_` : "";
  const ownerEmail = `${nsPrefix}invexp_owner_${stamp}@example.com`;
  const reg = await req("POST", "/auth/register", {
    body: {
      firstName: "Olive",
      lastName: "Owner",
      email: ownerEmail,
      password: PASSWORD,
      companyName: `Invoice Export Test ${stamp}`,
      selectedPlan: "pro",
    },
  });
  if (reg.status !== 201) {
    console.error("Setup failed: register", reg.status, reg.json);
    process.exit(1);
  }
  const { markOwnerVerified } = await import("./verify-owner.mjs");
  await markOwnerVerified(ownerEmail);
  const login = await req("POST", "/auth/login", { body: { identifier: ownerEmail, password: PASSWORD } });
  const token = login.json?.token;
  if (!token) {
    console.error("Setup failed: login", login.status, login.json);
    process.exit(1);
  }

  const mkCustomer = async (label) => {
    const r = await req("POST", "/customers", {
      token,
      body: { firstName: "Cara", lastName: `Cust${label}`, phone: `555${stamp}`.slice(0, 11) + label },
    });
    if (r.status !== 201) {
      console.error("Setup failed: customer", r.status, r.json);
      process.exit(1);
    }
    return r.json.id;
  };
  const custA = await mkCustomer("A");
  const custB = await mkCustomer("B");

  // Seed matrix: status / paymentMethod / period (recent vs ~40 days old).
  const DAY = 24 * 60 * 60 * 1000;
  const oldDate = new Date(Date.now() - 40 * DAY);
  const specs = [
    { status: "draft", method: null, period: "recent", cust: custA },
    { status: "sent", method: null, period: "recent", cust: custB },
    { status: "sent", method: null, period: "old", cust: custA },
    { status: "paid", method: "card", period: "recent", cust: custB },
    { status: "paid", method: "card", period: "old", cust: custA },
    { status: "paid", method: "cash", period: "recent", cust: custA },
    { status: "paid", method: "cash", period: "old", cust: custB },
    { status: "overdue", method: null, period: "recent", cust: custA },
  ];
  const seeded = [];
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    const r = await req("POST", "/invoices", {
      token,
      body: {
        customerId: s.cust,
        status: "draft",
        lineItems: [{ description: `Service ${i}`, quantity: 1, unitPrice: 10 + i }],
      },
    });
    if (r.status !== 201 || !r.json?.id) {
      console.error(`Setup failed: invoice #${i}`, r.status, r.json);
      process.exit(1);
    }
    seeded.push({ id: r.json.id, ...s });
  }

  const cs = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
  if (!cs) {
    console.error("DATABASE_URL not set; cannot seed invoice states.");
    process.exit(1);
  }
  const client = new pg.Client({
    connectionString: cs,
    ssl: process.env.NEON_DATABASE_URL ? true : undefined,
  });
  await client.connect();
  try {
    for (const inv of seeded) {
      const effective = inv.period === "old" ? oldDate.toISOString() : null;
      await client.query(
        `UPDATE invoices
            SET status = $1,
                payment_method = $2,
                paid_at = CASE WHEN $1 = 'paid' THEN COALESCE($3::timestamptz, now()) ELSE NULL END,
                created_at = COALESCE($3::timestamptz, created_at)
          WHERE id = $4`,
        [inv.status, inv.method, effective, inv.id],
      );
    }
  } finally {
    await client.end();
  }

  const ymd = (d) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  const recentFrom = ymd(new Date(Date.now() - 2 * DAY));
  const recentTo = ymd(new Date());
  const oldFrom = ymd(new Date(oldDate.getTime() - 2 * DAY));
  const oldTo = ymd(new Date(oldDate.getTime() + 2 * DAY));

  console.log("Unfiltered export — all invoices:");
  await checkExport("no filters", "/export/invoices", token, seeded);

  console.log("\nstatus filter:");
  await checkExport(
    "status=paid",
    "/export/invoices?status=paid",
    token,
    seeded.filter((i) => i.status === "paid"),
  );
  await checkExport(
    "status=sent",
    "/export/invoices?status=sent",
    token,
    seeded.filter((i) => i.status === "sent"),
  );

  console.log("\npaymentMethod filter:");
  await checkExport(
    "paymentMethod=cash",
    "/export/invoices?paymentMethod=cash",
    token,
    seeded.filter((i) => i.method === "cash"),
  );

  console.log("\ncustomerId filter:");
  await checkExport(
    "customerId=A",
    `/export/invoices?customerId=${custA}`,
    token,
    seeded.filter((i) => i.cust === custA),
  );

  console.log("\nDate range filter (paid bucketed by paid_at, others by created_at):");
  await checkExport(
    "recent window",
    `/export/invoices?from=${recentFrom}&to=${recentTo}`,
    token,
    seeded.filter((i) => i.period === "recent"),
  );
  await checkExport(
    "old window",
    `/export/invoices?from=${oldFrom}&to=${oldTo}`,
    token,
    seeded.filter((i) => i.period === "old"),
  );
  await checkExport(
    "from-only (open-ended)",
    `/export/invoices?from=${recentFrom}`,
    token,
    seeded.filter((i) => i.period === "recent"),
  );

  console.log("\nCombined filters:");
  await checkExport(
    "status=paid & old window",
    `/export/invoices?status=paid&from=${oldFrom}&to=${oldTo}`,
    token,
    seeded.filter((i) => i.status === "paid" && i.period === "old"),
  );
  await checkExport(
    "status=paid & paymentMethod=card & customerId=B",
    `/export/invoices?status=paid&paymentMethod=card&customerId=${custB}`,
    token,
    seeded.filter((i) => i.status === "paid" && i.method === "card" && i.cust === custB),
  );

  console.log("\nEmpty window matches nothing:");
  const emptyFrom = ymd(new Date(Date.now() - 30 * DAY));
  const emptyTo = ymd(new Date(Date.now() - 20 * DAY));
  await checkExport(
    "empty window",
    `/export/invoices?from=${emptyFrom}&to=${emptyTo}`,
    token,
    [],
  );

  console.log(`\nInvoice export filter e2e: ${passes} passed, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Unexpected error in invoice-export-filters e2e:", err);
  process.exit(1);
});
