#!/usr/bin/env node
/**
 * Portal payment claim-ownership race test: the customer-portal payment
 * writers must not touch a claim created AFTER their pre-read.
 *
 * Mirrors tests/sweep-claim-ownership.test.mjs, but with the PORTAL routes as
 * the stale writers:
 *
 *   A. POST /portal/invoices/:id/confirm-payment
 *      1. Reads the invoice (unpaid, has a stored checkout session id).
 *      2. Goes off to Stripe to verify the session (slow).
 *      3. Meanwhile an autopay charge CLAIMS the invoice (status ->
 *         "processing" with a fresh updatedAt).
 *      4. Before the fix, the paid-write was guarded only by status != "paid"
 *         — it flipped the LIVE claim to paid and clobbered its ownership
 *         token, while the concurrent charge was still settling.
 *
 *   B. POST /portal/invoices/:id/pay (session-store write)
 *      Same shape: the invoice read at the top is stale by the time the
 *      checkout session is created; the write that stores the session id must
 *      not overwrite a claim created in between (it would rewrite the claim's
 *      updatedAt token, silently breaking the claim owner's guarded revert).
 *
 * The fix: both writes also match the exact updatedAt observed in the
 * pre-read (status guard AND updatedAt token), mirroring
 * src/lib/stuck-invoices.ts. A fresh claim wrote a new updatedAt, so the
 * stale portal write matches zero rows.
 *
 * The Stripe webhook paid-write (routes/billing.ts) was audited too: it does
 * NO prior select — it acts solely on the Stripe-signed event via a single
 * conditional UPDATE — so there is no select-then-update race there. A source
 * assertion below locks in that its transition guard is still present.
 *
 * This suite runs the REAL customer-portal router (mounted in a tiny express
 * app, authenticated with a real portal JWT) against the REAL local test
 * database, and injects the re-claim deterministically inside the mocked
 * Stripe calls — i.e. exactly between the route's pre-read and its write.
 *
 * MUST be run by tests/run-all-ci.mjs (or with NEON_DATABASE_URL cleared and
 * the local test DB schema pushed) so it never touches production.
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
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "portal-claim-own-test-secret";
process.env.APP_BASE_URL = "http://portal-claim-own.test";

// Resolve the api-server's extensionless relative .ts imports the way esbuild
// does at build time.
register("./ts-resolve.loader.mjs", import.meta.url);

// ---------------------------------------------------------------------------
// Mocks: Stripe (with per-call mid-flight hooks), notifications, object
// storage (constructed at customer-portal import time; needs no real bucket).
// ---------------------------------------------------------------------------

// Hooks run INSIDE the mocked Stripe calls — i.e. exactly between the route's
// pre-read and its guarded write. FIFO, one-shot.
let onSessionRetrieve = null; // async () => void
let onSessionCreate = null;   // async () => void
let retrievePaymentStatus = "paid";

const stripeNamedExports = {
    getUncachableStripeClient: async () => ({
      checkout: {
        sessions: {
          retrieve: async (sessionId) => {
            if (onSessionRetrieve) {
              const hook = onSessionRetrieve;
              onSessionRetrieve = null;
              await hook();
            }
            return { id: sessionId, payment_status: retrievePaymentStatus };
          },
          create: async () => {
            if (onSessionCreate) {
              const hook = onSessionCreate;
              onSessionCreate = null;
              await hook();
            }
            return { id: `cs_fresh_${Date.now()}`, url: "https://stripe.test/checkout" };
          },
        },
      },
      v2: {
        core: {
          accounts: {
            retrieve: async () => ({
              configuration: { merchant: { capabilities: { card_payments: { status: "active" } } } },
            }),
          },
        },
      },
    }),
};

const receiptCalls = [];
const ownerNotifCalls = [];
const notificationsNamedExports = {
  sendEmail: async () => ({ delivered: false, reason: "test" }),
  dispatchPaymentReceiptEmail: (invoiceId, companyId) => {
    receiptCalls.push({ invoiceId, companyId });
  },
  dispatchOwnerPaymentNotification: (invoiceId, companyId) => {
    ownerNotifCalls.push({ invoiceId, companyId });
  },
  // Inert stubs for the rest of the module surface customer-portal.ts (and
  // sms-consent.ts) can reach; the payment paths under test never call them.
  resolveCompanyNotificationEmail: async () => null,
  sendBookingConfirmationEmail: async () => ({ delivered: false, reason: "test" }),
  sendBookingRequestNotification: async () => ({ delivered: false, reason: "test" }),
  sendPortalAccessEmail: async () => ({ delivered: false, reason: "test" }),
  sendPortalCancellationNotification: async () => ({ delivered: false, reason: "test" }),
  sendSMS: async () => ({ success: false }),
};

const relativeMocks = {
  "../src/lib/stripe.ts": stripeNamedExports,
  "../src/lib/notifications.ts": notificationsNamedExports,
  "../src/lib/objectStorage.ts": { ObjectStorageService: class {} },
};
for (const [specifier, namedExports] of Object.entries(relativeMocks)) {
  mock.module(specifier, { namedExports });
}

// Preflight: fail with an actionable message if production code grew an
// import these mocks don't provide (instead of an opaque import-time crash).
const { assertSuiteMocksCover } = await import("./mock-surface-check.mjs");
assertSuiteMocksCover({
  testFile: import.meta.url,
  entryFiles: ["../src/routes/customer-portal.ts"],
  relativeMocks,
});

// Imported AFTER the mocks so the router picks them up.
const { db, pool, invoicesTable, companiesTable, customersTable } = await import("@workspace/db");
const customerPortalRouter = (await import("../src/routes/customer-portal.ts")).default;
const { eq } = await import("drizzle-orm");
const express = (await import("express")).default;
const jwt = (await import("jsonwebtoken")).default;

const app = express();
app.use(express.json());
app.use("/portal", customerPortalRouter);
const server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;

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
const ns = `pown${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

// ---------------------------------------------------------------------------
// Seed one card-payments-ready company + portal customer.
// ---------------------------------------------------------------------------
const [company] = await db.insert(companiesTable).values({
  name: `Portal Claim Ownership Test Co ${ns}`,
  slug: `portal-own-${ns}`,
  subscriptionPlan: "growth",
  acceptedPaymentMethods: JSON.stringify(["cash", "check", "card"]),
  stripeConnectAccountId: `acct_${ns}`,
}).returning();
const [customer] = await db.insert(customersTable)
  .values({ companyId: company.id, firstName: "Portal", lastName: "Owner", email: `${ns}@example.com` })
  .returning();

// Real portal JWT, signed exactly the way customer-portal.ts signs them.
const portalToken = jwt.sign(
  { customerId: customer.id, companyId: company.id, type: "portal" },
  process.env.SESSION_SECRET + "portal:",
  { expiresIn: "1h" },
);
const authHeaders = { Authorization: `Bearer ${portalToken}`, "Content-Type": "application/json" };

let invoiceSeq = 0;
async function seedInvoice(overrides = {}) {
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
    ...overrides,
  }).returning();
  return row;
}

async function fetchInvoice(id) {
  const [row] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
  return row;
}

// Simulate a concurrent autopay charge claiming the invoice: status ->
// "processing" with a NEW updatedAt (a fresh ownership token).
async function reclaimInvoice(invoiceId) {
  const [row] = await db.update(invoicesTable)
    .set({ status: "processing", updatedAt: new Date() })
    .where(eq(invoicesTable.id, invoiceId))
    .returning();
  return row;
}

async function post(pathName) {
  const res = await fetch(`${baseUrl}${pathName}`, { method: "POST", headers: authHeaders });
  return { status: res.status, body: await res.json() };
}

console.log("Portal payment claim-ownership race test\n");

try {
  // -------------------------------------------------------------------------
  // 1. confirm-payment cannot flip a claim created after its pre-read.
  // -------------------------------------------------------------------------
  console.log("confirm-payment cannot overwrite a claim created after its read:");
  {
    receiptCalls.length = 0;
    ownerNotifCalls.length = 0;
    const inv = await seedInvoice({ stripePaymentIntentId: `cs_stale_${ns}` });
    let freshClaimUpdatedAt = null;
    onSessionRetrieve = async () => {
      const fresh = await reclaimInvoice(inv.id);
      freshClaimUpdatedAt = fresh.updatedAt?.getTime();
    };

    const res = await post(`/portal/invoices/${inv.id}/confirm-payment`);
    check("request completes without error", res.status === 200, `${res.status} ${JSON.stringify(res.body)}`);

    const after = await fetchInvoice(inv.id);
    check("the fresh claim is still 'processing' (not flipped to paid)",
      after.status === "processing", after.status);
    check("no paidAt written onto the fresh claim", after.paidAt === null, `${after.paidAt}`);
    check("the fresh claim's updatedAt token is untouched",
      after.updatedAt?.getTime() === freshClaimUpdatedAt,
      `${after.updatedAt?.getTime()} vs ${freshClaimUpdatedAt}`);
    check("no notifications fired for the skipped write",
      receiptCalls.length === 0 && ownerNotifCalls.length === 0,
      `receipts ${receiptCalls.length}, owner ${ownerNotifCalls.length}`);
  }

  // -------------------------------------------------------------------------
  // 2. Control: with no interleaved claim, confirm-payment still marks paid
  //    and notifies exactly once.
  // -------------------------------------------------------------------------
  console.log("\nWithout a re-claim, confirm-payment still marks paid:");
  {
    receiptCalls.length = 0;
    ownerNotifCalls.length = 0;
    const inv = await seedInvoice({ stripePaymentIntentId: `cs_ok_${ns}` });

    const res = await post(`/portal/invoices/${inv.id}/confirm-payment`);
    check("request confirms", res.status === 200 && res.body.confirmed === true, JSON.stringify(res.body));

    const after = await fetchInvoice(inv.id);
    check("invoice is paid", after.status === "paid", after.status);
    check("notifications fired exactly once",
      receiptCalls.length === 1 && ownerNotifCalls.length === 1,
      `receipts ${receiptCalls.length}, owner ${ownerNotifCalls.length}`);
  }

  // -------------------------------------------------------------------------
  // 3. /pay's session-store write cannot touch a claim created after its read.
  // -------------------------------------------------------------------------
  console.log("\n/pay cannot overwrite a claim created after its read:");
  {
    const inv = await seedInvoice();
    let freshClaimUpdatedAt = null;
    onSessionCreate = async () => {
      const fresh = await reclaimInvoice(inv.id);
      freshClaimUpdatedAt = fresh.updatedAt?.getTime();
    };

    const res = await post(`/portal/invoices/${inv.id}/pay`);
    check("checkout session is still returned", res.status === 200 && !!res.body.url, JSON.stringify(res.body));

    const after = await fetchInvoice(inv.id);
    check("the fresh claim is still 'processing'", after.status === "processing", after.status);
    check("the stale session id was NOT written onto the fresh claim",
      after.stripePaymentIntentId === null, `${after.stripePaymentIntentId}`);
    check("the fresh claim's updatedAt token is untouched",
      after.updatedAt?.getTime() === freshClaimUpdatedAt,
      `${after.updatedAt?.getTime()} vs ${freshClaimUpdatedAt}`);
  }

  // -------------------------------------------------------------------------
  // 4. Control: with no interleaved claim, /pay still stores the session id.
  // -------------------------------------------------------------------------
  console.log("\nWithout a re-claim, /pay still stores the session id:");
  {
    const inv = await seedInvoice();
    const res = await post(`/portal/invoices/${inv.id}/pay`);
    check("checkout session returned", res.status === 200 && !!res.body.url, JSON.stringify(res.body));
    const after = await fetchInvoice(inv.id);
    check("session id stored on the invoice",
      typeof after.stripePaymentIntentId === "string" && after.stripePaymentIntentId.startsWith("cs_fresh_"),
      `${after.stripePaymentIntentId}`);
  }

  // -------------------------------------------------------------------------
  // 5. Source assertions: token guards present; webhook write stays atomic.
  // -------------------------------------------------------------------------
  console.log("\nOwnership-token guards are present in the sources:");
  {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const portalSrc = readFileSync(path.join(here, "../src/routes/customer-portal.ts"), "utf8");
    check("confirm-payment captures the observed updatedAt as an ownership token",
      /claimToken\s*=\s*invoice\.updatedAt/.test(portalSrc));
    check("confirm-payment's paid-write matches the observed updatedAt token",
      /date_trunc\('milliseconds', \$\{invoicesTable\.updatedAt\}\) = \$\{claimToken\}/.test(portalSrc));
    check("/pay's session-store write matches the observed updatedAt token",
      /date_trunc\('milliseconds', \$\{invoicesTable\.updatedAt\}\) = \$\{invoice\.updatedAt\}/.test(portalSrc));
    check("both portal writes keep the status != 'paid' transition guard",
      (portalSrc.match(/ne\(invoicesTable\.status,\s*"paid"\)/g) || []).length >= 2);

    // The webhook paid-write does no prior select, so it needs no token —
    // but its atomic transition guard must stay.
    const billingSrc = readFileSync(path.join(here, "../src/routes/billing.ts"), "utf8");
    check("webhook paid-write keeps its atomic status != 'paid' transition guard",
      /ne\(invoicesTable\.status,\s*"paid"\)/.test(billingSrc));
  }
} finally {
  server.close();
  try {
    await db.delete(companiesTable).where(eq(companiesTable.id, company.id));
  } catch (err) {
    console.error(`Cleanup failed (local test DB): ${err.message}`);
  }
  await pool.end();
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
