#!/usr/bin/env node
/**
 * REVIEW-A — end-to-end characterization of session revocation for company
 * users, against a RUNNING api-server (self-provisioned company + staff).
 *
 * Pins CURRENT behavior recorded in docs/claude-handoff/reviews/REVIEW-A-auth-policy.md:
 * deactivating or demoting a team member blocks NEW logins, but a token issued
 * before the change keeps working until it expires (7 days), because
 * requireAuth never re-reads is_active or role. "FINDING" checks document that
 * gap; when a revocation policy is approved, flip them deliberately.
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
    check("FINDING A1: the deactivated member's existing token still reads data", r.status === 200, `got ${r.status}`);
  }
  {
    const r = await req("POST", "/customers", { token: staff.token, body: { firstName: "Ghost", lastName: "Write", phone: `444${stamp}`.slice(0, 12) } });
    check("FINDING A1: ...and still writes data", r.status === 201, `got ${r.status}`);
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
    check("FINDING A4: the demoted member's old token still passes the admin-only role check", r.status === 200, `got ${r.status}`);
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
