#!/usr/bin/env node
/**
 * Regression test for per-company invoice-number generation.
 *
 * This guards two historical bugs in the invoice create path:
 *
 *   1. The number query used `SELECT MAX(...) ... FOR UPDATE`, which Postgres
 *      rejects (row locking on an aggregate). That made EVERY invoice create
 *      return a 500. This suite asserts plain sequential creates succeed (201)
 *      and produce monotonically increasing, zero-padded `INV-NNNN` numbers.
 *
 *   2. There was no transaction/lock and no UNIQUE(company_id, invoice_number)
 *      constraint, so concurrent creates could read the same MAX and mint
 *      duplicate numbers. This suite fires a burst of concurrent creates and
 *      asserts every one succeeds with a DISTINCT number — exercising the
 *      unique constraint + retry loop in lib/invoice-number.ts.
 *
 * Black-box: talks to a RUNNING api-server over HTTP and self-provisions its
 * own company so the run is repeatable and isolated.
 *
 * Usage:
 *   API_BASE="https://<host>/api" node tests/invoice-number.e2e.mjs
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

async function registerCompany(label) {
  const nsPrefix = process.env.TEST_RUN_NS ? `${process.env.TEST_RUN_NS}_` : "";
  const ownerEmail = `${nsPrefix}invnum_${label}_owner_${stamp}@example.com`;
  const reg = await req("POST", "/auth/register", {
    body: {
      firstName: "Olive",
      lastName: "Owner",
      email: ownerEmail,
      password: PASSWORD,
      companyName: `Invoice Number Test ${label} ${stamp}`,
      selectedPlan: "pro",
    },
  });
  // Self-serve owners register UNVERIFIED with no token; flip the verification
  // gate in the test DB (mirrors clicking the emailed link), then log in.
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
    body: { firstName: "Cara", lastName: "Customer", phone: `555${stamp}`.slice(0, 12) + label },
  });
  if (created.status !== 201 || !created.json?.id) {
    console.error(`Setup failed: could not create customer for ${label}`, created.status, created.json);
    process.exit(1);
  }
  return created.json.id;
}

function createInvoice(ownerToken, customerId) {
  return req("POST", "/invoices", {
    token: ownerToken,
    body: {
      customerId,
      status: "draft",
      lineItems: [{ description: "Lawn mowing", quantity: 1, unitPrice: 100 }],
    },
  });
}

const NUM_RE = /^INV-\d{4,}$/;

async function main() {
  console.log(`Invoice-number generation e2e against: ${BASE}\n`);

  const ownerToken = await registerCompany("A");
  const customerId = await createCustomer(ownerToken, "A");

  // --- 1. Sequential creates succeed and increment --------------------------
  console.log("Sequential creates — must 201 with increasing INV-NNNN numbers:");
  const seqNumbers = [];
  for (let i = 0; i < 3; i++) {
    const r = await createInvoice(ownerToken, customerId);
    check(`sequential create #${i + 1} -> 201`, r.status === 201, `got ${r.status} ${JSON.stringify(r.json)}`);
    check(`sequential #${i + 1} number matches INV-NNNN`, NUM_RE.test(r.json?.invoiceNumber ?? ""), `got ${r.json?.invoiceNumber}`);
    if (r.json?.invoiceNumber) seqNumbers.push(r.json.invoiceNumber);
  }
  check(
    "sequential numbers are all distinct",
    new Set(seqNumbers).size === seqNumbers.length,
    JSON.stringify(seqNumbers),
  );
  const seqInts = seqNumbers.map((n) => Number(n.replace(/[^0-9]/g, "")));
  check(
    "sequential numbers strictly increase",
    seqInts.every((v, i) => i === 0 || v > seqInts[i - 1]),
    JSON.stringify(seqInts),
  );

  // --- 2. Concurrent burst: every create distinct, none 500 -----------------
  console.log("\nConcurrent burst — every create must 201 with a DISTINCT number:");
  const BURST = 8;
  const results = await Promise.all(
    Array.from({ length: BURST }, () => createInvoice(ownerToken, customerId)),
  );
  const okCount = results.filter((r) => r.status === 201).length;
  check(`all ${BURST} concurrent creates returned 201`, okCount === BURST, `only ${okCount}/${BURST} succeeded`);
  const burstNumbers = results.map((r) => r.json?.invoiceNumber).filter(Boolean);
  check(
    "all concurrent numbers are distinct (no duplicate INV-NNNN)",
    new Set(burstNumbers).size === burstNumbers.length && burstNumbers.length === BURST,
    JSON.stringify(burstNumbers),
  );

  // --- 3. The full set (sequential + burst) is gap-free ---------------------
  // This company was freshly provisioned, so every invoice it has was created by
  // this run. Their numbers must form one contiguous, gap-free ascending run.
  const allInts = [...seqInts, ...burstNumbers.map((n) => Number(n.replace(/[^0-9]/g, "")))].sort((a, b) => a - b);
  const expectedCount = seqNumbers.length + burstNumbers.length;
  const contiguous =
    allInts.length === expectedCount &&
    new Set(allInts).size === allInts.length &&
    allInts.every((v, i) => i === 0 || v === allInts[i - 1] + 1);
  check(
    "all created invoice numbers form a gap-free contiguous sequence",
    contiguous,
    JSON.stringify(allInts),
  );

  // --- Summary --------------------------------------------------------------
  console.log(`\nInvoice-number e2e: ${passes} passed, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Unexpected error in invoice-number e2e:", err);
  process.exit(1);
});
