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
 * Strategy (two independent guards so we never touch real tenant data):
 *   1. Snapshot MAX(companies.id) immediately before the suites run, and only
 *      consider companies created during the run (id > snapshot).
 *   2. Of those, only delete ones whose owner account is a test account
 *      (email ends in "@example.com" — every e2e suite registers its owner with
 *      such an address). A genuine signup that happens to land during the brief
 *      test window uses a real email and is therefore preserved.
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

const TEST_OWNER_EMAIL_PATTERN = "%@example.com";

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

export async function purgeTestDataAbove(snapshotId) {
  if (snapshotId == null || Number.isNaN(snapshotId)) {
    throw new Error(`Invalid snapshot id: ${snapshotId}`);
  }
  return withClient(async (client) => {
    // Companies created during this run whose owner is a test account.
    const doomed =
      "SELECT id FROM companies WHERE id > $1 AND id IN " +
      "(SELECT company_id FROM users WHERE email LIKE $2)";
    // activity_logs has no FK to companies — clear its rows first, while the
    // company rows still exist to resolve the subquery.
    const al = await client.query(
      `DELETE FROM activity_logs WHERE company_id IN (${doomed})`,
      [snapshotId, TEST_OWNER_EMAIL_PATTERN],
    );
    // Deleting the company cascades to every company-scoped child table.
    const co = await client.query(
      `DELETE FROM companies WHERE id > $1 AND id IN ` +
        `(SELECT company_id FROM users WHERE email LIKE $2)`,
      [snapshotId, TEST_OWNER_EMAIL_PATTERN],
    );
    console.log(
      `[db-cleanup] purged ${co.rowCount} test compan${co.rowCount === 1 ? "y" : "ies"} ` +
        `and ${al.rowCount} activity-log row(s) created during this run ` +
        `(company id > ${snapshotId}, owner ${TEST_OWNER_EMAIL_PATTERN}).`,
    );
  });
}
