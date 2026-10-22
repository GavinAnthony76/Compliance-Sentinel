#!/usr/bin/env node
/**
 * REVIEW-C — characterization tests for in-process background jobs under
 * Autoscale conditions (overlapping instances, interrupted runs, failed sends).
 *
 * These tests PIN CURRENT BEHAVIOR recorded in
 * docs/claude-handoff/reviews/REVIEW-C-background-jobs.md. "FINDING" checks
 * are not endorsements: they document today's behavior so each approved
 * correction lands as a deliberate, reviewed change to this file.
 *
 * Drives the real lib/follow-ups.ts and lib/recurring.ts against an in-memory
 * @workspace/db; notifications / SMS consent / communications are mocked.
 * No network or database is touched; nothing is sent.
 *
 * Exit code 0 = all checks passed, 1 = at least one check failed.
 */

import { register } from "node:module";
import { mock } from "node:test";

register("./ts-resolve.loader.mjs", import.meta.url);

// --- In-memory db ---------------------------------------------------------------
const store = { followUpLogs: [], followUpCampaigns: [], customers: [], leads: [], recurringPlans: [], appointments: [] };
let nextId = 1;
let failStatusWrite = false; // make the follow-up's final status write throw once
let appointmentLookupDelayMs = 0; // widen the select-then-insert window

const makeTable = (key) => new Proxy({ __store: key }, { get: (t, p) => (p in t ? t[p] : { __col: String(p) }) });
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

const fakeDb = {
  select() {
    return {
      from(table) {
        let pred = null;
        const run = async () => {
          // Read the snapshot first, then (optionally) delay the reply — like a
          // real query whose result is in flight while another instance writes.
          const rows = store[table.__store].filter((r) => !pred || pred(r)).map((r) => ({ ...r }));
          if (table.__store === "appointments" && appointmentLookupDelayMs) await tick(appointmentLookupDelayMs);
          return rows;
        };
        const b = {
          where(p) {
            pred = p;
            return b;
          },
          limit: async (n) => (await run()).slice(0, n),
          then: (ok, err) => run().then(ok, err),
        };
        return b;
      },
    };
  },
  insert(table) {
    return {
      values: async (v) => {
        const row = { id: nextId++, ...v };
        store[table.__store].push(row);
        return [row];
      },
    };
  },
  update(table) {
    return {
      set(vals) {
        return {
          where(pred) {
            const exec = async () => {
              if (failStatusWrite && table.__store === "followUpLogs" && vals.status && vals.status !== "processing") {
                failStatusWrite = false;
                throw new Error("db write failed (test)");
              }
              const rows = store[table.__store].filter((r) => !pred || pred(r));
              rows.forEach((r) => Object.assign(r, vals));
              return rows.map((r) => ({ ...r }));
            };
            return { returning: () => exec(), then: (ok, err) => exec().then(ok, err) };
          },
        };
      },
    };
  },
};

const val = (v) => (v instanceof Date ? v.getTime() : v);
const dbNamedExports = {
  db: fakeDb,
  followUpLogsTable: makeTable("followUpLogs"),
  followUpCampaignsTable: makeTable("followUpCampaigns"),
  customersTable: makeTable("customers"),
  leadsTable: makeTable("leads"),
  recurringPlansTable: makeTable("recurringPlans"),
  appointmentsTable: makeTable("appointments"),
};
mock.module("@workspace/db", { namedExports: dbNamedExports });
const drizzleNamedExports = {
  eq: (c, v) => (r) => val(r[c.__col]) === val(v),
  and: (...ps) => (r) => ps.every((p) => !p || p(r)),
  lte: (c, v) => (r) => val(r[c.__col]) <= val(v),
  isNotNull: (c) => (r) => r[c.__col] != null,
};
mock.module("drizzle-orm", { namedExports: drizzleNamedExports });

// --- Messaging mocks ------------------------------------------------------------
const sends = [];
const commEvents = [];
let emailResult = { delivered: true };
const relativeMocks = {
  "../src/lib/notifications.ts": {
    sendEmail: async (p) => {
      sends.push(p);
      return emailResult;
    },
    sendSMS: async (p) => {
      sends.push(p);
      return { success: true };
    },
  },
  "../src/lib/sms-consent.ts": { sendSMSWithConsent: async () => ({ sent: true }) },
  "../src/lib/communications.ts": {
    logCommunicationEvent: async (e) => {
      commEvents.push(e);
    },
  },
};
for (const [specifier, namedExports] of Object.entries(relativeMocks)) mock.module(specifier, { namedExports });

