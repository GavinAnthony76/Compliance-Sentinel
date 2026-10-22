#!/usr/bin/env node
/**
 * E2E test: GET /export/customers honors the same `search` param as
 * GET /customers (name / email / phone ILIKE match), so the CSV a manager
 * downloads matches the searched list on screen.
 *
 * Seeds customers with distinct names/emails/phones via the API, then
 * downloads the CSV with each search term and asserts exactly the expected
 * customer IDs appear.
 *
 * Usage: API_BASE="https://<host>/api" node tests/customer-export-filters.e2e.mjs
 * Exit code 0 = all checks passed, 1 = at least one failed.
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

// Parse the exported CSV and return the set of customer IDs (first column).
function csvIds(text) {
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

async function checkExport(label, path, token, expected) {
  const { status, text } = await fetchCsv(path, token);
  check(`${label}: -> 200`, status === 200, `got ${status}`);
  const ids = csvIds(text);
  check(
    `${label}: CSV rows match expected customers (${expected.length})`,
    sameIds(ids, expected.map((c) => c.id)),
    `got [${[...ids].sort((a, b) => a - b)}], want [${expected.map((c) => c.id).sort((a, b) => a - b)}]`,
  );
}

async function main() {
  console.log(`Customer CSV export filter e2e against: ${BASE}\n`);

  const nsPrefix = process.env.TEST_RUN_NS ? `${process.env.TEST_RUN_NS}_` : "";
  const ownerEmail = `${nsPrefix}custexp_owner_${stamp}@example.com`;
  const reg = await req("POST", "/auth/register", {
    body: {
      firstName: "Olive",
      lastName: "Owner",
      email: ownerEmail,
      password: PASSWORD,
      companyName: `Cust Export Test ${stamp}`,
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

  // Distinct names / emails / phones / addresses so each search term matches a known subset.
  const street = `${stamp} Juniper Ln`;
  const city = `Fernvale${stamp}`;
  const zip = `Z${stamp}`.slice(0, 12);
  const specs = [
    { firstName: "Zelda", lastName: `Maplewood${stamp}`, email: `zelda_${stamp}@example.com`, phone: `1555${stamp}`.slice(0, 10) + "01", addressLine1: street, city, zip },
    { firstName: "Zack", lastName: `Maplewood${stamp}`, email: `zack_${stamp}@rosemail.test`, phone: `1555${stamp}`.slice(0, 10) + "02", addressLine1: "1 Other Rd", city, zip: null },
    { firstName: "Quinn", lastName: `Oakhurst${stamp}`, email: `quinn_${stamp}@rosemail.test`, phone: `777${stamp}`.slice(0, 10) + "99", addressLine1: null, city: null, zip },
    { firstName: "Perry", lastName: `Oakhurst${stamp}`, email: null, phone: `777${stamp}`.slice(0, 10) + "98" },
  ];
  const seeded = [];
  for (const s of specs) {
    const r = await req("POST", "/customers", {
      token,
      body: {
        firstName: s.firstName, lastName: s.lastName, email: s.email ?? undefined, phone: s.phone,
        addressLine1: s.addressLine1 ?? undefined, city: s.city ?? undefined, zip: s.zip ?? undefined,
      },
    });
    if (r.status !== 201 || !r.json?.id) {
      console.error("Setup failed: customer", r.status, r.json);
      process.exit(1);
    }
    seeded.push({ id: r.json.id, ...s });
  }

  console.log("Unfiltered export — all customers:");
  await checkExport("no search", "/export/customers", token, seeded);

  console.log("\nSearch by last name:");
  await checkExport(
    "search=Maplewood",
    `/export/customers?search=${encodeURIComponent(`Maplewood${stamp}`)}`,
    token,
    seeded.filter((c) => c.lastName.startsWith("Maplewood")),
  );

  console.log("\nSearch by full name (first + last, case-insensitive):");
  await checkExport(
    "search='zelda maplewood'",
    `/export/customers?search=${encodeURIComponent(`zelda maplewood${stamp}`)}`,
    token,
    seeded.filter((c) => c.firstName === "Zelda"),
  );

  console.log("\nSearch by email domain:");
  await checkExport(
    "search=rosemail",
    "/export/customers?search=rosemail",
    token,
    seeded.filter((c) => c.email?.includes("rosemail")),
  );

  console.log("\nSearch by phone fragment:");
  await checkExport(
    "search=phone prefix 777",
    `/export/customers?search=${encodeURIComponent(`777${stamp}`.slice(0, 10))}`,
    token,
    seeded.filter((c) => c.phone.startsWith("777")),
  );

  console.log("\nSearch that matches nothing:");
  await checkExport(
    "search=no-such-customer",
    `/export/customers?search=nosuchcustomer_${stamp}`,
    token,
    [],
  );

  console.log("\nSearch by address (#214):");
  await checkExport(
    "search=street",
    `/export/customers?search=${encodeURIComponent(`${stamp} juniper ln`)}`,
    token,
    seeded.filter((c) => c.addressLine1 === street),
  );
  await checkExport(
    "search=city",
    `/export/customers?search=${encodeURIComponent(city.toLowerCase())}`,
    token,
    seeded.filter((c) => c.city === city),
  );
  await checkExport(
    "search=zip",
    `/export/customers?search=${encodeURIComponent(zip)}`,
    token,
    seeded.filter((c) => c.zip === zip),
  );
  {
    const listRes = await req("GET", `/customers?search=${encodeURIComponent(city)}&limit=100`, { token });
    const listIds = (listRes.json?.customers ?? []).map((c) => c.id).sort((a, b) => a - b);
    const { text } = await fetchCsv(`/export/customers?search=${encodeURIComponent(city)}`, token);
    const exportIds = [...csvIds(text)].sort((a, b) => a - b);
    check("address search: list vs export id parity", listIds.length === 2 && JSON.stringify(listIds) === JSON.stringify(exportIds), `list [${listIds}] vs export [${exportIds}]`);
  }
  {
    // Another tenant with a customer at the same address must never appear.
    const otherEmail = `${nsPrefix}custexp_other_${stamp}@example.com`;
    const reg2 = await req("POST", "/auth/register", {
      body: { firstName: "Otto", lastName: "Other", email: otherEmail, password: PASSWORD, companyName: `Cust Export Other ${stamp}`, selectedPlan: "pro" },
    });
    if (reg2.status !== 201) {
      console.error("Setup failed: register second company", reg2.status, reg2.json);
      process.exit(1);
    }
    await markOwnerVerified(otherEmail);
    const otherToken = (await req("POST", "/auth/login", { body: { identifier: otherEmail, password: PASSWORD } })).json?.token;
    const other = await req("POST", "/customers", {
      token: otherToken,
      body: { firstName: "Olga", lastName: "Neighbor", phone: `888${stamp}`.slice(0, 12), addressLine1: street, city, zip },
    });
    check("second tenant customer created", other.status === 201, `got ${other.status}`);
    const { text } = await fetchCsv(`/export/customers?search=${encodeURIComponent(city)}`, token);
    check("address search never returns another tenant's customer", !csvIds(text).has(other.json?.id), `leaked ${other.json?.id}`);
  }

  console.log("\nExport matches the list endpoint for the same search:");
  const listRes = await req("GET", `/customers?search=${encodeURIComponent(`Oakhurst${stamp}`)}&limit=100`, { token });
  const listIds = (listRes.json?.customers ?? []).map((c) => c.id).sort((a, b) => a - b);
  const { text } = await fetchCsv(`/export/customers?search=${encodeURIComponent(`Oakhurst${stamp}`)}`, token);
  const exportIds = [...csvIds(text)].sort((a, b) => a - b);
  check(
    "list vs export id parity",
    JSON.stringify(listIds) === JSON.stringify(exportIds),
    `list [${listIds}] vs export [${exportIds}]`,
  );

  console.log(`\nCustomer export filter e2e: ${passes} passed, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Unexpected error in customer-export-filters e2e:", err);
  process.exit(1);
});
