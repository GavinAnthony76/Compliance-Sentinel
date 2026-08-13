#!/usr/bin/env node
/**
 * E2E test: GET /export/appointments honors the same filters as
 * GET /appointments (status, customerId, assignedUserId, startDate/endDate on
 * scheduled_start), so the CSV a manager downloads matches the filtered list
 * on screen.
 *
 * Seeds appointments in varied states via the API, then downloads the CSV
 * with each filter combination and asserts exactly the expected appointment
 * IDs appear.
 *
 * Usage: API_BASE="https://<host>/api" node tests/appointment-export-filters.e2e.mjs
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

// Parse the exported CSV and return the set of appointment IDs (first column).
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
    `${label}: CSV rows match expected appointments (${expected.length})`,
    sameIds(ids, expected.map((a) => a.id)),
    `got [${[...ids].sort((a, b) => a - b)}], want [${expected.map((a) => a.id).sort((a, b) => a - b)}]`,
  );
}

async function main() {
  console.log(`Appointment CSV export filter e2e against: ${BASE}\n`);

  const nsPrefix = process.env.TEST_RUN_NS ? `${process.env.TEST_RUN_NS}_` : "";
  const ownerEmail = `${nsPrefix}apptexp_owner_${stamp}@example.com`;
  const reg = await req("POST", "/auth/register", {
    body: {
      firstName: "Olive",
      lastName: "Owner",
      email: ownerEmail,
      password: PASSWORD,
      companyName: `Appt Export Test ${stamp}`,
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

  // A team member so assignedUserId filtering can be exercised.
  const memberEmail = `${nsPrefix}apptexp_staff_${stamp}@example.com`;
  const inv = await req("POST", "/team", {
    token,
    body: { firstName: "Sam", lastName: "Staff", email: memberEmail, role: "staff", password: PASSWORD },
  });
  const staffId = inv.json?.id ?? inv.json?.member?.id ?? null;
  if (!staffId) {
    console.error("Setup failed: team member", inv.status, inv.json);
    process.exit(1);
  }

  // Seed matrix: status / customer / assignee / period (recent vs ~40 days out).
  const DAY = 24 * 60 * 60 * 1000;
  const recent = new Date(Date.now() + 1 * DAY);
  const far = new Date(Date.now() + 40 * DAY);
  const specs = [
    { status: "pending", cust: custA, assignee: null, period: "recent" },
    { status: "confirmed", cust: custB, assignee: staffId, period: "recent" },
    { status: "confirmed", cust: custA, assignee: null, period: "far" },
    { status: "completed", cust: custB, assignee: staffId, period: "recent" },
    { status: "completed", cust: custA, assignee: null, period: "far" },
    { status: "cancelled", cust: custA, assignee: staffId, period: "far" },
  ];
  const seeded = [];
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    const start = new Date((s.period === "recent" ? recent : far).getTime() + i * 60 * 1000);
    const r = await req("POST", "/appointments", {
      token,
      body: {
        customerId: s.cust,
        assignedUserId: s.assignee ?? undefined,
        status: s.status === "pending" || s.status === "confirmed" ? s.status : "pending",
        scheduledStart: start.toISOString(),
      },
    });
    if (r.status !== 201 || !r.json?.id) {
      console.error(`Setup failed: appointment #${i}`, r.status, r.json);
      process.exit(1);
    }
    // Statuses beyond create-schema's pending/confirmed are set via update.
    if (s.status !== "pending" && s.status !== "confirmed") {
      const u = await req("PUT", `/appointments/${r.json.id}`, { token, body: { status: s.status } });
      if (u.status !== 200) {
        console.error(`Setup failed: status update #${i}`, u.status, u.json);
        process.exit(1);
      }
    }
    seeded.push({ id: r.json.id, ...s, start });
  }

  const ymd = (d) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

  console.log("Unfiltered export — all appointments:");
  await checkExport("no filters", "/export/appointments", token, seeded);

  console.log("\nstatus filter:");
  await checkExport(
    "status=confirmed",
    "/export/appointments?status=confirmed",
    token,
    seeded.filter((a) => a.status === "confirmed"),
  );
  await checkExport(
    "status=completed",
    "/export/appointments?status=completed",
    token,
    seeded.filter((a) => a.status === "completed"),
  );

  console.log("\ncustomerId filter:");
  await checkExport(
    "customerId=A",
    `/export/appointments?customerId=${custA}`,
    token,
    seeded.filter((a) => a.cust === custA),
  );

  console.log("\nassignedUserId filter:");
  await checkExport(
    "assignedUserId=staff",
    `/export/appointments?assignedUserId=${staffId}`,
    token,
    seeded.filter((a) => a.assignee === staffId),
  );

  console.log("\nDate range filter (on scheduled_start):");
  const recentFrom = ymd(new Date(recent.getTime() - 1 * DAY));
  const recentTo = ymd(new Date(recent.getTime() + 2 * DAY));
  const farFrom = ymd(new Date(far.getTime() - 2 * DAY));
  await checkExport(
    "recent window",
    `/export/appointments?startDate=${recentFrom}&endDate=${recentTo}`,
    token,
    seeded.filter((a) => a.period === "recent"),
  );
  await checkExport(
    "far window (open-ended)",
    `/export/appointments?startDate=${farFrom}`,
    token,
    seeded.filter((a) => a.period === "far"),
  );

  console.log("\nCombined filters:");
  await checkExport(
    "status=completed & customerId=B",
    `/export/appointments?status=completed&customerId=${custB}`,
    token,
    seeded.filter((a) => a.status === "completed" && a.cust === custB),
  );
  await checkExport(
    "status=confirmed & assignedUserId & recent window",
    `/export/appointments?status=confirmed&assignedUserId=${staffId}&startDate=${recentFrom}&endDate=${recentTo}`,
    token,
    seeded.filter((a) => a.status === "confirmed" && a.assignee === staffId && a.period === "recent"),
  );

  console.log("\nEmpty window matches nothing:");
  const emptyFrom = ymd(new Date(Date.now() - 30 * DAY));
  const emptyTo = ymd(new Date(Date.now() - 20 * DAY));
  await checkExport(
    "empty window",
    `/export/appointments?startDate=${emptyFrom}&endDate=${emptyTo}`,
    token,
    [],
  );

  console.log("\nStaff export is restricted to own assignments:");
  const staffLogin = await req("POST", "/auth/login", { body: { identifier: memberEmail, password: PASSWORD } });
  const staffToken = staffLogin.json?.token;
  if (staffToken) {
    await checkExport(
      "staff no filters",
      "/export/appointments",
      staffToken,
      seeded.filter((a) => a.assignee === staffId),
    );
    // A staff member cannot widen the export by passing another assignee.
    await checkExport(
      "staff cannot override assignedUserId",
      "/export/appointments?assignedUserId=999999",
      staffToken,
      seeded.filter((a) => a.assignee === staffId),
    );
  } else {
    console.log("  SKIP  staff login unavailable:", staffLogin.status, JSON.stringify(staffLogin.json));
  }

  console.log(`\nAppointment export filter e2e: ${passes} passed, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Unexpected error in appointment-export-filters e2e:", err);
  process.exit(1);
});
