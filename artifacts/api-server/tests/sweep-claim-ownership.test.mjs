#!/usr/bin/env node
/**
 * Sweep claim-ownership race test: a sweep pass must not release (or
 * overwrite) a claim created AFTER its select.
 *
 * The dangerous sequence (mirror of tests/autopay-claim-ownership.test.mjs,
 * but with the SWEEP as the stale writer):
 *   1. Charge A claims the invoice (status -> "processing"); the server later
 *      crashes, stranding the claim; it ages past the 5-minute cutoff.
 *   2. The stuck-invoice sweep SELECTs the invoice as stale and goes off to
 *      reconcile with Stripe (slow, eventually-consistent search).
 *   3. Meanwhile the old claim is resolved and a BRAND-NEW charge B re-claims
 *      the invoice (status -> "processing" with a fresh updatedAt).
 *   4. The sweep's Stripe search returns; before the fix, its per-row UPDATE
 *      was guarded only by status === "processing" — it could not tell WHOSE
 *      claim it was releasing, so it flipped B's LIVE claim back to "sent"
 *      (or blindly overwrote it as paid with an intent it never matched
 *      against B's claim).
 *
 * The fix: each sweep write (both the reconcile-as-paid write and the release
 * write) also matches the exact stale updatedAt the sweep selected
 * (status = "processing" AND updatedAt = staleClaimToken). B's fresh claim
 * wrote a new updatedAt, so the sweep's write matches zero rows.
 *
 * This suite runs the REAL sweep against the REAL local test database and
 * injects the re-claim deterministically inside the mocked Stripe
 * `paymentIntents.search` call — i.e. exactly between the sweep's select and
 * its update.
 *
 * Locked in:
 *   1. RELEASE path: a claim re-created mid-sweep is NOT released — it stays
 *      "processing" with its updatedAt untouched, and no release activity is
 *      logged.
 *   2. RECONCILE-AS-PAID path: a claim re-created mid-sweep is NOT overwritten
 *      as paid — no paidAt/PaymentIntent written, no notifications fired.
 *   3. A genuinely stale claim (no interleaved re-claim) is still released.
 *   4. Source assertion: both sweep updates are guarded by the stale claim's
 *      own updatedAt token in addition to the status guard.
 *
 * MUST be run by tests/run-stuck-invoices-ci.mjs / run-all-ci.mjs (or with
 * NEON_DATABASE_URL cleared and the local test DB schema pushed) so it never
 * touches production.
 *
 * Exit code 0 = all checks passed, 1 = at least one check failed.
 */

import { register } from "node:module";
import { mock } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { useLocalTestDatabase } from "./test-db-guard.mjs";

// Hard guard: never run this suite against the production Neon database.
await useLocalTestDatabase();
process.env.NODE_ENV = "test";

// Resolve the api-server's extensionless relative .ts imports the way esbuild
// does at build time.
register("./ts-resolve.loader.mjs", import.meta.url);

// ---------------------------------------------------------------------------
// Mocks: Stripe (with a per-invoice mid-search hook) and notifications.
// ---------------------------------------------------------------------------

// invoiceId(string) -> async hook run INSIDE the sweep's Stripe search, i.e.
// exactly between the sweep's stale-select and its guarded update.
const midSearchHooks = new Map();
// invoiceId(string) -> succeeded PaymentIntent id (drives the paid path).
let succeededByInvoiceId = new Map();

const stripeNamedExports = {
    getUncachableStripeClient: async () => ({
      paymentIntents: {
        search: async ({ query }) => {
          const m = /metadata\['invoiceId'\]:'(\d+)'/.exec(query);
          const invoiceId = m ? m[1] : null;
          const hook = invoiceId ? midSearchHooks.get(invoiceId) : null;
          if (hook) {
            midSearchHooks.delete(invoiceId);
            await hook();
          }
          const piId = invoiceId ? succeededByInvoiceId.get(invoiceId) : undefined;
          return { data: piId ? [{ id: piId, status: "succeeded" }] : [] };
        },
      },
    }),
};

const receiptCalls = [];
const ownerNotifCalls = [];
const relativeMocks = {
  "../src/lib/stripe.ts": stripeNamedExports,
  "../src/lib/notifications.ts": {
    dispatchPaymentReceiptEmail: (invoiceId, companyId) => {
      receiptCalls.push({ invoiceId, companyId });
    },
    dispatchOwnerPaymentNotification: (invoiceId, companyId) => {
      ownerNotifCalls.push({ invoiceId, companyId });
    },
  },
};
for (const [specifier, namedExports] of Object.entries(relativeMocks)) {
  mock.module(specifier, { namedExports });
}

