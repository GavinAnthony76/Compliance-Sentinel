/**
 * Test-data cleanup helpers for the access/permissions CI harnesses.
 *
 * The black-box e2e suites self-provision real companies (with users,
 * customers, invoices, etc.) over HTTP against whatever database the api-server
 * is pointed at — which in this project is the production Neon database
 * (NEON_DATABASE_URL). Left unchecked, every validation run permanently
 * pollutes production with hundreds of throwaway "Test" companies, which then
 * show up in the owner/admin dashboards.
 *
 * Strategy (independent guards so we never touch real tenant data and never
 * delete a *concurrent* runner's in-flight data):
 *   1. Snapshot MAX(companies.id) immediately before the suites run, and only
 *      consider companies created during the run (id > snapshot).
 *   2. Of those, only delete ones whose owner account is a test account
 *      (email ends in "@example.com" — every e2e suite registers its owner with
 *      such an address). A genuine signup that happens to land during the brief
 *      test window uses a real email and is therefore preserved.
 *   3. Scope each RUN to its OWN per-run namespace token (see makeRunNamespace).
 *      Every runner mints a unique token at startup, hands it to its suites via
 *      the TEST_RUN_NS env var, and the suites embed it in every company's OWNER
 *      email (`<token>_…@example.com`). Cleanup then purges ONLY companies whose
 *      owner email starts with that token. Because the token is unique per run,
 *      ANY two runs — concurrent OR back-to-back, same harness or different —
 *      provision and purge provably-disjoint sets, so no run can ever delete
 *      another run's in-flight rows (previously observed as 404s / FK violations
 *      when two runs of the SAME harness overlapped and shared a namespace).
 *
 * Company deletes cascade to all company-scoped child tables; activity_logs is
 * the only relevant table with no FK to companies, so its rows for the doomed
 * companies are cleared explicitly first (while the join is still resolvable).
 *
 * These functions THROW on failure on purpose: the caller must treat a failed
 * snapshot as a hard precondition (abort before running polluting suites) and a
 * failed purge as a run failure (so leftover pollution is never silently
 * ignored).
 */
import pg from "pg";
import { randomBytes } from "node:crypto";

/**
 * Build a process-unique, email-safe namespace token for a single CI run.
 *
 * Every company a run provisions embeds this token at the START of its OWNER
 * email (`<token>_…@example.com`), and the run purges ONLY companies whose owner
 * email starts with it. Because the token is unique per run, two runs (whether
 * concurrent or back-to-back, same harness or different) provision and purge
 * provably-disjoint sets — neither can delete the other's in-flight rows.
 *
 * The token is strictly alphanumeric (no SQL LIKE wildcards), so the cleanup
 * pattern `<token>%@example.com` is an exact-prefix match.
 *
 * @param {string} [label]  short human-readable hint (e.g. "acc", "perm").
 */
export function makeRunNamespace(label = "run") {
  const safeLabel = String(label).replace(/[^a-z0-9]/gi, "").toLowerCase() || "run";
  return `${safeLabel}${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
}

const ALL_TEST_OWNER_PATTERN = "%@example.com";

function connectionString() {
  const cs = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
  if (!cs) {
    throw new Error("NEON_DATABASE_URL / DATABASE_URL not set; cannot manage test data.");
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

export async function snapshotMaxCompanyId() {
  return withClient(async (client) => {
    const { rows } = await client.query("SELECT COALESCE(MAX(id), 0) AS max FROM companies");
    return Number(rows[0].max);
  });
}

/**
 * Purge the test companies created during this run, scoped to this runner's
 * owner-email namespace so concurrent runners never delete each other's data.
 *
 * @param {number} snapshotId  MAX(companies.id) captured before the suites ran.
 * @param {object} [opts]
 * @param {string[]} [opts.ownerPatterns]  SQL LIKE patterns for owner emails this
 *   runner CREATED (purge these). Defaults to all @example.com.
 * @param {string[]} [opts.excludeOwnerPatterns]  SQL LIKE patterns this runner
 *   must NEVER touch (another runner's namespace).
 */
export async function purgeTestDataAbove(snapshotId, opts = {}) {
  if (snapshotId == null || Number.isNaN(snapshotId)) {
    throw new Error(`Invalid snapshot id: ${snapshotId}`);
  }
  const ownerPatterns = opts.ownerPatterns ?? [ALL_TEST_OWNER_PATTERN];
  const excludeOwnerPatterns = opts.excludeOwnerPatterns ?? [];

  return withClient(async (client) => {
    // $1 = snapshot; $2 = include patterns (array); $3 = exclude patterns (array).
    // The "_" in a prefix like "lead_%" acts as a single-char wildcard, which is
    // harmless here: no real owner email begins with "lead"/"perm", so it only
    // ever matches the intended test accounts.
    const params = [snapshotId, ownerPatterns, excludeOwnerPatterns];
    const doomed =
      "SELECT c.id FROM companies c WHERE c.id > $1 AND EXISTS (" +
      "  SELECT 1 FROM users u WHERE u.company_id = c.id" +
      "    AND u.email LIKE ANY ($2::text[])" +
      "    AND NOT (u.email LIKE ANY ($3::text[]))" +
      ")";
    // activity_logs has no FK to companies — clear its rows first, while the
    // company rows still exist to resolve the subquery.
    const al = await client.query(
      `DELETE FROM activity_logs WHERE company_id IN (${doomed})`,
      params,
    );
    // Deleting the company cascades to every company-scoped child table.
    const co = await client.query(`DELETE FROM companies WHERE id IN (${doomed})`, params);
    console.log(
      `[db-cleanup] purged ${co.rowCount} test compan${co.rowCount === 1 ? "y" : "ies"} ` +
        `and ${al.rowCount} activity-log row(s) created during this run ` +
        `(company id > ${snapshotId}, owners matching ${JSON.stringify(ownerPatterns)}` +
        `${excludeOwnerPatterns.length ? `, excluding ${JSON.stringify(excludeOwnerPatterns)}` : ""}).`,
    );
  });
}
