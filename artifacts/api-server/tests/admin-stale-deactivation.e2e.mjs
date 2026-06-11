#!/usr/bin/env node
/**
 * End-to-end coverage for the dormant-admin deactivation flow on the
 * platform-admin API (artifacts/api-server/src/routes/admin.ts).
 *
 * This logic has real security implications, so it is verified against a RUNNING
 * api-server over HTTP:
 *   1. PUT /admin/admins/:id must REJECT an admin deactivating their own account
 *      (400 CannotDeactivateSelf) — the self-lockout guard.
 *   2. POST /admin/admins/deactivate-stale must sweep only admins that have gone
 *      dormant (no sign-in for 90+ days, or never signed in) and must NEVER
 *      deactivate the acting admin (nor a recently-active admin).
 *   3. PUT /admin/admins/:id with { isActive: true } must flip a deactivated
 *      admin back to active AND write an `admin.admin_reactivated` activity log.
 *
 * Platform admins cannot be created over HTTP without an existing admin token
 * (chicken/egg), so this suite seeds its own throwaway admins directly in the DB
 * (with a unique @example.com email namespace), logs in as one to obtain a real
 * token, exercises the endpoints, and then removes everything it created.
 *
 * IMPORTANT: deactivate-stale operates GLOBALLY (every dormant admin in the DB).
 * Because the api-server talks to the shared production Neon database, this suite
 * snapshots which admins were active beforehand and RESTORES any real (non-seeded)
 * admin it may have swept, so a validation run can never lock out a real operator.
 *
 * Usage:
 *   API_BASE="https://<host>/api" node tests/admin-stale-deactivation.e2e.mjs
 *   # or, inside the Replit workspace, it derives the base from REPLIT_DEV_DOMAIN
 *
 * Exit code 0 = all checks passed, 1 = at least one check failed.
 */

import pg from "pg";
import bcrypt from "bcryptjs";

