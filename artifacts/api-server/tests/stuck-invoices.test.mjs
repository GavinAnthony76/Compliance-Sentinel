#!/usr/bin/env node
/**
 * Integration test for the stuck-invoice sweep
 * (`releaseStuckProcessingInvoices` in src/lib/stuck-invoices.ts).
 *
 * The autopay charge handler flips an invoice to a transient "processing"
 * status while it talks to Stripe. If the server crashes/restarts at that
 * moment, the in-memory revert never runs and the invoice is stranded in
 * "processing" forever. The sweep frees such invoices — but it must reconcile
 * with Stripe FIRST so a charge that actually succeeded is recorded as paid
 * rather than wrongly reopened (which would risk a double charge).
 *
 * This suite runs the REAL sweep against the REAL local test database (so the
 * "stuck longer than the safe window" SQL cutoff is genuinely exercised) and
 * mocks only the two external edges via node:test module mocking
 * (--experimental-test-module-mocks):
 *
 *   - src/lib/stripe.ts        -> a controllable fake Stripe client whose
 *                                 paymentIntents.search we script per test.
 *   - src/lib/notifications.ts -> capture dispatchPaymentReceiptEmail /
 *                                 dispatchOwnerPaymentNotification calls.
 *
 * Locked in:
 *   1. An invoice stuck in "processing" past the 5-minute window is released
 *      to "sent" (future due date) with no notifications.
 *   2. ... or to "overdue" when its due date has already passed.
 *   3. When Stripe reports a succeeded PaymentIntent for the invoice, it is
 *      recorded as PAID (paidAt/paymentMethod/stripePaymentIntentId set), the
 *      receipt + owner notifications fire, and an
 *      "invoice.autopay_reconciled_paid" activity entry is written — it is
 *      NEVER reopened.
 *   4. An invoice "processing" for LESS than the safe window is left untouched
 *      (it may still be an in-flight charge).
 *   5. If Stripe is unavailable, the sweep defers: nothing is released
 *      (releasing blindly could reopen an already-paid invoice).
 *   6. If the Stripe search fails for one invoice, that invoice is deferred.
 *
 * MUST be run by tests/run-stuck-invoices-ci.mjs (or with NEON_DATABASE_URL
 * cleared and the local test DB schema pushed) so it never touches production.
 *
 * Exit code 0 = all checks passed, 1 = at least one check failed.
 */

import { register } from "node:module";
import { mock } from "node:test";
import { useLocalTestDatabase } from "./test-db-guard.mjs";

// Hard guard: never run this suite against the production Neon database.
await useLocalTestDatabase();
process.env.NODE_ENV = "test";

// Resolve the api-server's extensionless relative .ts imports (./logger,
// ./activity, ./stripe, ./notifications) the way esbuild does at build time.
register("./ts-resolve.loader.mjs", import.meta.url);

// ---------------------------------------------------------------------------
// Mocks: the two external edges of the sweep.
// ---------------------------------------------------------------------------

// Scripted Stripe behaviour, controlled per scenario:
//   stripeMode = "ok"          -> client works; search consults `succeededByInvoiceId`
//   stripeMode = "unavailable" -> getUncachableStripeClient throws
//   searchFailsFor             -> set of invoice ids whose search call throws
let stripeMode = "ok";
let succeededByInvoiceId = new Map(); // invoiceId(string) -> payment intent id
let searchFailsFor = new Set();
const searchedInvoiceIds = [];

mock.module("../src/lib/stripe.ts", {
  namedExports: {
    getUncachableStripeClient: async () => {
      if (stripeMode === "unavailable") {
        throw new Error("simulated: Stripe client unavailable");
      }
      return {
        paymentIntents: {
          search: async ({ query }) => {
            const m = /metadata\['invoiceId'\]:'(\d+)'/.exec(query);
            const invoiceId = m ? m[1] : null;
            searchedInvoiceIds.push(invoiceId);
            if (invoiceId && searchFailsFor.has(invoiceId)) {
              throw new Error("simulated: Stripe search transient failure");
            }
            const piId = invoiceId ? succeededByInvoiceId.get(invoiceId) : undefined;
            return {
              data: piId
                ? [{ id: "pi_dead_attempt", status: "requires_payment_method" }, { id: piId, status: "succeeded" }]
                : [{ id: "pi_dead_attempt", status: "requires_payment_method" }],
            };
          },
        },
      };
    },
  },
});