// Preflight: fail with an actionable message if production code grew an
// import these mocks don't provide (instead of an opaque import-time crash).
const { assertSuiteMocksCover } = await import("./mock-surface-check.mjs");
assertSuiteMocksCover({
  testFile: import.meta.url,
  entryFiles: ["../src/lib/stuck-invoices.ts"],
  relativeMocks,
});

// Imported AFTER the mocks so the sweep picks them up.
const { db, pool, invoicesTable, companiesTable, customersTable, activityLogsTable } =
  await import("@workspace/db");
const { releaseStuckProcessingInvoices } = await import("../src/lib/stuck-invoices.ts");
const { eq, and, inArray } = await import("drizzle-orm");

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

const MIN = 60 * 1000;
const now = Date.now();
const ns = `swown${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

// ---------------------------------------------------------------------------
// Seed one company + customer, helper to seed stale processing invoices.
// ---------------------------------------------------------------------------
const [company] = await db.insert(companiesTable)
  .values({ name: `Sweep Claim Ownership Test Co ${ns}`, slug: `sweep-own-${ns}` })
  .returning();
const [customer] = await db.insert(customersTable)
  .values({ companyId: company.id, firstName: "Sweep", lastName: "Owner", email: `${ns}@example.com` })
  .returning();

let invoiceSeq = 0;
async function seedStaleProcessingInvoice() {
  invoiceSeq++;
  const [row] = await db.insert(invoicesTable).values({
    companyId: company.id,
    customerId: customer.id,
    invoiceNumber: `${ns}-${invoiceSeq}`,
    subtotal: "100.00",
    tax: "0",
    total: "100.00",
    status: "processing",
    dueDate: new Date(now + 7 * 24 * 60 * MIN),
    updatedAt: new Date(now - 10 * MIN), // well past the 5-minute cutoff
  }).returning();
  return row;
}

async function fetchInvoice(id) {
  const [row] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
  return row;
}

async function activityActionsFor(invoiceId) {
  const rows = await db.select().from(activityLogsTable).where(and(
    eq(activityLogsTable.companyId, company.id),
    eq(activityLogsTable.entityType, "invoice"),
    eq(activityLogsTable.entityId, invoiceId),
  ));
  return rows.map((r) => r.action);
}

// Simulate a brand-new charge re-claiming the invoice: the old stale claim is
// resolved and a fresh writer flips it back to "processing" with a NEW
// updatedAt — exactly what the autopay charge handler's claim does.
async function reclaimInvoice(invoiceId) {
  const [row] = await db.update(invoicesTable)
    .set({ status: "processing", updatedAt: new Date() })
    .where(eq(invoicesTable.id, invoiceId))
    .returning();
  return row;
}

console.log("Stuck-invoice sweep claim-ownership race test\n");

try {
  // -------------------------------------------------------------------------
  // 1. RELEASE path: a fresh claim created between the sweep's select and its
  //    update must NOT be released.
  // -------------------------------------------------------------------------
  console.log("The sweep cannot RELEASE a claim created after its select:");
  {
    receiptCalls.length = 0;
    ownerNotifCalls.length = 0;
    const inv = await seedStaleProcessingInvoice();
    let freshClaimUpdatedAt = null;
    midSearchHooks.set(String(inv.id), async () => {
      const fresh = await reclaimInvoice(inv.id);
      freshClaimUpdatedAt = fresh.updatedAt?.getTime();
    });

    await releaseStuckProcessingInvoices();

    const after = await fetchInvoice(inv.id);
    check("the fresh claim is still 'processing' (not released to sent)",
      after.status === "processing", after.status);
    check("the fresh claim's updatedAt token is untouched by the sweep",
      after.updatedAt?.getTime() === freshClaimUpdatedAt,
      `${after.updatedAt?.getTime()} vs ${freshClaimUpdatedAt}`);
    const actions = await activityActionsFor(inv.id);
    check("no 'processing_released' activity was logged",
      !actions.includes("invoice.processing_released"), actions.join(","));
  }

  // -------------------------------------------------------------------------
  // 2. RECONCILE-AS-PAID path: a fresh claim created mid-sweep must NOT be
  //    overwritten as paid either.
  // -------------------------------------------------------------------------
  console.log("\nThe sweep cannot OVERWRITE a fresh claim as paid either:");
  {
    receiptCalls.length = 0;
    ownerNotifCalls.length = 0;
    const inv = await seedStaleProcessingInvoice();
    succeededByInvoiceId.set(String(inv.id), "pi_stale_reconcile");
    let freshClaimUpdatedAt = null;
    midSearchHooks.set(String(inv.id), async () => {
      const fresh = await reclaimInvoice(inv.id);
      freshClaimUpdatedAt = fresh.updatedAt?.getTime();
    });

    await releaseStuckProcessingInvoices();

    const after = await fetchInvoice(inv.id);
    check("the fresh claim is still 'processing' (not flipped to paid)",
      after.status === "processing", after.status);
    check("no paidAt / PaymentIntent written onto the fresh claim",
      after.paidAt === null && after.stripePaymentIntentId === null,
      `${after.paidAt} / ${after.stripePaymentIntentId}`);
    check("the fresh claim's updatedAt token is untouched",
      after.updatedAt?.getTime() === freshClaimUpdatedAt,
      `${after.updatedAt?.getTime()} vs ${freshClaimUpdatedAt}`);
    check("no notifications fired for the skipped write",
      receiptCalls.length === 0 && ownerNotifCalls.length === 0,
      `receipts ${receiptCalls.length}, owner ${ownerNotifCalls.length}`);
    const actions = await activityActionsFor(inv.id);
    check("no 'autopay_reconciled_paid' activity was logged",
      !actions.includes("invoice.autopay_reconciled_paid"), actions.join(","));
    succeededByInvoiceId = new Map();
  }

  // -------------------------------------------------------------------------
  // 3. Control: with no interleaved re-claim, a stale claim is still released.
  // -------------------------------------------------------------------------
  console.log("\nA genuinely stale claim (no re-claim) is still released:");
  {
    const inv = await seedStaleProcessingInvoice();
    await releaseStuckProcessingInvoices();
    const after = await fetchInvoice(inv.id);
    check("the stale claim is released to 'sent'", after.status === "sent", after.status);
  }

  // -------------------------------------------------------------------------
  // 4. DB-written timestamp: a stale claim whose updatedAt was written BY THE
  //    DATABASE (now(), microsecond precision) must still match its own token.
  //    A JS Date read-back truncates to milliseconds, so a raw eq() guard
  //    would silently no-op here; the ms-truncated compare must not.
  // -------------------------------------------------------------------------
  console.log("\nA stale claim with a DATABASE-written updatedAt is still released:");
  {
    const inv = await seedStaleProcessingInvoice();
    // Overwrite updatedAt server-side so it carries microseconds the JS Date
    // token loses (simulates a future DB trigger/default writer).
    await pool.query(
      "UPDATE invoices SET updated_at = now() - interval '10 minutes' + interval '123.456 milliseconds' WHERE id = $1",
      [inv.id],
    );
    const { rows } = await pool.query("SELECT updated_at FROM invoices WHERE id = $1", [inv.id]);
    const micros = String(rows[0].updated_at?.toISOString?.() ?? rows[0].updated_at);
    console.log(`  (seeded DB-written updated_at: ${micros})`);

    await releaseStuckProcessingInvoices();
    const after = await fetchInvoice(inv.id);
    check("the DB-timestamped stale claim is released (guard matched its own row)",
      after.status === "sent", after.status);
  }

  // -------------------------------------------------------------------------
  // 5. Source assertion: both sweep writes carry the stale-claim token.
  // -------------------------------------------------------------------------
  console.log("\nOwnership-token guard is present in the sweep's source:");
  {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const sweepSrc = readFileSync(path.join(here, "../src/lib/stuck-invoices.ts"), "utf8");
    check("sweep captures the stale claim's updatedAt as an ownership token",
      /staleClaimToken\s*=\s*invoice\.updatedAt/.test(sweepSrc));
    const tokenGuards = sweepSrc.match(/date_trunc\('milliseconds',\s*\$\{invoicesTable\.updatedAt\}\)\s*=\s*\$\{staleClaimToken\}/g) || [];
    check("BOTH sweep updates (paid + release) match the stale updatedAt token (ms-truncated compare)",
      tokenGuards.length === 2, `found ${tokenGuards.length} token guard(s)`);
    check("sweep updates still keep the status === 'processing' guard",
      /eq\(invoicesTable\.status,\s*"processing"\)/.test(sweepSrc));
  }
} finally {
  try {
    const invRows = await db.select({ id: invoicesTable.id }).from(invoicesTable)
      .where(eq(invoicesTable.companyId, company.id));
    const invIds = invRows.map((r) => r.id);
    if (invIds.length > 0) {
      await db.delete(activityLogsTable).where(and(
        eq(activityLogsTable.companyId, company.id),
        inArray(activityLogsTable.entityId, invIds),
      ));
    }
    await db.delete(companiesTable).where(eq(companiesTable.id, company.id));
  } catch (err) {
    console.error(`Cleanup failed (local test DB): ${err.message}`);
  }
  await pool.end();
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
