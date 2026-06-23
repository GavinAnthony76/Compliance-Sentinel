import pg from "pg";

// Self-serve company owners now register UNVERIFIED and receive no auth token
// (login is gated until the emailed confirmation link is clicked). The e2e
// suites need an authenticated owner, so this flips the verification gate
// directly in the local test DB — the programmatic equivalent of clicking that
// link. Mirrors db-cleanup.mjs's connection selection; useLocalTestDatabase()
// clears NEON_DATABASE_URL first, so this always targets the throwaway local DB.
export async function markOwnerVerified(email) {
  const cs = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
  if (!cs) {
    throw new Error("NEON_DATABASE_URL / DATABASE_URL not set; cannot verify test owner.");
  }
  const client = new pg.Client({
    connectionString: cs,
    ssl: process.env.NEON_DATABASE_URL ? true : undefined,
  });
  await client.connect();
  try {
    // register/team-create normalize email to lowercase before storage, so the
    // lookup here must match that normalization or it updates zero rows.
    const normalized = String(email ?? "").trim().toLowerCase();
    await client.query("UPDATE users SET email_verified = true WHERE email = $1", [normalized]);
  } finally {
    await client.end();
  }
}
