import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// Drizzle reads and writes `timestamp` (without time zone) columns as UTC wall
// time regardless of the process TZ. Raw Date parameters inside sql`...`
// templates (e.g. the ms-truncated claim-ownership token compares) bypass that
// mapping, and node-postgres would otherwise serialize them in the process's
// LOCAL zone — so outside a UTC process those guards never match their own row.
pg.defaults.parseInputDatesAsUTC = true;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString });

export const db = drizzle(pool, { schema });

export * from "./schema";
