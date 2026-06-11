#!/usr/bin/env node
/**
 * End-to-end verification of row-level lead ownership over real HTTP.
 *
 * The pure predicate (canAccessLead) is unit tested in lead-ownership.test.mjs,
 * and the router-level role gating is covered in permissions.e2e.mjs. Neither of
 * those drives the real-world path now that staff can reach the lead routes:
 * a lead is created and assigned to a specific staff member, and we confirm that
 * staff member — and ONLY that staff member — can read and update it over HTTP.
 *
 * This is a black-box test: it talks to a RUNNING api-server and self-provisions
 * a fresh company (owner) plus two staff members so the run is repeatable and
 * independent of existing data.
 *
 * Usage:
 *   API_BASE="https://<host>/api" node tests/lead-ownership.e2e.mjs
 *   # or, inside the Replit workspace, it derives the base from REPLIT_DEV_DOMAIN
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
const nsPrefix = process.env.TEST_RUN_NS ? `${process.env.TEST_RUN_NS}_` : "";
const ownerEmail = `${nsPrefix}lead_owner_${stamp}@example.com`;
const staffAEmail = `lead_staff_a_${stamp}@example.com`;
const staffBEmail = `lead_staff_b_${stamp}@example.com`;

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

async function createStaff(ownerToken, { firstName, lastName, email }) {
  const created = await req("POST", "/team", {
    token: ownerToken,
    body: { firstName, lastName, email, password: PASSWORD, role: "staff" },
  });
  if (created.status !== 201 || !created.json?.id) {
    console.error("Setup failed: could not create staff", email, created.status, created.json);
    process.exit(1);
  }
  const login = await req("POST", "/auth/login", {
    body: { email, password: PASSWORD },
  });
  if (login.status !== 200 || !login.json?.token) {
    console.error("Setup failed: could not log in staff", email, login.status, login.json);
    process.exit(1);
  }
  return { id: created.json.id, token: login.json.token };
}

async function main() {
  console.log(`Lead ownership e2e against: ${BASE}\n`);

  // --- Provision owner (manager) + two staff in the same company ------------
  const reg = await req("POST", "/auth/register", {
    body: {
      firstName: "Olive",
      lastName: "Owner",
      email: ownerEmail,
      password: PASSWORD,
      companyName: `Lead Test Co ${stamp}`,
      selectedPlan: "pro",
    },
  });
  if (reg.status !== 201 || !reg.json?.token) {
    console.error("Setup failed: could not register owner", reg.status, reg.json);
    process.exit(1);
  }
  const ownerToken = reg.json.token;

  const staffA = await createStaff(ownerToken, {
    firstName: "Aaron",
    lastName: "AssignedA",
    email: staffAEmail,
  });
  const staffB = await createStaff(ownerToken, {
    firstName: "Bea",
    lastName: "BystanderB",
    email: staffBEmail,
  });

  // --- Manager creates a lead assigned to staff A ---------------------------
  const createLead = await req("POST", "/leads", {
    token: ownerToken,
    body: {
      firstName: "Larry",
      lastName: "Lead",
      source: "manual",
      status: "new",
      assignedUserId: staffA.id,
    },
  });
  if (createLead.status !== 201 || !createLead.json?.id) {
    console.error("Setup failed: could not create lead", createLead.status, createLead.json);
    process.exit(1);
  }
  const leadId = createLead.json.id;
  check(
    "lead is assigned to staff A on creation",
    createLead.json.assignedUserId === staffA.id,
    `got ${createLead.json.assignedUserId}, expected ${staffA.id}`,
  );

  // --- Staff A (assigned) can READ the lead ---------------------------------
  console.log("\nStaff A is assigned the lead and must be able to act on it:");
  {
    const r = await req("GET", `/leads/${leadId}`, { token: staffA.token });
    check(`GET /leads/${leadId} -> 200 for assigned staff A`, r.status === 200, `got ${r.status}`);
    check(
      "GET returns the correct lead to staff A",
      r.json?.id === leadId,
      `got id ${r.json?.id}`,
    );
  }

  // --- Staff A (assigned) can UPDATE the lead -------------------------------
  {
    const r = await req("PUT", `/leads/${leadId}`, {
      token: staffA.token,
      body: { status: "contacted", notes: "Spoke with the customer." },
    });
    check(`PUT /leads/${leadId} -> 200 for assigned staff A`, r.status === 200, `got ${r.status}`);
    check(
      "PUT applies staff A's update",
      r.json?.status === "contacted",
      `got status ${r.json?.status}`,
    );
  }

  // --- Staff A cannot change assignedUserId (reassignment is manager-only) ---
  {
    const r = await req("PUT", `/leads/${leadId}`, {
      token: staffA.token,
      body: { assignedUserId: staffB.id },
    });
    check(
      `PUT /leads/${leadId} ignores assignedUserId change by staff A`,
      r.status === 200 && r.json?.assignedUserId === staffA.id,
      `status ${r.status}, assignedUserId ${r.json?.assignedUserId} (expected ${staffA.id})`,
    );
  }

  // --- Staff B (not assigned) is FORBIDDEN ----------------------------------
  console.log("\nStaff B is NOT assigned the lead and must be forbidden:");
  {
    const r = await req("GET", `/leads/${leadId}`, { token: staffB.token });
    check(`GET /leads/${leadId} -> 403 for unassigned staff B`, r.status === 403, `got ${r.status}`);
  }
  {
    const r = await req("PUT", `/leads/${leadId}`, {
      token: staffB.token,
      body: { status: "won" },
    });
    check(`PUT /leads/${leadId} -> 403 for unassigned staff B`, r.status === 403, `got ${r.status}`);
  }

  // --- Staff B does not see the lead in their pipeline list ------------------
  {
    const r = await req("GET", "/leads", { token: staffB.token });
    const ids = Array.isArray(r.json?.leads) ? r.json.leads.map((l) => l.id) : [];
    check(
      "GET /leads list does not include the lead for unassigned staff B",
      r.status === 200 && !ids.includes(leadId),
      `status ${r.status}, ids ${JSON.stringify(ids)}`,
    );
  }

  // --- Staff A DOES see the lead in their pipeline list ----------------------
  {
    const r = await req("GET", "/leads", { token: staffA.token });
    const ids = Array.isArray(r.json?.leads) ? r.json.leads.map((l) => l.id) : [];
    check(
      "GET /leads list includes the lead for assigned staff A",
      r.status === 200 && ids.includes(leadId),
      `status ${r.status}, ids ${JSON.stringify(ids)}`,
    );
  }

  // --- Summary --------------------------------------------------------------
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
