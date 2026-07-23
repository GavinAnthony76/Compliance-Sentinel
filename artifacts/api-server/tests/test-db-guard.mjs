/**
 * Force the CI e2e harnesses onto the local throwaway test database.
 *
 * The black-box suites create real companies/admins over HTTP against whatever
 * database the api-server points at. In this project the ambient environment has
 * NEON_DATABASE_URL set to the PRODUCTION Neon database, so running the suites
 * there permanently pollutes real tenant data (and relies on fragile post-run
 * cleanup). Clearing NEON_DATABASE_URL makes every DB entrypoint — lib/db, the
 * server, db-cleanup.mjs and the admin seeder — fall back to the local
 * DATABASE_URL via their shared `NEON_DATABASE_URL || DATABASE_URL` selection.
 *
 * Because each harness then runs `pnpm --filter db push-force` (a DESTRUCTIVE
 * schema sync) against DATABASE_URL, we first assert DATABASE_URL is not the
 * production database: it must be set, must not share a host with
 * NEON_DATABASE_URL, and must not look like a Neon host. Otherwise we throw so
 * the harness aborts rather than risk force-pushing schema over production.
 */

function hostOf(url) {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
}

export async function useLocalTestDatabase() {
  const neon = process.env.NEON_DATABASE_URL;
  const local = process.env.DATABASE_URL;

  if (!local) {
    throw new Error(
      "DATABASE_URL is not set; refusing to run e2e suites without a local test database.",
    );
  }

  const localHost = hostOf(local);

  if (neon && hostOf(neon) && localHost === hostOf(neon)) {
    throw new Error(
      "DATABASE_URL shares a host with NEON_DATABASE_URL (production); refusing " +
        "to run destructive test setup against it.",
    );
  }
  if (localHost.endsWith(".neon.tech")) {
    throw new Error(
      `DATABASE_URL host (${localHost}) looks like a production Neon host; ` +
        "refusing to run destructive test setup against it.",
    );
  }

  // Redirect every DB entrypoint (server + helpers) onto the local test DB.
  delete process.env.NEON_DATABASE_URL;

  // The app now stores real development data in DATABASE_URL (post-Neon
  // migration), and the harnesses run a DESTRUCTIVE `push-force` plus data
  // cleanup. Redirect the suites onto a dedicated throwaway database on the
  // same server so they can never clobber the dev dataset.
  const url = new URL(local);
  const baseDbName = url.pathname.replace(/^\//, "") || "postgres";
  // Idempotent: nested harnesses (run-all-ci -> group runners -> suites) may
  // call this again after DATABASE_URL was already redirected.
  const testDbName = baseDbName.endsWith("_test")
    ? baseDbName
    : `${baseDbName}_test`;

  if (baseDbName !== testDbName) {
    const { default: pg } = await import("pg");
    const admin = new pg.Client({ connectionString: local });
    await admin.connect();
    try {
      const { rowCount } = await admin.query(
        "SELECT 1 FROM pg_database WHERE datname = $1",
        [testDbName],
      );
      if (rowCount === 0) {
        // Identifier can't be parameterized; name is derived from our own URL
        // and restricted to safe characters.
        if (!/^[a-zA-Z0-9_]+$/.test(testDbName)) {
          throw new Error(`Unsafe test database name: ${testDbName}`);
        }
        await admin.query(`CREATE DATABASE ${testDbName}`);
      }
    } finally {
      await admin.end();
    }
    url.pathname = `/${testDbName}`;
    process.env.DATABASE_URL = url.toString();
  }
}