const { assertMockCovers, assertRelativeMockCovers } = await import("./mock-surface-check.mjs");
const entryFiles = ["../src/lib/follow-ups.ts", "../src/lib/recurring.ts"];
const skipModules = Object.keys(relativeMocks);
for (const [packageName, exportsObject] of [["@workspace/db", dbNamedExports], ["drizzle-orm", drizzleNamedExports]]) {
  assertMockCovers({ testFile: import.meta.url, packageName, providedNames: Object.keys(exportsObject), entryFiles, skipModules });
}
for (const [modulePath, exportsObject] of Object.entries(relativeMocks)) {
  assertRelativeMockCovers({ testFile: import.meta.url, modulePath, providedNames: Object.keys(exportsObject), entryFiles, skipModules });
}

const { processPendingFollowUps } = await import("../src/lib/follow-ups.ts");
const { generateDueRecurringAppointments } = await import("../src/lib/recurring.ts");

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

function seedFollowUp() {
  const companyId = nextId++;
  const customer = { id: nextId++, companyId, firstName: "Casey", lastName: "Customer", email: "casey@customer.test", phone: null, emailOptOut: false, smsOptOut: false };
  const campaign = { id: nextId++, companyId, isActive: true, delayHours: 0, channel: "email", messageTemplate: "Hi {{firstName}}", subject: "Hello" };
  const log = { id: nextId++, companyId, campaignId: campaign.id, customerId: customer.id, leadId: null, status: "pending", createdAt: new Date(Date.now() - 60_000) };
  store.customers.push(customer);
  store.followUpCampaigns.push(campaign);
  store.followUpLogs.push(log);
  return store.followUpLogs.at(-1);
}
const reset = () => {
  sends.length = 0;
  commEvents.length = 0;
};

console.log("REVIEW-C background job characterization\n");

console.log("Follow-up campaigns (lib/follow-ups.ts):");
{
  const log = seedFollowUp();
  reset();
  await Promise.all([processPendingFollowUps(), processPendingFollowUps()]);
  check("overlapping runs send a due follow-up exactly once (atomic pending->processing claim)", sends.length === 1 && log.status === "sent", `${sends.length} ${log.status}`);
}
{
  const log = seedFollowUp();
  reset();
  emailResult = { delivered: false, reason: "provider_rejected" };
  await processPendingFollowUps();
  emailResult = { delivered: true };
  check("FINDING C5: an email the provider did NOT deliver is recorded as 'sent'", log.status === "sent", log.status);
  check("FINDING C5: ...and logged as a 'sent' communication event", commEvents.some((e) => e.status === "sent"), JSON.stringify(commEvents));
}
{
  const log = seedFollowUp();
  reset();
  failStatusWrite = true; // run interrupted after the send, before the status write
  await processPendingFollowUps();
  check("an interrupted run leaves the claimed row in 'processing'", log.status === "processing", log.status);
  await processPendingFollowUps();
  await processPendingFollowUps();
  check("FINDING C2: nothing ever recovers a 'processing' row (stuck forever, outcome unknown)", log.status === "processing" && sends.length === 1, `${log.status} sends=${sends.length}`);
}

console.log("\nRecurring appointments (lib/recurring.ts):");
{
  const plan = {
    id: nextId++, companyId: nextId++, customerId: nextId++, propertyId: null, serviceId: null, price: "50.00",
    isActive: true, frequencyType: "weekly", intervalValue: 1, nextRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };
  store.recurringPlans.push(plan);
  const single = await generateDueRecurringAppointments({ companyId: plan.companyId });
  const slots = store.appointments.filter((a) => a.customerId === plan.customerId).length;
  check("a single run creates one appointment per slot in the 14-day horizon", single === 2 && slots === 2, `created ${single}, rows ${slots}`);

  // Two instances run the hourly job at the same time on a freshly due plan.
  const plan2 = { ...plan, id: nextId++, companyId: nextId++, customerId: nextId++, nextRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000) };
  store.recurringPlans.push(plan2);
  appointmentLookupDelayMs = 5;
  await Promise.all([
    generateDueRecurringAppointments({ companyId: plan2.companyId }),
    generateDueRecurringAppointments({ companyId: plan2.companyId }),
  ]);
  appointmentLookupDelayMs = 0;
  const rows = store.appointments.filter((a) => a.customerId === plan2.customerId);
  const distinctSlots = new Set(rows.map((a) => a.scheduledStart.getTime())).size;
  check("FINDING C4: overlapping runs duplicate every generated appointment (select-then-insert, no lock/unique key)", rows.length === 2 * distinctSlots && distinctSlots === 2, `${rows.length} rows for ${distinctSlots} slots`);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
