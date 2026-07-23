import { pool } from "@workspace/db";
import { logger } from "./logger";
import { seedSql } from "../seed/production-data";

const SEED_LOCK_KEY = 728394651;

// Sentinel row from the migrated dataset: if this company exists, the real
// data is already in place and no import (or replacement) may ever run.
const SENTINEL_COMPANY_ID = 381;

// Immutable marker stamped on the public schema after a successful import
// (or once the migrated dataset is confirmed present). Unlike table rows,
// application data changes can never remove it, so the destructive replace
// path is a permanent no-op once stamped.
const DONE_MARKER = "greensynk_seed_import_done";

/**
 * One-time data import from the previous Neon database.
 *
 * Modes (both require the env flag to be set, production only):
 * - SEED_IMPORT_ON_EMPTY=1: import ONLY when the database is completely empty.
 * - SEED_IMPORT_REPLACE=1: additionally, if the migrated dataset's sentinel
 *   company is absent, wipe all tables and import. This exists because the
 *   production database contained stale pre-Neon demo data. Once the sentinel
 *   exists, this is a permanent no-op, so real post-migration writes can never
 *   be lost.
 *
 * Concurrency-safe across autoscale instances via a Postgres advisory lock.
 */
export async function importSeedDataIfEmpty(): Promise<void> {
  const allowEmptyImport = process.env.SEED_IMPORT_ON_EMPTY === "1";
  const allowReplace = process.env.SEED_IMPORT_REPLACE === "1";
  if (!allowEmptyImport && !allowReplace) {
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [SEED_LOCK_KEY]);

    const marker = await client.query(
      "SELECT obj_description('public'::regnamespace) AS c",
    );
    if (marker.rows[0]?.c === DONE_MARKER) {
      logger.info("Seed import skipped: done marker present");
      return;
    }

    const sentinel = await client.query(
      "SELECT 1 FROM companies WHERE id = $1",
      [SENTINEL_COMPANY_ID],
    );
    if ((sentinel.rowCount ?? 0) > 0) {
      logger.info(
        "Seed import skipped: migrated dataset already present; stamping done marker",
      );
      await client.query(`COMMENT ON SCHEMA public IS '${DONE_MARKER}'`);
      return;
    }

    const { rows } = await client.query(
      `SELECT
         (SELECT count(*) FROM companies) AS companies,
         (SELECT count(*) FROM platform_admins) AS admins,
         (SELECT count(*) FROM users) AS users`,
    );
    const counts = rows[0];
    const isEmpty =
      Number(counts.companies) === 0 &&
      Number(counts.admins) === 0 &&
      Number(counts.users) === 0;

    if (!isEmpty && !allowReplace) {
      logger.info("Seed import skipped: database already has data");
      return;
    }

    await client.query("BEGIN");
    try {
      if (!isEmpty) {
        logger.warn(
          "Stale pre-migration data detected (no sentinel): replacing with migrated dataset",
        );
        const { rows: tableRows } = await client.query(
          `SELECT string_agg(quote_ident(tablename), ', ') AS tables
           FROM pg_tables WHERE schemaname = 'public'`,
        );
        const tables = tableRows[0]?.tables;
        if (tables) {
          await client.query(
            `TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`,
          );
        }
      } else {
        logger.info("Empty database detected: importing seed data");
      }

      await client.query(seedSql);
      await client.query(`COMMENT ON SCHEMA public IS '${DONE_MARKER}'`);
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
