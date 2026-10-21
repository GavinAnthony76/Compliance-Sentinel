#!/usr/bin/env node
/**
 * End-to-end verification of the PUBLIC estimate share-link flow (#222):
 * GET /public/estimates/:token, POST .../:token/sign and GET .../:token/pdf.
 *
 * Share tokens are stored only as a SHA-256 hash (routes/estimates.ts); the
 * customer holds the raw token. Every public handler must therefore hash the
 * incoming token before looking it up, so that:
 *
 *   1. The raw share token works for view, sign AND the PDF download.
 *   2. The stored hash is never itself a usable link (a leaked DB value or a
 *      response that echoes the hash must not unlock the estimate).
 *   3. A signature actually persists, exactly once — a repeat or a burst of
 *      concurrent submissions yields one acceptance and AlreadySigned for the
 *      rest, never a 500.
 *   4. Rejected estimates and unknown tokens cannot be signed.
 *
 * The raw token is minted by this test and its hash written straight into the
 * throwaway test DB (the API only ever emails the raw link). Like the other
 * black-box suites it talks to a RUNNING api-server and self-provisions its own
 * company, so it is repeatable and independent of existing data.
 *
 * Usage:
 *   API_BASE="http://127.0.0.1:5098/api" node tests/public-estimate-signing.e2e.mjs
 *
 * Exit code 0 = all checks passed, 1 = at least one check failed.
 */

import crypto from "node:crypto";
import pg from "pg";