const BASE =
  process.env.API_BASE ||
  (process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}/api`
    : "http://localhost:5000/api");

// Must match STALE_ADMIN_DAYS in src/routes/admin.ts.
const STALE_ADMIN_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

const PASSWORD = "AdminTestPass123!";
const stamp = Date.now();
const ns = `admin_stale_${stamp}`;
const emailFor = (suffix) => `${ns}_${suffix}@example.com`;

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

// ─── DB helpers ───────────────────────────────────────────────────────────────
function connectionString() {
  const cs = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
  if (!cs) {
    throw new Error("NEON_DATABASE_URL / DATABASE_URL not set; cannot seed admin test data.");
  }
  return cs;
}

async function withClient(fn) {
  const client = new pg.Client({
    connectionString: connectionString(),
    ssl: process.env.NEON_DATABASE_URL ? true : undefined,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Insert a platform admin and return its row id. lastLoginAt may be null. */
async function seedAdmin(client, { suffix, lastLoginAt, role = "admin" }) {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const { rows } = await client.query(
    `INSERT INTO platform_admins
       (email, password_hash, first_name, last_name, role, is_active, last_login_at, must_change_password)
     VALUES ($1, $2, $3, $4, $5, true, $6, false)
     RETURNING id`,
    [emailFor(suffix), passwordHash, "Stale", suffix, role, lastLoginAt],
  );
  return Number(rows[0].id);
}

async function adminIsActive(client, id) {
  const { rows } = await client.query("SELECT is_active FROM platform_admins WHERE id = $1", [id]);
  return rows[0]?.is_active ?? null;
}

async function main() {
  console.log(`Dormant-admin deactivation e2e against: ${BASE}\n`);

  // Track seeded ids + any real admins we may sweep so the finally block can
  // always restore + purge, even if an assertion throws.
  const seeded = {};
  let actingToken = null;
  let realSweptIds = [];

  await withClient(async (client) => {
    try {
      // --- Seed throwaway admins with controlled sign-in recency -------------
      const now = Date.now();
      seeded.acting = await seedAdmin(client, {
        suffix: "acting",
        // Will be overwritten to now() by the login below; seeded recent anyway.
        lastLoginAt: new Date(now - 1 * DAY_MS),
        role: "superadmin",
      });
      seeded.staleNever = await seedAdmin(client, { suffix: "never", lastLoginAt: null });
      seeded.staleOld = await seedAdmin(client, {
        suffix: "old",
        lastLoginAt: new Date(now - (STALE_ADMIN_DAYS + 30) * DAY_MS),
      });
      seeded.recent = await seedAdmin(client, {
        suffix: "recent",
        lastLoginAt: new Date(now - 10 * DAY_MS),
      });
      const seededIds = new Set(Object.values(seeded));

      // --- Log in as the acting admin to obtain a real admin token ----------
      const login = await req("POST", "/admin/auth/login", {
        body: { email: emailFor("acting"), password: PASSWORD },
      });
      if (login.status !== 200 || !login.json?.token) {
        console.error("Setup failed: could not log in acting admin", login.status, login.json);
        process.exitCode = 1;
        return;
      }
      actingToken = login.json.token;

      // === Test 1: self-deactivation is rejected ===========================
      console.log("Self-deactivation guard (PUT /admin/admins/:id):");
      const self = await req("PUT", `/admin/admins/${seeded.acting}`, {
        token: actingToken,
        body: { isActive: false },
      });
      check(
        "PUT /admin/admins/:self { isActive:false } -> 400",
        self.status === 400,
        `got ${self.status}`,
      );
      check(
        "rejection uses CannotDeactivateSelf error",
        self.json?.error === "CannotDeactivateSelf",
        `got ${JSON.stringify(self.json)}`,
      );
      check(
        "acting admin remains active after self-deactivation attempt",
        (await adminIsActive(client, seeded.acting)) === true,
      );

      // === Test 2: bulk-deactivate only dormant admins =====================
      console.log("\nBulk deactivate-stale (POST /admin/admins/deactivate-stale):");
      const bulk = await req("POST", "/admin/admins/deactivate-stale", { token: actingToken });

      // Restore any REAL (non-seeded) admin this global sweep may have caught,
      // immediately, so production operators are never locked out by a test run.
      const returnedIds = Array.isArray(bulk.json?.deactivatedIds) ? bulk.json.deactivatedIds : [];
      realSweptIds = returnedIds.filter((id) => !seededIds.has(Number(id)));
      if (realSweptIds.length > 0) {
        await client.query(
          "UPDATE platform_admins SET is_active = true WHERE id = ANY($1::int[])",
          [realSweptIds],
        );
        console.log(`  (restored ${realSweptIds.length} real admin(s) the global sweep caught)`);
        // Prove the restoration actually took, so a real operator is never left
        // locked out by a validation run.
        const stillOff = await client.query(
          "SELECT count(*)::int AS n FROM platform_admins WHERE id = ANY($1::int[]) AND is_active = false",
          [realSweptIds],
        );
        check(
          "real admins caught by the global sweep are restored to active",
          stillOff.rows[0].n === 0,
          `${stillOff.rows[0].n} still inactive`,
        );
      }

      check("deactivate-stale -> 200", bulk.status === 200, `got ${bulk.status}`);
      check("response success flag is true", bulk.json?.success === true);
      check(
        "dormant admin that NEVER signed in is swept",
        returnedIds.includes(seeded.staleNever),
        `deactivatedIds=${JSON.stringify(returnedIds)}`,
      );
      check(
        "dormant admin idle 90+ days is swept",
        returnedIds.includes(seeded.staleOld),
        `deactivatedIds=${JSON.stringify(returnedIds)}`,
      );
      check(
        "recently-active admin is NOT swept",
        !returnedIds.includes(seeded.recent),
        `deactivatedIds=${JSON.stringify(returnedIds)}`,
      );
      check(
        "acting admin is NEVER swept by deactivate-stale",
        !returnedIds.includes(seeded.acting),
        `deactivatedIds=${JSON.stringify(returnedIds)}`,
      );

      // Confirm the actual DB state matches the response.
      check("staleNever is now inactive in DB", (await adminIsActive(client, seeded.staleNever)) === false);
      check("staleOld is now inactive in DB", (await adminIsActive(client, seeded.staleOld)) === false);
      check("recent admin stays active in DB", (await adminIsActive(client, seeded.recent)) === true);
      check("acting admin stays active in DB", (await adminIsActive(client, seeded.acting)) === true);

      // The bulk action must be audited when it deactivates anyone.
      const bulkLog = await client.query(
        `SELECT id FROM activity_logs
          WHERE admin_id = $1 AND action = 'admin.admins_bulk_deactivated'
          ORDER BY id DESC LIMIT 1`,
        [seeded.acting],
      );
      check("bulk deactivation is recorded in the activity log", bulkLog.rows.length === 1);

      // === Test 3: reactivation flips isActive back and is logged ===========
      console.log("\nReactivation (PUT /admin/admins/:id { isActive:true }):");
      const react = await req("PUT", `/admin/admins/${seeded.staleOld}`, {
        token: actingToken,
        body: { isActive: true },
      });
      check("reactivation -> 200", react.status === 200, `got ${react.status}`);
      check("response reports isActive=true", react.json?.isActive === true, `got ${JSON.stringify(react.json)}`);
      check(
        "reactivated admin is active again in DB",
        (await adminIsActive(client, seeded.staleOld)) === true,
      );

      const reactLog = await client.query(
        `SELECT id FROM activity_logs
          WHERE admin_id = $1 AND action = 'admin.admin_reactivated'
            AND entity_type = 'admin' AND entity_id = $2
          ORDER BY id DESC LIMIT 1`,
        [seeded.acting, seeded.staleOld],
      );
      check("reactivation is recorded in the activity log", reactLog.rows.length === 1);
    } finally {
      // --- Always restore real admins + purge everything we created ---------
      try {
        if (realSweptIds.length > 0) {
          await client.query(
            "UPDATE platform_admins SET is_active = true WHERE id = ANY($1::int[])",
            [realSweptIds],
          );
        }
        // All activity logs this suite produced carry the acting admin's id.
        if (seeded.acting) {
          await client.query("DELETE FROM activity_logs WHERE admin_id = $1", [seeded.acting]);
        }
        await client.query("DELETE FROM platform_admins WHERE email LIKE $1", [`${ns}_%@example.com`]);
      } catch (err) {
        console.error(`[cleanup] WARNING: could not fully clean up seeded admin test data: ${err.message}`);
        failures++;
      }
    }
  });

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
