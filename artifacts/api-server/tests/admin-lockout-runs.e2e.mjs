#!/usr/bin/env node
/**
 * End-to-end coverage for GET /admin/lockout-runs (artifacts/api-server/
 * src/routes/admin.ts), which powers the "Automatic inactivity lockout" panel
 * on the Admin Users page. If the endpoint's shape drifts (metadata keys,
 * action name, ordering) the panel would silently show nothing, so this suite
 * pins the contract against a RUNNING api-server over HTTP:
 *
 *   1. Unauthenticated requests are rejected (401).
 *   2. Seeded `admin.admins_auto_deactivated` activity rows come back
 *      newest-first, each with deactivatedCount + thresholdDays lifted from
 *      metadataJson ({ count, thresholdDays }), and lastRun = newest run.
 *   3. Manual `admin.admins_bulk_deactivated` entries are EXCLUDED.
 *   4. Rows with missing/garbage metadata degrade gracefully
 *      (deactivatedCount 0, thresholdDays null) instead of crashing the panel.
 *   5. The `limit` query param caps the number of runs returned.
 *
 * Like the other admin suites, platform admins cannot be created over HTTP
 * without an existing token (chicken/egg), so this seeds a throwaway admin +
 * activity rows directly in the DB (unique @example.com namespace), logs in
 * for a real token, and removes everything it created afterwards.
 *
 * Usage:
 *   API_BASE="http://127.0.0.1:5097/api" node tests/admin-lockout-runs.e2e.mjs
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

const PASSWORD = "AdminTestPass123!";
const stamp = Date.now();
const ns = `admin_lockout_runs_${stamp}`;
const actingEmail = `${ns}_acting@example.com`;

const HOUR_MS = 60 * 60 * 1000;

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

function connectionString() {
  const cs = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
  if (!cs) {
    throw new Error("NEON_DATABASE_URL / DATABASE_URL not set; cannot seed test data.");
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

/** Insert an activity log row with a controlled createdAt; returns its id. */
async function seedLog(client, { adminId, action, metadata, createdAt }) {
  const { rows } = await client.query(
    `INSERT INTO activity_logs (admin_id, action, entity_type, metadata_json, created_at)
     VALUES ($1, $2, 'admin', $3, $4)
     RETURNING id`,
    [adminId, action, metadata == null ? null : JSON.stringify(metadata), createdAt],
  );
  return Number(rows[0].id);
}

