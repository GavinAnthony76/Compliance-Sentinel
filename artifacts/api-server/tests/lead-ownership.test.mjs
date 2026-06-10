#!/usr/bin/env node
/**
 * Unit test for the row-level lead ownership guard (`canAccessLead`).
 *
 * The lead-pipeline router currently blocks ALL non-managers at the router level
 * (requireRole("owner","admin")), so the assignedUserId ownership branch in
 * leads.ts is unreachable over HTTP today. That makes it impossible to exercise
 * via the black-box HTTP test in permissions.e2e.mjs.
 *
 * This test imports the SAME pure predicate the routes use (src/lib/lead-access)
 * and verifies its behavior directly, so if the router-level gating is ever
 * relaxed to let staff in, this second line of defense is proven to still:
 *   - let a staff member read/update a lead assigned to them, and
 *   - forbid them on a lead assigned to someone else (or unassigned).
 *
 * Node strips the TypeScript types on import, so no build step is required.
 *
 * Exit code 0 = all checks passed, 1 = at least one check failed.
 */

import { canAccessLead, isManagerRole } from "../src/lib/lead-access.ts";

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

console.log("Lead ownership guard unit test\n");

const staffA = { role: "staff", userId: 101 };
const staffB = { role: "staff", userId: 202 };
const owner = { role: "owner", userId: 1 };
const admin = { role: "admin", userId: 2 };

const leadAssignedToA = { assignedUserId: 101 };
const leadAssignedToB = { assignedUserId: 202 };
const unassignedLead = { assignedUserId: null };

// --- Staff: row-level ownership is enforced --------------------------------
console.log("Staff may only access leads assigned to them:");
check(
  "staff CAN access a lead assigned to them",
  canAccessLead(leadAssignedToA, staffA) === true,
);
check(
  "staff is FORBIDDEN on a lead assigned to someone else",
  canAccessLead(leadAssignedToB, staffA) === false,
);
check(
  "staff is FORBIDDEN on an unassigned lead",
  canAccessLead(unassignedLead, staffA) === false,
);
check(
  "a different staff member CAN access their own assigned lead",
  canAccessLead(leadAssignedToB, staffB) === true,
);

// --- Managers: bypass the row-level guard for any lead in the company ------
console.log("\nManagers (owner/admin) can access any lead in the company:");
check("owner can access a lead assigned to staff", canAccessLead(leadAssignedToB, owner) === true);
check("owner can access an unassigned lead", canAccessLead(unassignedLead, owner) === true);
check("admin can access a lead assigned to staff", canAccessLead(leadAssignedToA, admin) === true);
check("admin can access an unassigned lead", canAccessLead(unassignedLead, admin) === true);

// --- isManagerRole classification -----------------------------------------
console.log("\nRole classification:");
check("owner is a manager", isManagerRole("owner") === true);
check("admin is a manager", isManagerRole("admin") === true);
check("staff is NOT a manager", isManagerRole("staff") === false);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
