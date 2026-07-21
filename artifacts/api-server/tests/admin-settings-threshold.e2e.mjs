#!/usr/bin/env node
/**
 * End-to-end coverage for the CONFIGURABLE dormancy threshold on the
 * dormant-admin sweep (platform_settings.stale_admin_days).
 *
 * The existing admin-stale-deactivation suite only exercises the default
 * 90-day cutoff. This suite verifies the sweep honors a CUSTOM threshold set
 * by an operator via PUT /admin/settings:
 *   1. Threshold lowered to 30 days: an admin dormant 45 days (spared under
 *      the 90-day default) IS swept, an admin dormant 10 days is spared, and
 *      the response reports thresholdDays = 30.
 *   2. Threshold raised to 365 days: an admin dormant 120 days (swept under
 *      the default) is SPARED, an admin dormant 400 days is swept, and the
 *      response reports thresholdDays = 365.
 *   3. With the automated sweep DISABLED in settings, a manual run (the
 *      operator clicked the button) still proceeds — the disable toggle only
 *      skips scheduled runs (covered by tests/admin-sweep-toggle.test.mjs).
 *
 * Like admin-stale-deactivation.e2e.mjs, this suite seeds its own throwaway
 * platform admins directly in the DB, logs in over HTTP for a real token, and
 * cleans up everything it created. Because deactivate-stale and the settings
 * row are GLOBAL, it also:
 *   - restores any real (non-seeded) admin a sweep may have caught, and
 *   - snapshots the platform settings up front and RESTORES them afterwards,
 *     so a validation run never leaves a custom threshold behind.
 *
 * Usage:
 *   API_BASE="https://<host>/api" node tests/admin-settings-threshold.e2e.mjs
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

const DAY_MS = 24 * 60 * 60 * 1000;
const PASSWORD = "AdminTestPass123!";
const stamp = Date.now();
const ns = `admin_threshold_${stamp}`;
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

async function seedAdmin(client, { suffix, lastLoginAt, role = "admin" }) {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const { rows } = await client.query(
    `INSERT INTO platform_admins
       (email, password_hash, first_name, last_name, role, is_active, last_login_at, must_change_password)
     VALUES ($1, $2, $3, $4, $5, true, $6, false)
     RETURNING id`,
    [emailFor(suffix), passwordHash, "Threshold", suffix, role, lastLoginAt],
  );
  return Number(rows[0].id);
}

async function adminIsActive(client, id) {
  const { rows } = await client.query("SELECT is_active FROM platform_admins WHERE id = $1", [id]);
  return rows[0]?.is_active ?? null;
}

async function main() {
  console.log(`Custom-threshold dormancy sweep e2e against: ${BASE}\n`);

  const seeded = {};
  let actingToken = null;
  // Every real (non-seeded) admin any of the sweeps in this suite catches, so
  // the finally block can always restore them.
  const realSweptIds = new Set();
  let originalSettings = null;

  await withClient(async (client) => {
    try {
      // --- Seed the acting admin and log in over HTTP ------------------------
      const now = Date.now();
      seeded.acting = await seedAdmin(client, {
        suffix: "acting",
        lastLoginAt: new Date(now - 1 * DAY_MS),
        role: "superadmin",
      });
      const login = await req("POST", "/admin/auth/login", {
        body: { email: emailFor("acting"), password: PASSWORD },
      });
      if (login.status !== 200 || !login.json?.token) {
        console.error("Setup failed: could not log in acting admin", login.status, login.json);
        process.exitCode = 1;
        return;
      }
      actingToken = login.json.token;

      // --- Snapshot the current settings so they can be restored -------------
      const before = await req("GET", "/admin/settings", { token: actingToken });
      if (before.status !== 200) {
        console.error("Setup failed: could not read platform settings", before.status, before.json);
        process.exitCode = 1;
        return;
      }
      originalSettings = {
        staleAdminDays: before.json.staleAdminDays,
        staleAdminSweepEnabled: before.json.staleAdminSweepEnabled,
      };

      const seededIds = () => new Set(Object.values(seeded));

      // Run the manual sweep, immediately restoring any real admin it caught.
      async function sweep() {
        const res = await req("POST", "/admin/admins/deactivate-stale", { token: actingToken });
        const ids = Array.isArray(res.json?.deactivatedIds) ? res.json.deactivatedIds : [];
        const mine = seededIds();
        const real = ids.filter((id) => !mine.has(Number(id)));
        if (real.length > 0) {
          real.forEach((id) => realSweptIds.add(Number(id)));
          await client.query(
            "UPDATE platform_admins SET is_active = true WHERE id = ANY($1::int[])",
            [real],
          );
          console.log(`  (restored ${real.length} real admin(s) the global sweep caught)`);
        }
        return { res, ids };
      }

      // === Test 1: threshold LOWERED to 30 days =============================
      console.log("Custom threshold of 30 days (PUT /admin/settings):");
      const set30 = await req("PUT", "/admin/settings", {
        token: actingToken,
        body: { staleAdminDays: 30, staleAdminSweepEnabled: true },
      });
      check("PUT /admin/settings { staleAdminDays: 30 } -> 200", set30.status === 200, `got ${set30.status}`);
      check("response reports staleAdminDays = 30", set30.json?.staleAdminDays === 30, `got ${JSON.stringify(set30.json)}`);
      const read30 = await req("GET", "/admin/settings", { token: actingToken });
      check("GET /admin/settings confirms the 30-day threshold", read30.json?.staleAdminDays === 30);

      // Dormant 45 days: SPARED under the 90-day default, must be SWEPT at 30.
      seeded.dormant45 = await seedAdmin(client, {
        suffix: "d45",
        lastLoginAt: new Date(now - 45 * DAY_MS),
      });
      // Dormant 10 days: inside even the custom threshold, must be spared.
      seeded.recent10 = await seedAdmin(client, {
        suffix: "d10",
        lastLoginAt: new Date(now - 10 * DAY_MS),
      });

      const run30 = await sweep();
      check("deactivate-stale -> 200", run30.res.status === 200, `got ${run30.res.status}`);
      check(
        "sweep reports the custom thresholdDays = 30",
        run30.res.json?.thresholdDays === 30,
        `got ${JSON.stringify(run30.res.json)}`,
      );
      check(
        "admin dormant 45 days IS swept under the 30-day threshold",
        run30.ids.includes(seeded.dormant45),
        `deactivatedIds=${JSON.stringify(run30.ids)}`,
      );
      check(
        "admin dormant 10 days is NOT swept",
        !run30.ids.includes(seeded.recent10),
        `deactivatedIds=${JSON.stringify(run30.ids)}`,
      );
      check("dormant-45 admin is inactive in DB", (await adminIsActive(client, seeded.dormant45)) === false);
      check("dormant-10 admin stays active in DB", (await adminIsActive(client, seeded.recent10)) === true);

      // === Test 2: threshold RAISED to 365 days =============================
      console.log("\nCustom threshold of 365 days:");
      const set365 = await req("PUT", "/admin/settings", {
        token: actingToken,
        body: { staleAdminDays: 365 },
      });
      check("PUT /admin/settings { staleAdminDays: 365 } -> 200", set365.status === 200, `got ${set365.status}`);
      check("response reports staleAdminDays = 365", set365.json?.staleAdminDays === 365);

      // Dormant 120 days: SWEPT under the 90-day default, must be SPARED at 365.
      seeded.dormant120 = await seedAdmin(client, {
        suffix: "d120",
        lastLoginAt: new Date(now - 120 * DAY_MS),
      });
      // Dormant 400 days: beyond even the raised threshold, must be swept.
      seeded.dormant400 = await seedAdmin(client, {
        suffix: "d400",
        lastLoginAt: new Date(now - 400 * DAY_MS),
      });

      const run365 = await sweep();
      check("deactivate-stale -> 200", run365.res.status === 200, `got ${run365.res.status}`);
      check(
        "sweep reports the custom thresholdDays = 365",
        run365.res.json?.thresholdDays === 365,
        `got ${JSON.stringify(run365.res.json)}`,
      );
      check(
        "admin dormant 120 days is SPARED under the 365-day threshold",
        !run365.ids.includes(seeded.dormant120),
        `deactivatedIds=${JSON.stringify(run365.ids)}`,
      );
      check(
        "admin dormant 400 days IS swept",
        run365.ids.includes(seeded.dormant400),
        `deactivatedIds=${JSON.stringify(run365.ids)}`,
      );
      check("dormant-120 admin stays active in DB", (await adminIsActive(client, seeded.dormant120)) === true);
      check("dormant-400 admin is inactive in DB", (await adminIsActive(client, seeded.dormant400)) === false);

      // === Test 3: disabling the sweep does NOT block a manual run ==========
      console.log("\nSweep disabled in settings — a MANUAL run still proceeds:");
      const disable = await req("PUT", "/admin/settings", {
        token: actingToken,
        body: { staleAdminSweepEnabled: false },
      });
      check("PUT /admin/settings { staleAdminSweepEnabled: false } -> 200", disable.status === 200, `got ${disable.status}`);
      check("response reports the sweep disabled", disable.json?.staleAdminSweepEnabled === false);

      // Beyond the 365-day threshold currently in force.
      seeded.dormant500 = await seedAdmin(client, {
        suffix: "d500",
        lastLoginAt: new Date(now - 500 * DAY_MS),
      });

      const runDisabled = await sweep();
      check("manual deactivate-stale -> 200 while disabled", runDisabled.res.status === 200, `got ${runDisabled.res.status}`);
      check("manual run is NOT reported as skipped", runDisabled.res.json?.skipped !== true, `got ${JSON.stringify(runDisabled.res.json)}`);
      check(
        "manual run still sweeps a dormant admin while the scheduled sweep is disabled",
        runDisabled.ids.includes(seeded.dormant500),
        `deactivatedIds=${JSON.stringify(runDisabled.ids)}`,
      );
      check("dormant-500 admin is inactive in DB", (await adminIsActive(client, seeded.dormant500)) === false);
    } finally {
      // --- Always restore settings, real admins, and purge seeded data -------
      try {
        if (realSweptIds.size > 0) {
          await client.query(
            "UPDATE platform_admins SET is_active = true WHERE id = ANY($1::int[])",
            [[...realSweptIds]],
          );
        }
        if (originalSettings) {
          // Restore directly in the DB so the reset works even if the API/token
          // is unavailable at teardown time.
          await client.query(
            `UPDATE platform_settings
                SET stale_admin_days = $1, stale_admin_sweep_enabled = $2, updated_at = now()
              WHERE id = 1`,
            [originalSettings.staleAdminDays, originalSettings.staleAdminSweepEnabled],
          );
          const { rows } = await client.query(
            "SELECT stale_admin_days, stale_admin_sweep_enabled FROM platform_settings WHERE id = 1",
          );
          check(
            "platform settings are restored to their original values",
            rows[0]?.stale_admin_days === originalSettings.staleAdminDays &&
              rows[0]?.stale_admin_sweep_enabled === originalSettings.staleAdminSweepEnabled,
            `settings now=${JSON.stringify(rows[0])}, expected=${JSON.stringify(originalSettings)}`,
          );
        }
        if (seeded.acting) {
          await client.query("DELETE FROM activity_logs WHERE admin_id = $1", [seeded.acting]);
        }
        await client.query("DELETE FROM platform_admins WHERE email LIKE $1", [`${ns}_%@example.com`]);
      } catch (err) {
        console.error(`[cleanup] WARNING: could not fully clean up threshold test data: ${err.message}`);
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
