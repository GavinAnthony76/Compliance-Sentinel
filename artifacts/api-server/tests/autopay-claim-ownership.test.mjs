#!/usr/bin/env node
/**
 * Claim-ownership race test: a STALE writer's revert must not release a NEWER
 * writer's in-progress claim.
 *
 * The dangerous sequence (task: prevent a failed charge from unlocking someone
 * else's in-progress charge):
 *   1. Charge A claims the invoice (status -> "processing") and goes to Stripe.
 *   2. A is slow; the stuck-invoice sweep decides A's claim is stale and
 *      RELEASES the invoice back to "sent".
 *   3. Charge B claims the invoice (status -> "processing" again) and starts
 *      its own Stripe call.
 *   4. Slow charge A finally FAILS. Its revert runs. Before the fix, the
 *      revert was guarded only by status === "processing" — it could not tell
 *      WHOSE claim it was releasing, so it flipped B's LIVE claim back to
 *      "sent", making the invoice chargeable a third time while B was still
 *      settling.
 *
 * The fix: the claim returns its own updatedAt as an ownership token, and the
 * revert only releases the claim whose updatedAt still equals that token
 * (status = "processing" AND updatedAt = claimToken). B's claim wrote a new
 * updatedAt, so A's revert matches zero rows.
 *
 * This suite runs the REAL charge route twice concurrently (mounted in a tiny
 * express app) plus the REAL sweep against the REAL local test database, and
 * interleaves them deterministically inside the mocked Stripe
 * `paymentIntents.create` calls.
 *
 * Locked in:
 *   1. While B is mid-charge, stale A's failed revert leaves the invoice in
 *      "processing" (B's claim is untouched) — no third charge is possible.
 *   2. B then completes normally and the invoice ends paid exactly once, with
 *      B's PaymentIntent recorded and notifications fired exactly once.
 *   3. Source assertion: the revert is guarded by BOTH status="processing"
 *      and the claim's own updatedAt token.
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

// Scripted Stripe client. Each paymentIntents.create call is routed to a
// per-call hook via a FIFO queue so the two concurrent charges (A then B) can
// be scripted independently.
const createHooks = []; // async (params) => { id, status } | throws
const createCalls = [];
let onCreateCallStarted = null; // notifier: (callIndex) => void

mock.module("../src/lib/stripe.ts", {
  namedExports: {
    getUncachableStripeClient: async () => ({
      paymentIntents: {
        create: async (params) => {
          const idx = createCalls.length;
          createCalls.push(params);
          if (onCreateCallStarted) onCreateCallStarted(idx);
          const hook = createHooks.shift();
          if (!hook) throw new Error("simulated: unexpected charge attempt");
          return hook(params);
        },
        // Sweep reconciliation: nothing succeeded is ever visible in this
        // suite, so the sweep always RELEASES stale claims.
        search: async () => ({ data: [] }),
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
const ns = `own${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

// ---------------------------------------------------------------------------
// Seed one company + autopay-ready customer + one chargeable invoice.
// ---------------------------------------------------------------------------
const [company] = await db.insert(companiesTable)
  .values({ name: `Claim Ownership Test Co ${ns}`, slug: `claim-own-${ns}` })
  .returning();
principal.companyId = company.id;

const [customer] = await db.insert(customersTable)
  .values({
    companyId: company.id,
    firstName: "Claim",
    lastName: "Owner",
    email: `${ns}@example.com`,
    stripeCustomerId: `cus_${ns}`,
    stripePaymentMethodId: `pm_${ns}`,
    autopayEnabled: "true",
  })
  .returning();

const [invoice] = await db.insert(invoicesTable).values({
  companyId: company.id,
  customerId: customer.id,
  invoiceNumber: `${ns}-1`,
  subtotal: "100.00",
  tax: "0",
  total: "100.00",
  status: "sent",
  dueDate: new Date(now + 7 * 24 * 60 * MIN),
  updatedAt: new Date(now),
}).returning();

async function fetchInvoice(id) {
  const [row] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
  return row;
}

// Age the in-flight claim past the sweep's 5-minute window WITHOUT changing
// status — simulates a charge that has been settling for a long time.
async function ageClaim(invoiceId) {
  await db.update(invoicesTable)
    .set({ updatedAt: new Date(Date.now() - 10 * MIN) })
    .where(eq(invoicesTable.id, invoiceId));
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

console.log("Autopay claim-ownership race test\n");

try {
  // -------------------------------------------------------------------------
  // The full stale-writer sequence, deterministically interleaved:
  //   A claims -> sweep releases A's stale claim -> B claims and blocks
  //   mid-charge -> A fails -> A's revert must NOT release B's claim ->
  //   B completes -> paid exactly once.
  // -------------------------------------------------------------------------
  const bStarted = deferred();   // resolved when B's Stripe create begins
  const bMayFinish = deferred(); // gates B's Stripe create until we've checked A

  onCreateCallStarted = (idx) => {
    if (idx === 1) bStarted.resolve();
  };

  let statusAfterSweepRelease = null;
  let statusAfterBClaim = null;
  let bClaimUpdatedAt = null;

  // Hook for charge A (first create call): the slow, doomed charge.
  createHooks.push(async () => {
    // Mid-charge A: its claim looks stale; a sweep pass releases it.
    await ageClaim(invoice.id);
    await releaseStuckProcessingInvoices();
    statusAfterSweepRelease = (await fetchInvoice(invoice.id)).status;

    // Charge B now claims the released invoice and starts ITS Stripe call.
    const bResponsePromise = charge(invoice.id);
    await bStarted.promise; // B has claimed and is mid-charge
    const midRow = await fetchInvoice(invoice.id);
    statusAfterBClaim = midRow.status;
    bClaimUpdatedAt = midRow.updatedAt?.getTime();
    // Stash B's response promise for later.
    globalThis.__bResponsePromise = bResponsePromise;

    // Slow A finally fails.
    throw new Error("Your card was declined.");
  });

  // Hook for charge B (second create call): held open until we've verified
  // that A's revert did not touch B's claim.
  createHooks.push(async () => {
    await bMayFinish.promise;
    return { id: `pi_b_${invoice.id}`, status: "succeeded" };
  });

  const aResult = await charge(invoice.id);

  check("the sweep really released A's stale claim mid-charge",
    statusAfterSweepRelease === "sent", statusAfterSweepRelease);
  check("B re-claimed the invoice while A was still settling",
    statusAfterBClaim === "processing", statusAfterBClaim);
  check("A's charge reports the failure", aResult.status === 402, `${aResult.status}`);

  // The heart of the test: after A's failure + revert, B's live claim must
  // still be intact. Before the fix, A's revert flipped it back to "sent".
  const afterAFailed = await fetchInvoice(invoice.id);
  check("A's revert did NOT release B's in-progress claim (still 'processing')",
    afterAFailed.status === "processing", afterAFailed.status);
  check("B's claim token (updatedAt) is untouched by A's revert",
    afterAFailed.updatedAt?.getTime() === bClaimUpdatedAt,
    `${afterAFailed.updatedAt?.getTime()} vs ${bClaimUpdatedAt}`);

  // And because the invoice is still claimed, a third charge attempt is
  // rejected without ever reaching Stripe.
  const third = await charge(invoice.id);
  check("a third charge attempt is rejected while B is settling (ChargeInProgress)",
    third.status === 409 && third.body.error === "ChargeInProgress", JSON.stringify(third));
  check("the third attempt created no PaymentIntent", createCalls.length === 2, `created ${createCalls.length}`);

  // Let B finish; it must win cleanly.
  bMayFinish.resolve();
  const bResult = await globalThis.__bResponsePromise;
  check("B's charge completes successfully", bResult.status === 200 && bResult.body.status === "paid", JSON.stringify(bResult));

  const finalRow = await fetchInvoice(invoice.id);
  check("invoice ends 'paid' exactly once, with B's PaymentIntent",
    finalRow.status === "paid" && finalRow.stripePaymentIntentId === `pi_b_${invoice.id}`,
    `${finalRow.status} / ${finalRow.stripePaymentIntentId}`);
  check("notifications fired exactly once (B is the single winner)",
    receiptCalls.length === 1 && ownerNotifCalls.length === 1,
    `receipts ${receiptCalls.length}, owner ${ownerNotifCalls.length}`);
  check("exactly two PaymentIntent creates ever happened (A + B)",
    createCalls.length === 2, `created ${createCalls.length}`);

  // -------------------------------------------------------------------------
  // Source assertion: the revert carries the ownership token, not just the
  // status guard.
  // -------------------------------------------------------------------------
  console.log("\nOwnership-token guard is present in the charge handler's source:");
  {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const autopaySrc = readFileSync(path.join(here, "../src/routes/autopay.ts"), "utf8");
    check("claim captures its own updatedAt as an ownership token",
      /claimToken\s*=\s*claimed\[0\]\.updatedAt/.test(autopaySrc));
    check("revert is guarded by the claim's own updatedAt token",
      /eq\(invoicesTable\.updatedAt,\s*claimToken\)/.test(autopaySrc));
    check("revert still keeps the status === 'processing' guard",
      /eq\(invoicesTable\.status,\s*"processing"\)/.test(autopaySrc));
  }
} finally {
  server.close();
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