async function main() {
  console.log(`Lockout-run history e2e against: ${BASE}\n`);

  await withClient(async (client) => {
    let adminId = null;
    try {
      // --- Seed a throwaway superadmin + log in for a token -----------------
      const passwordHash = await bcrypt.hash(PASSWORD, 12);
      const { rows } = await client.query(
        `INSERT INTO platform_admins
           (email, password_hash, first_name, last_name, role, is_active, must_change_password)
         VALUES ($1, $2, 'Lockout', 'Runs', 'superadmin', true, false)
         RETURNING id`,
        [actingEmail, passwordHash],
      );
      adminId = Number(rows[0].id);

      const login = await req("POST", "/admin/auth/login", {
        body: { email: actingEmail, password: PASSWORD },
      });
      if (login.status !== 200 || !login.json?.token) {
        console.error("Setup failed: could not log in acting admin", login.status, login.json);
        process.exitCode = 1;
        return;
      }
      const token = login.json.token;

      // --- Seed lockout-run history with controlled timestamps --------------
      const now = Date.now();
      // Oldest → newest automatic sweep runs.
      const runOld = await seedLog(client, {
        adminId,
        action: "admin.admins_auto_deactivated",
        metadata: { count: 3, thresholdDays: 90 },
        createdAt: new Date(now - 72 * HOUR_MS),
      });
      const runMid = await seedLog(client, {
        adminId,
        action: "admin.admins_auto_deactivated",
        metadata: { count: 0, thresholdDays: 60 },
        createdAt: new Date(now - 48 * HOUR_MS),
      });
      // A run with garbage/missing metadata must degrade gracefully.
      const runBadMeta = await seedLog(client, {
        adminId,
        action: "admin.admins_auto_deactivated",
        metadata: { count: "three", note: "malformed" },
        createdAt: new Date(now - 24 * HOUR_MS),
      });
      const runNewest = await seedLog(client, {
        adminId,
        action: "admin.admins_auto_deactivated",
        metadata: { count: 5, thresholdDays: 45 },
        createdAt: new Date(now - 1 * HOUR_MS),
      });
      // A MANUAL bulk sweep in between — must never appear in the run history.
      const manualId = await seedLog(client, {
        adminId,
        action: "admin.admins_bulk_deactivated",
        metadata: { count: 99, thresholdDays: 90 },
        createdAt: new Date(now - 2 * HOUR_MS),
      });
      const seededRunIds = new Set([runOld, runMid, runBadMeta, runNewest]);

      // === Test 1: authentication is required ==============================
      console.log("Authentication (GET /admin/lockout-runs):");
      const anon = await req("GET", "/admin/lockout-runs");
      check("unauthenticated request -> 401", anon.status === 401, `got ${anon.status}`);
      const badTok = await req("GET", "/admin/lockout-runs", { token: "not-a-real-token" });
      check("garbage bearer token -> 401", badTok.status === 401, `got ${badTok.status}`);

      // === Test 2: shape, ordering, and metadata mapping ====================
      console.log("\nRun history shape (GET /admin/lockout-runs):");
      const resp = await req("GET", "/admin/lockout-runs?limit=50", { token });
      check("authenticated request -> 200", resp.status === 200, `got ${resp.status}`);
      const runs = Array.isArray(resp.json?.runs) ? resp.json.runs : [];
      check("response has a runs array", Array.isArray(resp.json?.runs));

      // Other suites/dev data may have produced their own runs; assert on ours.
      const mine = runs.filter((r) => seededRunIds.has(r.id));
      check(
        "all four seeded automatic runs are returned",
        mine.length === 4,
        `found ${mine.length} of 4 (ids ${JSON.stringify(runs.map((r) => r.id))})`,
      );
      check(
        "seeded runs are ordered newest-first",
        mine.map((r) => r.id).join(",") === [runNewest, runBadMeta, runMid, runOld].join(","),
        `got ${mine.map((r) => r.id).join(",")}, expected ${[runNewest, runBadMeta, runMid, runOld].join(",")}`,
      );
      check(
        "whole list is globally ordered newest-first",
        runs.every(
          (r, i) => i === 0 || new Date(runs[i - 1].ranAt) >= new Date(r.ranAt),
        ),
      );

      const newest = mine.find((r) => r.id === runNewest);
      check(
        "run exposes deactivatedCount from metadata.count",
        newest?.deactivatedCount === 5,
        `got ${JSON.stringify(newest)}`,
      );
      check(
        "run exposes thresholdDays from metadata.thresholdDays",
        newest?.thresholdDays === 45,
        `got ${JSON.stringify(newest)}`,
      );
      check("run exposes a parseable ranAt timestamp", newest && !Number.isNaN(Date.parse(newest.ranAt)));
      const zeroRun = mine.find((r) => r.id === runMid);
      check(
        "a zero-deactivation run reports deactivatedCount 0 (not dropped)",
        zeroRun?.deactivatedCount === 0 && zeroRun?.thresholdDays === 60,
        `got ${JSON.stringify(zeroRun)}`,
      );
      const badRun = mine.find((r) => r.id === runBadMeta);
      check(
        "malformed metadata degrades to count 0 / thresholdDays null",
        badRun?.deactivatedCount === 0 && badRun?.thresholdDays === null,
        `got ${JSON.stringify(badRun)}`,
      );
      check(
        "lastRun mirrors the newest automatic run",
        resp.json?.lastRun?.id === runs[0]?.id,
        `lastRun=${JSON.stringify(resp.json?.lastRun)}`,
      );

      // === Test 3: manual bulk deactivations are excluded ===================
      console.log("\nManual sweep exclusion:");
      check(
        "manual admin.admins_bulk_deactivated entry is NOT in the run history",
        !runs.some((r) => r.id === manualId),
        `manual id ${manualId} present in ${JSON.stringify(runs.map((r) => r.id))}`,
      );

      // === Test 4: limit is honored =========================================
      console.log("\nLimit handling:");
      const limited = await req("GET", "/admin/lockout-runs?limit=2", { token });
      check("limit=2 -> 200", limited.status === 200, `got ${limited.status}`);
      check(
        "limit=2 returns at most 2 runs",
        Array.isArray(limited.json?.runs) && limited.json.runs.length <= 2,
        `got ${limited.json?.runs?.length}`,
      );
    } finally {
      try {
        if (adminId) {
          await client.query("DELETE FROM activity_logs WHERE admin_id = $1", [adminId]);
        }
        await client.query("DELETE FROM platform_admins WHERE email LIKE $1", [
          `${ns}_%@example.com`,
        ]);
      } catch (err) {
        console.error(`[cleanup] WARNING: could not fully clean up seeded data: ${err.message}`);
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
