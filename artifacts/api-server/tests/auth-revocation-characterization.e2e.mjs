#!/usr/bin/env node
/**
 * REVIEW-A — end-to-end characterization of session revocation for company
 * users, against a RUNNING api-server (self-provisioned company + staff).
 *
 * Asserts the approved REVIEW-A policy (docs/claude-handoff/reviews/REVIEW-A-auth-policy.md):
 * deactivating or demoting a team member takes effect on tokens ALREADY
 * issued, portal invites go through the same guard, and an administratively
 * suspended company keeps only session + billing-recovery access.
 *
 * Exit code 0 = all checks passed, 1 = at least one check failed.
 */

const BASE =
  process.env.API_BASE ||
  (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}/api` : "http://localhost:5000/api");
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
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON response is fine */
  }
  return { status: res.status, json };
}

async function main() {
  console.log(`Auth revocation characterization e2e against: ${BASE}\n`);

  const nsPrefix = process.env.TEST_RUN_NS ? `${process.env.TEST_RUN_NS}_` : "";
  const ownerEmail = `${nsPrefix}authrev_owner_${stamp}@example.com`;
  const reg = await req("POST", "/auth/register", {
    body: { firstName: "Olive", lastName: "Owner", email: ownerEmail, password: PASSWORD, companyName: `AuthRev ${stamp}`, selectedPlan: "pro" },
  });
  if (reg.status !== 201) {
    console.error("Setup failed: register", reg.status, reg.json);
    process.exit(1);
  }
  const { markOwnerVerified } = await import("./verify-owner.mjs");
  await markOwnerVerified(ownerEmail);
  const ownerToken = (await req("POST", "/auth/login", { body: { identifier: ownerEmail, password: PASSWORD } })).json?.token;

  const makeMember = async (label, role) => {
    const email = `authrev_${label}_${stamp}@example.com`;
    const created = await req("POST", "/team", { token: ownerToken, body: { firstName: "Mo", lastName: label, email, password: PASSWORD, role } });
    const login = await req("POST", "/auth/login", { body: { identifier: email, password: PASSWORD } });
    if (created.status !== 201 || !login.json?.token) {
      console.error(`Setup failed: member ${label}`, created.status, login.status);
      process.exit(1);
    }
    return { id: created.json.id, email, token: login.json.token };
  };

  console.log("Deactivated staff member:");
  const staff = await makeMember("staff", "staff");
  {
    const r = await req("GET", "/customers", { token: staff.token });
    check("before deactivation the staff token works", r.status === 200, `got ${r.status}`);
  }
  {
    const r = await req("PUT", `/team/${staff.id}`, { token: ownerToken, body: { isActive: false } });
    check("owner deactivates the staff member", r.status === 200 && r.json?.isActive === false, `got ${r.status}`);
  }
  {
    const r = await req("POST", "/auth/login", { body: { identifier: staff.email, password: PASSWORD } });
    check("a deactivated member cannot log in again", r.status !== 200 || !r.json?.token, `got ${r.status}`);
  }
  {
    const r = await req("GET", "/customers", { token: staff.token });
    check("A1: the deactivated member's existing token can no longer read (401)", r.status === 401, `got ${r.status}`);
  }
  {
    const r = await req("POST", "/customers", { token: staff.token, body: { firstName: "Ghost", lastName: "Write", phone: `444${stamp}`.slice(0, 12) } });
    check("A1: ...or write (401)", r.status === 401, `got ${r.status}`);
  }

  console.log("\nDemoted admin:");
  const manager = await makeMember("manager", "admin");
  {
    const r = await req("PUT", `/team/${manager.id}`, { token: ownerToken, body: { role: "staff" } });
    check("owner demotes the admin to staff", r.status === 200 && r.json?.role === "staff", `got ${r.status} ${r.json?.role}`);
  }
  {
    // /invoices is owner/admin-only (requireRole) — a staff role must get 403.
    const r = await req("GET", "/invoices", { token: manager.token });
    check("A4: the demoted member's old token is held to the CURRENT role (403 on an admin-only route)", r.status === 403, `got ${r.status}`);
  }

  console.log("\nPortal invites use the shared guard (A9):");
  {
    const r = await req("POST", "/portal/auth/send-invite", { token: staff.token, body: { customerId: 1 } });
    check("a deactivated member's token cannot send portal invites (401)", r.status === 401, `got ${r.status}`);
  }

  console.log("\nAdministratively suspended company (A8):");
  {
    // Mirrors POST /admin/companies/:id/suspend (sets companies.is_active=false)
    // directly in the throwaway test DB, like verify-owner.mjs does.
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query(
        "UPDATE companies SET is_active = false WHERE id = (SELECT company_id FROM users WHERE email = $1)",
        [ownerEmail.toLowerCase()],
      );
    } finally {
      await client.end();
    }
    const blocked = await req("GET", "/customers", { token: ownerToken });
    check("suspended company: operational reads are blocked (403 CompanySuspended)", blocked.status === 403 && blocked.json?.error === "CompanySuspended", `got ${blocked.status} ${blocked.json?.error}`);
    const write = await req("POST", "/customers", { token: ownerToken, body: { firstName: "Sus", lastName: "Pended", phone: `333${stamp}`.slice(0, 12) } });
    check("suspended company: writes are blocked (403)", write.status === 403, `got ${write.status}`);
    const me = await req("GET", "/auth/me", { token: ownerToken });
    check("suspended company: the session endpoint still works (200)", me.status === 200, `got ${me.status}`);
    const billing = await req("GET", "/billing/status", { token: ownerToken });
    check("suspended company: billing recovery is still reachable (not 403 CompanySuspended)", billing.json?.error !== "CompanySuspended" && billing.status < 500, `got ${billing.status} ${billing.json?.error}`);
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