// Capture the notification dispatches the sweep fires when it reconciles an
// invoice as paid. (These are the same fire-and-forget helpers the autopay
// charge handler uses.)
const receiptCalls = [];
const ownerNotifCalls = [];
mock.module("../src/lib/notifications.ts", {
  namedExports: {
    dispatchPaymentReceiptEmail: (invoiceId, companyId) => {
      receiptCalls.push({ invoiceId, companyId });
    },
    dispatchOwnerPaymentNotification: (invoiceId, companyId) => {
      ownerNotifCalls.push({ invoiceId, companyId });
    },
  },
});

// Imported AFTER the mocks so the sweep's module graph picks them up. The DB
// import is the real @workspace/db pointed at the local test database.
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
const ns = `stuck${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

// ---------------------------------------------------------------------------
// Seed one company + customer, and helper to seed invoices in a given state.
// ---------------------------------------------------------------------------
const [company] = await db.insert(companiesTable)
  .values({ name: `Stuck Sweep Test Co ${ns}`, slug: `stuck-sweep-${ns}` })
  .returning();
const [customer] = await db.insert(customersTable)
  .values({ companyId: company.id, firstName: "Stuck", lastName: "Tester", email: `${ns}@example.com` })
  .returning();

let invoiceSeq = 0;
async function seedInvoice({ status = "processing", ageMs, dueDate = null }) {
  invoiceSeq++;
  const [row] = await db.insert(invoicesTable).values({
    companyId: company.id,
    customerId: customer.id,
    invoiceNumber: `${ns}-${invoiceSeq}`,
    subtotal: "100.00",
    tax: "0",
    total: "100.00",
    status,
    dueDate,
    updatedAt: new Date(now - ageMs),
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

function resetCaptures() {
  receiptCalls.length = 0;
  ownerNotifCalls.length = 0;
  searchedInvoiceIds.length = 0;
  succeededByInvoiceId = new Map();
  searchFailsFor = new Set();
  stripeMode = "ok";
}

console.log("Stuck-invoice sweep integration test\n");

try {
  // -------------------------------------------------------------------------
  // 1. Stale "processing" with a FUTURE due date is released back to "sent".
  // -------------------------------------------------------------------------
  console.log("A stale processing invoice (future due date) is released to 'sent':");
  {
    resetCaptures();
    const inv = await seedInvoice({ ageMs: 10 * MIN, dueDate: new Date(now + 7 * 24 * 60 * MIN) });
    await releaseStuckProcessingInvoices();
    const after = await fetchInvoice(inv.id);
    check("status reverted to 'sent'", after.status === "sent", after.status);
    check("not marked paid (no paidAt)", after.paidAt === null, String(after.paidAt));
    check("no payment intent recorded", after.stripePaymentIntentId === null, after.stripePaymentIntentId);
    check("Stripe was consulted before releasing", searchedInvoiceIds.includes(String(inv.id)));
    check("no receipt email fired on a release", receiptCalls.length === 0, `fired ${receiptCalls.length}`);
    check("no owner notification fired on a release", ownerNotifCalls.length === 0, `fired ${ownerNotifCalls.length}`);
    const actions = await activityActionsFor(inv.id);
    check("release is recorded in the activity feed", actions.includes("invoice.processing_released"), actions.join(","));
  }

  // -------------------------------------------------------------------------
  // 2. Stale "processing" PAST its due date is released to "overdue".
  // -------------------------------------------------------------------------
  console.log("\nA stale processing invoice past its due date is released to 'overdue':");
  {
    resetCaptures();
    const inv = await seedInvoice({ ageMs: 10 * MIN, dueDate: new Date(now - 3 * 24 * 60 * MIN) });
    await releaseStuckProcessingInvoices();
    const after = await fetchInvoice(inv.id);
    check("status reverted to 'overdue'", after.status === "overdue", after.status);
    check("not marked paid", after.paidAt === null, String(after.paidAt));
  }

  // -------------------------------------------------------------------------
  // 3. Stripe says the charge SUCCEEDED -> recorded as paid, never reopened.
  // -------------------------------------------------------------------------
  console.log("\nA stale processing invoice whose charge actually succeeded is recorded as PAID:");
  {
    resetCaptures();
    const inv = await seedInvoice({ ageMs: 10 * MIN, dueDate: new Date(now + 7 * 24 * 60 * MIN) });
    succeededByInvoiceId.set(String(inv.id), "pi_reconciled_ok_1");
    await releaseStuckProcessingInvoices();
    const after = await fetchInvoice(inv.id);
    check("status is 'paid' (NOT reopened to sent/overdue)", after.status === "paid", after.status);
    check("paidAt is set", after.paidAt instanceof Date && !Number.isNaN(after.paidAt.getTime()), String(after.paidAt));
    check("paymentMethod recorded as 'card'", after.paymentMethod === "card", after.paymentMethod);
    check("the succeeded PaymentIntent id is recorded", after.stripePaymentIntentId === "pi_reconciled_ok_1", after.stripePaymentIntentId);
    check("customer receipt email fired exactly once",
      receiptCalls.length === 1 && receiptCalls[0].invoiceId === inv.id && receiptCalls[0].companyId === company.id,
      JSON.stringify(receiptCalls));
    check("owner payment notification fired exactly once",
      ownerNotifCalls.length === 1 && ownerNotifCalls[0].invoiceId === inv.id && ownerNotifCalls[0].companyId === company.id,
      JSON.stringify(ownerNotifCalls));
    const actions = await activityActionsFor(inv.id);
    check("reconciliation is recorded in the activity feed", actions.includes("invoice.autopay_reconciled_paid"), actions.join(","));
    check("no 'released' activity entry for a paid reconciliation", !actions.includes("invoice.processing_released"), actions.join(","));
  }

  // -------------------------------------------------------------------------
  // 4. A FRESH "processing" claim (under the 5-minute window) is left alone.
  // -------------------------------------------------------------------------
  console.log("\nAn invoice processing for less than the safe window is left untouched:");
  {
    resetCaptures();
    const inv = await seedInvoice({ ageMs: 1 * MIN, dueDate: new Date(now + 7 * 24 * 60 * MIN) });
    await releaseStuckProcessingInvoices();
    const after = await fetchInvoice(inv.id);
    check("status is still 'processing'", after.status === "processing", after.status);
    check("Stripe was never consulted for the in-flight charge", !searchedInvoiceIds.includes(String(inv.id)), searchedInvoiceIds.join(","));
    check("no notifications fired", receiptCalls.length === 0 && ownerNotifCalls.length === 0);
    const actions = await activityActionsFor(inv.id);
    check("no activity entries were written", actions.length === 0, actions.join(","));
    // Age it past the window and confirm the next pass DOES release it.
    await db.update(invoicesTable).set({ updatedAt: new Date(now - 10 * MIN) }).where(eq(invoicesTable.id, inv.id));
    await releaseStuckProcessingInvoices();
    const later = await fetchInvoice(inv.id);
    check("the same invoice IS released once it crosses the window", later.status === "sent", later.status);
  }

  // -------------------------------------------------------------------------
  // 5. Stripe unavailable -> defer everything (never release blindly).
  // -------------------------------------------------------------------------
  console.log("\nWhen Stripe is unavailable the sweep defers instead of releasing blindly:");
  {
    resetCaptures();
    stripeMode = "unavailable";
    const inv = await seedInvoice({ ageMs: 10 * MIN, dueDate: new Date(now + 7 * 24 * 60 * MIN) });
    await releaseStuckProcessingInvoices();
    const after = await fetchInvoice(inv.id);
    check("stale invoice remains 'processing' (deferred)", after.status === "processing", after.status);
    // Stripe comes back: the next pass releases it normally.
    stripeMode = "ok";
    await releaseStuckProcessingInvoices();
    const later = await fetchInvoice(inv.id);
    check("it is released on the next pass once Stripe is back", later.status === "sent", later.status);
  }

  // -------------------------------------------------------------------------
  // 6. A per-invoice Stripe search failure defers only that invoice.
  // -------------------------------------------------------------------------
  console.log("\nA transient Stripe search failure defers that invoice (no blind reopen):");
  {
    resetCaptures();
    const flaky = await seedInvoice({ ageMs: 10 * MIN, dueDate: new Date(now + 7 * 24 * 60 * MIN) });
    const healthy = await seedInvoice({ ageMs: 10 * MIN, dueDate: new Date(now + 7 * 24 * 60 * MIN) });
    searchFailsFor.add(String(flaky.id));
    await releaseStuckProcessingInvoices();
    check("the invoice with the failed search stays 'processing'", (await fetchInvoice(flaky.id)).status === "processing");
    check("other stuck invoices in the same pass are still released", (await fetchInvoice(healthy.id)).status === "sent");
  }
} finally {
  // Clean up everything this run created (activity_logs has no FK to companies).
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
