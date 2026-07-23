import { pool } from "@workspace/db";
import { logger } from "./logger";
import { seedSql } from "../seed/production-data";

const SEED_LOCK_KEY = 728394651;

/**
 * One-time data import from the previous Neon database.
 *
 * Runs at startup and inserts the exported dataset ONLY when the database is
 * completely empty (no companies AND no platform admins AND no users). This
 * makes it safe on every subsequent boot and across concurrent autoscale
 * instances (guarded by a Postgres advisory lock): once data exists, it is a
 * no-op forever.
 */
export async function importSeedDataIfEmpty(): Promise<void> {
  if (process.env.SEED_IMPORT_ON_EMPTY !== "1") {
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [SEED_LOCK_KEY]);

    const { rows } = await client.query(
      `SELECT
         (SELECT count(*) FROM companies) AS companies,
         (SELECT count(*) FROM platform_admins) AS admins,
         (SELECT count(*) FROM users) AS users`,
    );
    const counts = rows[0];
    if (
      Number(counts.companies) > 0 ||
      Number(counts.admins) > 0 ||
      Number(counts.users) > 0
    ) {
      logger.info("Seed import skipped: database already has data");
      return;
    }

    logger.info("Empty database detected: importing seed data");
    await client.query("BEGIN");
    try {
      await client.query(seedSql);
      await client.query("COMMIT");
      // The pg_dump script sets an empty search_path on this session; reset it
      // so the connection is safe to reuse from the pool.
      await client.query("SET search_path TO public");
      logger.info("Seed data import completed");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [SEED_LOCK_KEY]);
    } catch {
      // lock is released on disconnect anyway
    }
    client.release();
  }
}
