#!/usr/bin/env node
/**
 * Race test: stuck-invoice sweep vs. the autopay charge handler.
 *
 * The autopay charge route (src/routes/autopay.ts) claims an invoice by
 * flipping it to a transient "processing" status, talks to Stripe, then writes
 * the final status. The stuck-invoice sweep (src/lib/stuck-invoices.ts)
 * releases invoices stuck in "processing" past a safe window. The dangerous
 * overlap: the sweep releases (or reconciles) an invoice at the exact moment a
 * slow charge for it is still settling. If both writers act blindly, an
 * invoice could end up paid AND re-chargeable — a double-charge risk.
 *
 * This suite runs the REAL charge route (mounted in a tiny express app) and
 * the REAL sweep against the REAL local test database, and interleaves them
 * deterministically: the mocked Stripe `paymentIntents.create` call is the
 * charge handler's mid-flight moment, and inside it we age the claim past the
 * sweep window and run a full sweep pass before letting the charge finish.
 *
 * Locked in:
 *   1. Sweep RELEASES mid-charge, charge then SUCCEEDS -> invoice ends paid
 *      exactly once; a follow-up charge attempt is rejected (AlreadyPaid) and
 *      creates no new PaymentIntent.
 *   2. Sweep RECONCILES AS PAID mid-charge, charge then FAILS -> the charge
 *      handler's revert (guarded by status === "processing") must NOT reopen
 *      the paid invoice; it stays paid and cannot be charged again.
 *   3. Sweep RECONCILES AS PAID mid-charge, charge then ALSO succeeds -> only
 *      one writer wins the paid transition: notifications fire exactly once.
 *   4. The compare-and-swap guards in both writers are locked in by source
 *      assertions (eq(status,"processing") on the sweep's two updates and the
 *      charge handler's revert; the claim's ne(paid)/ne(processing)).
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
// Mocks: auth/feature gates, Stripe, notifications, SMS.
// ---------------------------------------------------------------------------

// Test principal injected by the mocked requireAuth. companyId is filled in
// after seeding.
const principal = { companyId: 0, userId: null, role: "owner" };

mock.module("../src/lib/auth.ts", {
  namedExports: {
    requireAuth: (req, _res, next) => {
      req.user = { ...principal };
      next();
    },
  },
});

mock.module("../src/lib/features.ts", {
  namedExports: {
    requireFeature: () => (_req, _res, next) => next(),
  },
});

mock.module("../src/lib/sms-consent.ts", {
  namedExports: {
    sendSMSWithConsent: async () => {},
  },
});

// Notification capture — shared by the charge handler and the sweep.
const receiptCalls = [];
const ownerNotifCalls = [];
mock.module("../src/lib/notifications.ts", {
  namedExports: {
    sendEmail: async () => ({ delivered: false, reason: "test" }),
    dispatchPaymentReceiptEmail: (invoiceId, companyId) => {
      receiptCalls.push({ invoiceId, companyId });
    },
    dispatchOwnerPaymentNotification: (invoiceId, companyId) => {
      ownerNotifCalls.push({ invoiceId, companyId });
    },
  },
});

// Scripted Stripe client, shared by BOTH writers:
//   - paymentIntents.create is the charge handler's slow settle moment. Each
//     scenario installs an `onCreate` hook that runs MID-CHARGE (after the
//     claim, before the final status write) — this is where we interleave the
//     sweep.
//   - paymentIntents.search is the sweep's reconciliation; it consults
//     `succeededByInvoiceId` exactly like the existing sweep suite.
let onCreate = null; // async ({ metadata }) => { id, status } | throws
let succeededByInvoiceId = new Map();
const createCalls = [];

mock.module("../src/lib/stripe.ts", {
  namedExports: {
    getUncachableStripeClient: async () => ({
      paymentIntents: {
        create: async (params) => {
          createCalls.push(params);
          if (!onCreate) throw new Error("simulated: unexpected charge attempt");
          return onCreate(params);
        },
        search: async ({ query }) => {
          const m = /metadata\['invoiceId'\]:'(\d+)'/.exec(query);
          const invoiceId = m ? m[1] : null;
          const piId = invoiceId ? succeededByInvoiceId.get(invoiceId) : undefined;
          return { data: piId ? [{ id: piId, status: "succeeded" }] : [] };
        },
      },
    }),
  },
});

// Imported AFTER the mocks so both writers pick them up.
const { db, pool, invoicesTable, companiesTable, customersTable, activityLogsTable } =
  await import("@workspace/db");
const { releaseStuckProcessingInvoices } = await import("../src/lib/stuck-invoices.ts");
const autopayRouter = (await import("../src/routes/autopay.ts")).default;
const { eq, and, inArray } = await import("drizzle-orm");
const express = (await import("express")).default;

// Tiny real express app around the REAL charge route.
const app = express();
app.use(express.json());
app.use("/autopay", autopayRouter);
const server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;

async function charge(invoiceId) {
  const res = await fetch(`${baseUrl}/autopay/invoices/${invoiceId}/charge`, { method: "POST" });
  return { status: res.status, body: await res.json() };
}

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
const ns = `race${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

// ---------------------------------------------------------------------------
// Seed one company + autopay-ready customer; helper to seed chargeable invoices.
// ---------------------------------------------------------------------------
const [company] = await db.insert(companiesTable)
  .values({ name: `Sweep Race Test Co ${ns}`, slug: `sweep-race-${ns}` })
  .returning();
principal.companyId = company.id;

const [customer] = await db.insert(customersTable)
  .values({
    companyId: company.id,
    firstName: "Race",
    lastName: "Tester",
    email: `${ns}@example.com`,
    stripeCustomerId: `cus_${ns}`,
    stripePaymentMethodId: `pm_${ns}`,
    autopayEnabled: "true",
  })
  .returning();

let invoiceSeq = 0;
async function seedInvoice() {
  invoiceSeq++;
  const [row] = await db.insert(invoicesTable).values({
    companyId: company.id,
    customerId: customer.id,
    invoiceNumber: `${ns}-${invoiceSeq}`,
    subtotal: "100.00",
    tax: "0",
    total: "100.00",
    status: "sent",
    dueDate: new Date(now + 7 * 24 * 60 * MIN),
    updatedAt: new Date(now),
  }).returning();
  return row;
}

async function fetchInvoice(id) {
  const [row] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
  return row;
}

// Age the in-flight claim past the sweep's 5-minute window WITHOUT changing
// status — this simulates a charge that has been settling for a long time.
async function ageClaim(invoiceId) {
  await db.update(invoicesTable)
    .set({ updatedAt: new Date(Date.now() - 10 * MIN) })
    .where(eq(invoicesTable.id, invoiceId));
}

function resetCaptures() {
  receiptCalls.length = 0;
  ownerNotifCalls.length = 0;
  createCalls.length = 0;
  succeededByInvoiceId = new Map();
  onCreate = null;
}

console.log("Sweep vs. autopay-charge race test\n");

try {
  // -------------------------------------------------------------------------
  // 1. Sweep RELEASES mid-charge; the slow charge then succeeds.
  //    The paid write must win, and the invoice must not be chargeable again.
  // -------------------------------------------------------------------------
  console.log("Sweep releases mid-charge, charge then succeeds -> paid exactly once:");
  {
    resetCaptures();
    const inv = await seedInvoice();
    let midStatus = null;
    onCreate = async () => {
      // Mid-charge: the claim looks stale, and a sweep pass runs. No succeeded
      // intent is visible yet (Stripe search is eventually consistent), so the
      // sweep releases the invoice back to a chargeable state.
      await ageClaim(inv.id);
      await releaseStuckProcessingInvoices();
      midStatus = (await fetchInvoice(inv.id)).status;
      return { id: `pi_slow_ok_${inv.id}`, status: "succeeded" };
    };

    const res = await charge(inv.id);
    check("the sweep really released the invoice mid-charge", midStatus === "sent", midStatus);
    check("charge request reports success", res.status === 200 && res.body.status === "paid", JSON.stringify(res));
    const after = await fetchInvoice(inv.id);
    check("invoice ends 'paid' (charge's final write wins over the release)", after.status === "paid", after.status);
    check("the slow charge's PaymentIntent is recorded", after.stripePaymentIntentId === `pi_slow_ok_${inv.id}`, after.stripePaymentIntentId);
    check("exactly one PaymentIntent was ever created", createCalls.length === 1, `created ${createCalls.length}`);
    check("receipt email fired exactly once", receiptCalls.length === 1, `fired ${receiptCalls.length}`);

    // The released window must not make the invoice chargeable again.
    onCreate = async () => ({ id: "pi_should_never_exist", status: "succeeded" });
    const again = await charge(inv.id);
    check("a follow-up charge attempt is rejected (AlreadyPaid)", again.status === 400 && again.body.error === "AlreadyPaid", JSON.stringify(again));
    check("no second PaymentIntent was created", createCalls.length === 1, `created ${createCalls.length}`);
  }

  // -------------------------------------------------------------------------
  // 2. Sweep RECONCILES AS PAID mid-charge; the slow charge then FAILS.
  //    The revert (eq status="processing") must NOT reopen the paid invoice.
  // -------------------------------------------------------------------------
  console.log("\nSweep marks it paid mid-charge, charge then fails -> revert must not reopen it:");
  {
    resetCaptures();
    const inv = await seedInvoice();
    let midStatus = null;
    onCreate = async () => {
      await ageClaim(inv.id);
      // This time Stripe DOES already show a succeeded charge for the invoice
      // (e.g. an earlier interrupted attempt), so the sweep records it paid.
      succeededByInvoiceId.set(String(inv.id), `pi_reconciled_${inv.id}`);
      await releaseStuckProcessingInvoices();
      midStatus = (await fetchInvoice(inv.id)).status;
      const err = new Error("Your card was declined.");
      throw err;
    };

    const res = await charge(inv.id);
    check("the sweep really reconciled it as paid mid-charge", midStatus === "paid", midStatus);
    check("charge request reports the failure", res.status === 402, `${res.status}`);
    const after = await fetchInvoice(inv.id);
    check("invoice STAYS 'paid' — the failed charge's revert did not reopen it", after.status === "paid", after.status);
    check("the reconciled PaymentIntent is kept", after.stripePaymentIntentId === `pi_reconciled_${inv.id}`, after.stripePaymentIntentId);
    check("receipt email fired exactly once (from the sweep)", receiptCalls.length === 1, `fired ${receiptCalls.length}`);

    // Paid means paid: it must not be chargeable again.
    onCreate = async () => ({ id: "pi_should_never_exist", status: "succeeded" });
    const again = await charge(inv.id);
    check("a retry charge attempt is rejected (AlreadyPaid)", again.status === 400 && again.body.error === "AlreadyPaid", JSON.stringify(again));
    check("no new PaymentIntent was created by the retry", createCalls.length === 1, `created ${createCalls.length}`);
  }

  // -------------------------------------------------------------------------
  // 3. Sweep RECONCILES AS PAID mid-charge; the slow charge ALSO succeeds.
  //    Exactly one writer wins the paid transition (no double notifications).
  // -------------------------------------------------------------------------
  console.log("\nBoth writers see success -> exactly one wins the paid transition:");
  {
    resetCaptures();
    const inv = await seedInvoice();
    onCreate = async () => {
      await ageClaim(inv.id);
      succeededByInvoiceId.set(String(inv.id), `pi_sweep_won_${inv.id}`);
      await releaseStuckProcessingInvoices();
      return { id: `pi_charge_late_${inv.id}`, status: "succeeded" };
    };

    const res = await charge(inv.id);
    check("charge request still reports success", res.status === 200, `${res.status}`);
    const after = await fetchInvoice(inv.id);
    check("invoice ends 'paid'", after.status === "paid", after.status);
    check("paidAt is set once", after.paidAt instanceof Date, String(after.paidAt));
    check("notifications fired exactly once (single winner)",
      receiptCalls.length === 1 && ownerNotifCalls.length === 1,
      `receipts ${receiptCalls.length}, owner ${ownerNotifCalls.length}`);
    check("exactly one live PaymentIntent create in this flow", createCalls.length === 1, `created ${createCalls.length}`);
  }

  // -------------------------------------------------------------------------
  // 4. Lock in the compare-and-swap guards in BOTH writers' source.
  // -------------------------------------------------------------------------
  console.log("\nCompare-and-swap guards are present in both writers' source:");
  {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const sweepSrc = readFileSync(path.join(here, "../src/lib/stuck-invoices.ts"), "utf8");
    const autopaySrc = readFileSync(path.join(here, "../src/routes/autopay.ts"), "utf8");

    const casGuard = /eq\(invoicesTable\.status,\s*"processing"\)/g;
    check("sweep guards BOTH its updates with status === 'processing'",
      (sweepSrc.match(casGuard) || []).length >= 2,
      `found ${(sweepSrc.match(casGuard) || []).length}`);
    check("charge handler's revert is guarded by status === 'processing'",
      (autopaySrc.match(casGuard) || []).length >= 1,
      `found ${(autopaySrc.match(casGuard) || []).length}`);
    check("claim refuses invoices already 'processing'",
      /ne\(invoicesTable\.status,\s*"processing"\)/.test(autopaySrc));
    check("claim refuses invoices already 'paid'",
      /ne\(invoicesTable\.status,\s*"paid"\)/.test(autopaySrc));
    check("charge's Stripe create carries an idempotency key (defense-in-depth)",
      /idempotencyKey:\s*`autopay-charge-inv-/.test(autopaySrc));
  }
} finally {
  server.close();
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