const BASE =
  process.env.API_BASE ||
  (process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}/api`
    : "http://localhost:5000/api");

const PASSWORD = "TestPass123!";
const stamp = Date.now();
const SIGNATURE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

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

async function req(method, path, { token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const contentType = res.headers.get("content-type") || "";
  let json = null;
  let bytes = 0;
  if (contentType.includes("application/json")) {
    try {
      json = await res.json();
    } catch {
      /* non-JSON response is fine */
    }
  } else {
    bytes = (await res.arrayBuffer()).byteLength;
  }
  return { status: res.status, json, contentType, bytes, disposition: res.headers.get("content-disposition") || "" };
}

async function withDb(fn) {
  const cs = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
  if (!cs) throw new Error("DATABASE_URL not set; cannot seed share tokens.");
  const client = new pg.Client({ connectionString: cs, ssl: process.env.NEON_DATABASE_URL ? true : undefined });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");

// Give an estimate a fresh share link: returns the raw token the customer would hold.
async function mintShareToken(estimateId, extra = {}) {
  const raw = crypto.randomBytes(32).toString("hex");
  await withDb((c) =>
    c.query("UPDATE estimates SET public_token = $1, status = COALESCE($2, status) WHERE id = $3", [
      sha256(raw),
      extra.status ?? null,
      estimateId,
    ]),
  );
  return raw;
}

async function registerCompany(label) {
  const nsPrefix = process.env.TEST_RUN_NS ? `${process.env.TEST_RUN_NS}_` : "";
  const ownerEmail = `${nsPrefix}pubest_${label}_owner_${stamp}@example.com`;
  const reg = await req("POST", "/auth/register", {
    body: {
      firstName: "Olive",
      lastName: "Owner",
      email: ownerEmail,
      password: PASSWORD,
      companyName: `PubEst Test ${label} ${stamp}`,
      selectedPlan: "pro",
    },
  });
  if (reg.status === 201) {
    const { markOwnerVerified } = await import("./verify-owner.mjs");
    await markOwnerVerified(ownerEmail);
    const ownerLogin = await req("POST", "/auth/login", { body: { identifier: ownerEmail, password: PASSWORD } });
    reg.status = ownerLogin.status === 200 ? 201 : ownerLogin.status;
    reg.json = ownerLogin.json;
  }
  if (reg.status !== 201 || !reg.json?.token) {
    console.error(`Setup failed: could not register company ${label}`, reg.status, reg.json);
    process.exit(1);
  }
  return reg.json.token;
}

async function createCustomer(ownerToken, label, email) {
  const created = await req("POST", "/customers", {
    token: ownerToken,
    body: { firstName: "Cara", lastName: `Customer ${label}`, phone: `555${stamp}`.slice(0, 12), ...(email ? { email } : {}) },
  });
  if (created.status !== 201 || !created.json?.id) {
    console.error(`Setup failed: could not create customer ${label}`, created.status, created.json);
    process.exit(1);
  }
  return created.json.id;
}

async function createEstimate(ownerToken, customerId, label) {
  const created = await req("POST", "/estimates", {
    token: ownerToken,
    body: { customerId, notes: `Estimate ${label} ${stamp}`, lineItems: [{ description: "Lawn mowing", quantity: 1, unitPrice: 99.99 }] },
  });
  if (created.status !== 201 || !created.json?.id) {
    console.error("Setup failed: could not create estimate", created.status, created.json);
    process.exit(1);
  }
  return created.json.id;
}

const sign = (token, signerName = "Cara Customer") =>
  req("POST", `/public/estimates/${token}/sign`, { body: { signerName, signatureData: SIGNATURE } });

async function main() {
  console.log(`Public estimate signing e2e against: ${BASE}\n`);

  const ownerToken = await registerCompany("A");
  const customer = await createCustomer(ownerToken, "A", `pubest_cust_${stamp}@example.com`);

  // --- 1. Raw share token works for view and PDF; the stored hash does not ---
  console.log("Share-link lookup — raw token works, stored hash is not a link:");
  const estimateId = await createEstimate(ownerToken, customer, "main");
  const raw = await mintShareToken(estimateId);
  const storedHash = sha256(raw);
  {
    const r = await req("GET", `/public/estimates/${raw}`);
    check("GET with the raw share token -> 200", r.status === 200 && r.json?.id === estimateId, `got ${r.status}`);
    check("the estimate starts unsigned", r.json && r.json.signedAt == null, JSON.stringify(r.json?.signedAt));
  }
  {
    const r = await req("GET", `/public/estimates/${raw}/pdf`);
    check(
      "PDF with the raw share token -> 200 application/pdf",
      r.status === 200 && r.contentType.includes("application/pdf") && r.bytes > 0,
      `got ${r.status} ${r.contentType}`,
    );
  }
  for (const [label, path] of [
    ["GET", `/public/estimates/${storedHash}`],
    ["PDF", `/public/estimates/${storedHash}/pdf`],
  ]) {
    const r = await req("GET", path);
    check(`${label} with the STORED HASH as the token -> 404`, r.status === 404, `got ${r.status}`);
  }
  {
    const r = await sign(storedHash);
    check("sign with the STORED HASH as the token -> 404", r.status === 404, `got ${r.status}`);
  }

  // --- 2. Signing persists exactly once --------------------------------------
  console.log("\nSigning — persists once, repeat is rejected:");
  {
    const r = await sign(raw);
    check("sign with the raw share token -> 200 success", r.status === 200 && r.json?.success === true, `got ${r.status} ${JSON.stringify(r.json)}`);
  }
  {
    const r = await req("GET", `/public/estimates/${raw}`);
    check("the signature is persisted (signedAt set)", r.json?.signedAt != null, JSON.stringify(r.json?.signedAt));
    check("the estimate is now accepted", r.json?.status === "accepted", r.json?.status);
    check("the signer name is recorded", r.json?.signerName === "Cara Customer", r.json?.signerName);
  }
  {
    const r = await req("GET", `/public/estimates/${raw}/pdf`);
    check(
      "signed PDF downloads with the same raw token as a -signed copy",
      r.status === 200 && /-signed\.pdf/.test(r.disposition),
      `got ${r.status} ${r.disposition}`,
    );
  }
  {
    const r = await sign(raw, "Someone Else");
    check("a second signature -> 400 AlreadySigned", r.status === 400 && r.json?.error === "AlreadySigned", `got ${r.status} ${JSON.stringify(r.json)}`);
    const after = await req("GET", `/public/estimates/${raw}`);
    check("the original signer is kept", after.json?.signerName === "Cara Customer", after.json?.signerName);
  }

  // --- 3. Concurrent signatures: exactly one wins ----------------------------
  console.log("\nConcurrent signing — exactly one acceptance:");
  {
    const id = await createEstimate(ownerToken, customer, "race");
    const t = await mintShareToken(id);
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => sign(t, `Racer ${n}`)));
    const statuses = results.map((r) => r.status);
    check("exactly one concurrent signature succeeds", statuses.filter((s) => s === 200).length === 1, JSON.stringify(statuses));
    check(
      "every other concurrent signature gets 400 AlreadySigned (no 500)",
      results.filter((r) => r.status !== 200).every((r) => r.status === 400 && r.json?.error === "AlreadySigned"),
      JSON.stringify(results.map((r) => [r.status, r.json?.error])),
    );
    const winner = results.find((r) => r.status === 200);
    const after = await req("GET", `/public/estimates/${t}`);
    check("the persisted signer is one of the racers", /^Racer [1-5]$/.test(after.json?.signerName ?? ""), after.json?.signerName);
    check("winner's response matches the persisted signedAt", winner && after.json?.signedAt === winner.json?.signedAt, `${winner?.json?.signedAt} vs ${after.json?.signedAt}`);
  }

  // --- 4. Rejected estimates and unknown tokens cannot be signed -------------
  console.log("\nRejected / unknown tokens:");
  {
    const id = await createEstimate(ownerToken, customer, "rejected");
    const t = await mintShareToken(id, { status: "rejected" });
    const r = await sign(t);
    check("signing a rejected estimate -> 400 Rejected", r.status === 400 && r.json?.error === "Rejected", `got ${r.status} ${JSON.stringify(r.json)}`);
    const after = await req("GET", `/public/estimates/${t}`);
    check("the rejected estimate stays unsigned", after.json?.signedAt == null && after.json?.status === "rejected", JSON.stringify(after.json));
  }
  {
    const bogus = crypto.randomBytes(32).toString("hex");
    const view = await req("GET", `/public/estimates/${bogus}`);
    const pdf = await req("GET", `/public/estimates/${bogus}/pdf`);
    const s = await sign(bogus);
    check("unknown token: view -> 404", view.status === 404, `got ${view.status}`);
    check("unknown token: PDF -> 404", pdf.status === 404, `got ${pdf.status}`);
    check("unknown token: sign -> 404", s.status === 404, `got ${s.status}`);
  }

  // --- 5. Confirmation wording follows the actual email outcome ---------------
  console.log("\nConfirmation message:");
  {
    const noEmailCustomer = await createCustomer(ownerToken, "noemail");
    const id = await createEstimate(ownerToken, noEmailCustomer, "noemail");
    const t = await mintShareToken(id);
    const r = await sign(t);
    check(
      "a customer without email is told to download, not that it was emailed",
      r.status === 200 && r.json?.customerHasEmail === false && !/emailed/i.test(r.json?.message ?? ""),
      JSON.stringify(r.json),
    );
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
