import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const connectionString = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const poolOptions: pg.PoolConfig = { connectionString };
if (process.env.NEON_DATABASE_URL) {
  poolOptions.ssl = { rejectUnauthorized: false };
}

export const pool = new Pool(poolOptions);
export const db = drizzle(pool, { schema });

export * from "./schema";
