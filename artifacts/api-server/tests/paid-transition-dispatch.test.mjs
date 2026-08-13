import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// Static guard: every code path that transitions an invoice to "paid" must
// trigger BOTH payment email dispatchers (receipt to the customer + owner
// notification). The awaited-dispatch guard catches un-awaited calls, but a
// future endpoint that flips status -> paid and simply never CALLS the
// dispatchers would ship silently with no emails. This test finds every
// `status: "paid"` write in api-server source and requires the dispatchers
// to be genuinely invoked within the lines that follow it.
//
// ACCEPTED INDIRECTIONS (intentional accept-list — anything else is flagged):
//   1. Direct awaited call:            await dispatchPaymentReceiptEmail(...)
//   2. Awaited Promise.all/allSettled: await Promise.all([dispatchPaymentReceiptEmail(...), ...])
//   3. A local wrapper function defined inside the window that awaits the
//      dispatcher, PROVIDED the wrapper itself is awaited-invoked inside the
//      same window (a defined-but-never-called wrapper does NOT count).
// KNOWN EVASIONS THE GUARD MUST CATCH (covered by fixture tests below):
//   - Moving the paid write into a helper that never dispatches.
//   - Spacing the dispatch more than WINDOW_LINES below the write.
//   - Wrapping the dispatchers in a local function that is never invoked.
//   - Passing the dispatcher as a bare reference/callback without awaiting.
//   - Writing the paid transition as raw SQL (sql`UPDATE ... SET status='paid'`
//     or db.execute("UPDATE ...")) — banned outright, dispatchers or not.

const DISPATCHERS = [
  "dispatchPaymentReceiptEmail",
  "dispatchOwnerPaymentNotification",
];

// How far below a paid-write the dispatcher calls must appear. All current
// call sites dispatch within ~16 lines; 80 leaves generous room for guards
// and comments while still keeping dispatch tied to the transition.
const WINDOW_LINES = 80;

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

function collectTsFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectTsFiles(full, out);
    } else if (/\.(ts|mts|cts|tsx)$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

// Strip comments only (NOT strings — the "paid" literal is the thing we are
// looking for). Preserves newlines so line numbers stay accurate.
function stripComments(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < n && source[i] !== "\n") { out += " "; i++; }
    } else if (c === "/" && next === "*") {
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < n) { out += "  "; i += 2; }
    } else if (c === '"' || c === "'" || c === "`") {
      // Copy string literals verbatim (skipping escape pairs) so that a
      // `status: "paid"` write is visible but a `//` inside a string doesn't
      // start a fake comment.
      const quote = c;
      out += c;
      i++;
      while (i < n && source[i] !== quote) {
        if (source[i] === "\\") { out += source[i] + (source[i + 1] ?? ""); i += 2; continue; }
        out += source[i];
        i++;
      }
      if (i < n) { out += source[i]; i++; }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// A paid WRITE is an object-literal property assignment `status: "paid"`
// (as passed to db.update(...).set({...}) or built into an update object).
// Comparisons look different (`status === "paid"`, `eq(x.status, "paid")`,
// SQL strings use `status='paid'`) and are not matched.
const PAID_WRITE_RE = /\bstatus\s*:\s*["']paid["']/g;

// Raw-SQL paid WRITES are banned outright. An UPDATE written as a SQL string
// or template (drizzle sql`UPDATE invoices SET status = 'paid' ...`, or
// db.execute("UPDATE ...")) bypasses the object-literal pattern above, so the
// window/dispatcher analysis never sees it. Rather than trying to prove the
// dispatchers run near an opaque string, any `SET ... status = 'paid'`
// expressed in raw SQL is rejected — such transitions must go through
// db.update(...).set({ status: "paid" }) so the guard above applies.
// Read-only SQL (`CASE WHEN status='paid'`, `WHERE status = 'paid'`) has no
// preceding SET clause and is not matched. The lookbehind-free scan below
// finds a SET keyword followed by a status='paid' assignment with no
// statement-terminating punctuation between them.
// The identifier may be bare, quoted ("status", `status`) or a drizzle column
// interpolation (`${invoices.status}` — matched via the trailing `}`), and the
// assigned value may be:
//   - the literal 'paid' / "paid"
//   - a JS template interpolation `${...}` (dynamic — could be 'paid')
//   - any SQL bind parameter: positional ($1), question-mark (?), or named
//     (:status) — all dynamic, all banned.
const RAW_SQL_PAID_WRITE_RE =
  /\bset\b(?:(?!\b(?:where|when|then|else|select|from|case)\b)[^;`])*?["'`]?\bstatus\b["'`]?\s*\}?\s*=\s*(?:["']paid["']|\$\{|\$\d+\b|:\w+|\?)/gi;

// Match the closing bracket for the opener at text[openIdx] ("(" or "{"),
// ignoring nesting of the same pair. Returns index after the close, or
// text.length if unbalanced.
function matchBracket(text, openIdx) {
  const open = text[openIdx];
  const close = open === "(" ? ")" : "}";
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
}

// Find brace-bodied local function definitions in the window:
// `const x = async (...) => {...}`, `async function x(...) {...}`, etc.
// Returns [{ name, start, end }] where start/end bound the body.
function findLocalFnRanges(text) {
  const ranges = [];
  const defRe =
    /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:function\b[^({]*|\([^)]*\)\s*(?::[^={]+)?=>\s*|\w+\s*=>\s*)|(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*/g;
  let m;
  while ((m = defRe.exec(text)) !== null) {
    const name = m[1] ?? m[2];
    const braceIdx = text.indexOf("{", m.index + m[0].length - 1);
    if (braceIdx === -1) continue;
    // Only treat it as the function body if the brace directly follows the
    // definition header (allowing whitespace).
    const between = text.slice(m.index + m[0].length, braceIdx);
    if (/\S/.test(between)) continue;
    const end = matchBracket(text, braceIdx);
    ranges.push({ name, start: braceIdx, end });
    defRe.lastIndex = braceIdx + 1;
  }
  return ranges;
}

function containingRange(ranges, idx) {
  let best = null;
  for (const r of ranges) {
    if (idx > r.start && idx < r.end) {
      if (!best || r.end - r.start < best.end - best.start) best = r;
    }
  }
  return best;
}

// A call site at index `idx` "counts" only if it is at top level of the
// window, or inside a local wrapper that is itself awaited-invoked at a
// counting position (one level of indirection).
function callSiteCounts(text, ranges, idx) {
  const r = containingRange(ranges, idx);
  if (!r) return true;
  const invokeRe = new RegExp(`await\\s+${r.name}\\s*\\(`, "g");
  let m;
  while ((m = invokeRe.exec(text)) !== null) {
    const outer = containingRange(ranges, m.index);
    if (!outer) return true;
  }
  return false;
}

// Is `dispatcher` genuinely invoked (per the accept-list) within windowText?
function dispatcherSatisfied(windowText, ranges, dispatcher) {
  // 1 + 3: direct awaited call (possibly inside an invoked wrapper).
  const directRe = new RegExp(`await\\s+${dispatcher}\\s*\\(`, "g");
  let m;
  while ((m = directRe.exec(windowText)) !== null) {
    if (callSiteCounts(windowText, ranges, m.index)) return true;
  }
  // 2: awaited Promise.all / allSettled containing a real call (not a bare
  // reference — must be followed by "(").
  const paRe = /await\s+Promise\s*\.\s*(?:all|allSettled)\s*\(/g;
  while ((m = paRe.exec(windowText)) !== null) {
    const openIdx = m.index + m[0].length - 1;
    const end = matchBracket(windowText, openIdx);
    const region = windowText.slice(openIdx, end);
    if (
      new RegExp(`\\b${dispatcher}\\s*\\(`).test(region) &&
      callSiteCounts(windowText, ranges, m.index)
    ) {
      return true;
    }
  }
  return false;
}

// Scan one file's source. Returns { writeSites, problems } where problems
// are human-readable strings referencing `label`.
export function scanSource(raw, label) {
  const problems = [];
  let writeSites = 0;
  // Fast path: nothing paid-related and no SQL SET keyword — skip. (The
  // dynamic raw-SQL evasion `SET status = ${...}` contains no "paid" literal,
  // so the gate must also let SET-bearing sources through.)
  if (!raw.includes("paid") && !/\bset\b/i.test(raw)) {
    return { writeSites, problems };
  }
  const code = stripComments(raw);
  const lines = code.split("\n");

  PAID_WRITE_RE.lastIndex = 0;
  let m;
  while ((m = PAID_WRITE_RE.exec(code)) !== null) {
    const lineNo = code.slice(0, m.index).split("\n").length; // 1-based
    writeSites++;

    // Skip response payloads like res.json({ status: "paid" }) — those
    // report state, they don't transition it. Heuristic: the write must sit
    // inside/near a db update (`.set(` or `update(` on the same or the 3
    // preceding lines) to count as a transition.
    const context = lines.slice(Math.max(0, lineNo - 4), lineNo).join("\n");
    if (!/\.set\s*\(|\bupdate\s*\(|updateData|\bset\s*:\s*\{/.test(context)) {
      writeSites--;
      continue;
    }

    const windowText = lines
      .slice(lineNo - 1, lineNo - 1 + WINDOW_LINES)
      .join("\n");
    const ranges = findLocalFnRanges(windowText);
    const missing = DISPATCHERS.filter(
      (name) => !dispatcherSatisfied(windowText, ranges, name),
    );
    if (missing.length > 0) {
      problems.push(
        `${label}:${lineNo} — invoice transitioned to "paid" ` +
          `without genuinely-invoked call(s) to: ${missing.join(", ")} within ${WINDOW_LINES} lines. ` +
          "Every paid-transition must send the customer receipt AND the owner notification " +
          "(guarded on the transitioned rows, like routes/invoices.ts mark-paid). " +
          "Accepted forms: direct await, awaited Promise.all/allSettled, or a local " +
          "wrapper that is itself awaited within the window.",
      );
    }
  }

  // Raw-SQL paid writes: banned outright (see RAW_SQL_PAID_WRITE_RE).
  RAW_SQL_PAID_WRITE_RE.lastIndex = 0;
  while ((m = RAW_SQL_PAID_WRITE_RE.exec(code)) !== null) {
    const lineNo = code.slice(0, m.index).split("\n").length; // 1-based
    writeSites++;
    problems.push(
      `${label}:${lineNo} — raw-SQL write of invoice status to "paid" detected ` +
        "(e.g. sql`UPDATE ... SET status = 'paid'` or db.execute of an UPDATE string). " +
        "Raw-SQL paid transitions bypass the dispatcher guard and are banned: " +
        'use db.update(invoices).set({ status: "paid", ... }) so the paid-transition ' +
        "guard can verify the payment emails are dispatched.",
    );
    // Avoid re-matching inside the same region.
    RAW_SQL_PAID_WRITE_RE.lastIndex = m.index + m[0].length;
  }

  return { writeSites, problems };
}

function scanDir(root) {
  const problems = [];
  let writeSites = 0;
  for (const file of collectTsFiles(root)) {
    const res = scanSource(readFileSync(file, "utf8"), relative(process.cwd(), file));
    writeSites += res.writeSites;
    problems.push(...res.problems);
  }
  return { writeSites, problems };
}

test("every invoice paid-transition triggers both payment dispatchers", () => {
  const { writeSites, problems } = scanDir(SRC_ROOT);

  // Sanity check: the guard must actually be seeing the known paid-write
  // sites (invoices mark-paid, billing webhook, portal confirm-payment,
  // autopay charge, stuck-invoice sweep). If the write pattern changes,
  // update this test rather than letting it pass on zero matches.
  assert.ok(
    writeSites >= 5,
    `Expected at least 5 invoice paid-write sites in src/, found ${writeSites}. ` +
      "If the update pattern changed, update tests/paid-transition-dispatch.test.mjs.",
  );

  assert.deepEqual(
    problems,
    [],
    "Invoice paid-transitions found that never dispatch the payment emails:\n" +
      problems.join("\n"),
  );
});

// ---------------------------------------------------------------------------
// Mutation-style fixture tests: prove the guard flags known evasions and
// accepts the documented safe indirections. Fixtures are written to a temp
// dir and scanned through the exact same directory-walk + scan path as src/.
// ---------------------------------------------------------------------------

const PAID_UPDATE = [
  "await db",
  "  .update(invoices)",
  '  .set({ status: "paid", paidDate: new Date() })',
  "  .where(eq(invoices.id, id));",
].join("\n");

const BOTH_DISPATCH = [
  "await dispatchPaymentReceiptEmail(invoice);",
  "await dispatchOwnerPaymentNotification(invoice);",
].join("\n");

function scanFixture(name, source) {
  const dir = mkdtempSync(join(tmpdir(), "paid-guard-fixture-"));
  try {
    mkdirSync(join(dir, "routes"), { recursive: true });
    writeFileSync(join(dir, "routes", name), source);
    return scanDir(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("guard fixture: direct awaited dispatch passes (baseline)", () => {
  const res = scanFixture(
    "baseline.ts",
    `export async function markPaid(id: string) {\n${PAID_UPDATE}\n${BOTH_DISPATCH}\n}\n`,
  );
  assert.equal(res.writeSites, 1);
  assert.deepEqual(res.problems, []);
});

test("guard fixture: helper-extraction with no dispatch is flagged", () => {
  // Refactor evasion: paid write moved into a helper that never dispatches;
  // the caller (or nobody) sends the emails. Must be flagged.
  const res = scanFixture(
    "helper.ts",
    [
      "async function setPaidStatus(id: string) {",
      PAID_UPDATE,
      "}",
      "export async function markPaid(id: string) {",
      "  await setPaidStatus(id);",
      "}",
      "",
    ].join("\n"),
  );
  assert.equal(res.writeSites, 1);
  assert.equal(res.problems.length, 1);
  assert.match(res.problems[0], /dispatchPaymentReceiptEmail/);
  assert.match(res.problems[0], /dispatchOwnerPaymentNotification/);
});

test("guard fixture: dispatch spaced beyond the window is flagged", () => {
  const filler = Array.from(
    { length: WINDOW_LINES + 10 },
    (_, i) => `  logger.debug("padding line ${i}");`,
  ).join("\n");
  const res = scanFixture(
    "spacing.ts",
    `export async function markPaid(id: string) {\n${PAID_UPDATE}\n${filler}\n${BOTH_DISPATCH}\n}\n`,
  );
  assert.equal(res.writeSites, 1);
  assert.equal(res.problems.length, 1);
});

test("guard fixture: wrapper defined but never invoked is flagged", () => {
  // The dispatchers appear (awaited!) inside a local function within the
  // window, but nothing ever calls it — no emails actually send.
  const res = scanFixture(
    "wrapper-uninvoked.ts",
    [
      "export async function markPaid(id: string) {",
      PAID_UPDATE,
      "  const sendEmails = async () => {",
      "    await dispatchPaymentReceiptEmail(invoice);",
      "    await dispatchOwnerPaymentNotification(invoice);",
      "  };",
      "}",
      "",
    ].join("\n"),
  );
  assert.equal(res.writeSites, 1);
  assert.equal(res.problems.length, 1);
  assert.match(res.problems[0], /dispatchPaymentReceiptEmail/);
});

test("guard fixture: bare callback reference (not a call) is flagged", () => {
  const res = scanFixture(
    "callback-ref.ts",
    [
      "export async function markPaid(id: string) {",
      PAID_UPDATE,
      "  queue.push(dispatchPaymentReceiptEmail);",
      "  queue.push(dispatchOwnerPaymentNotification);",
      "}",
      "",
    ].join("\n"),
  );
  assert.equal(res.writeSites, 1);
  assert.equal(res.problems.length, 1);
});

test("guard fixture: awaited Promise.all wrapping both dispatchers passes", () => {
  const res = scanFixture(
    "promise-all.ts",
    [
      "export async function markPaid(id: string) {",
      PAID_UPDATE,
      "  await Promise.all([",
      "    dispatchPaymentReceiptEmail(invoice),",
      "    dispatchOwnerPaymentNotification(invoice),",
      "  ]);",
      "}",
      "",
    ].join("\n"),
  );
  assert.equal(res.writeSites, 1);
  assert.deepEqual(res.problems, []);
});

test("guard fixture: local wrapper that IS awaited passes", () => {
  const res = scanFixture(
    "wrapper-invoked.ts",
    [
      "export async function markPaid(id: string) {",
      PAID_UPDATE,
      "  const sendEmails = async () => {",
      "    await dispatchPaymentReceiptEmail(invoice);",
      "    await dispatchOwnerPaymentNotification(invoice);",
      "  };",
      "  await sendEmails();",
      "}",
      "",
    ].join("\n"),
  );
  assert.equal(res.writeSites, 1);
  assert.deepEqual(res.problems, []);
});

test("guard fixture: raw SQL template paid write is flagged even WITH dispatchers", () => {
  // Raw-SQL evasion: drizzle sql template flips status to paid. Banned
  // outright — even if the dispatchers are present, we can't statically tie
  // an opaque SQL string to the guard's window analysis reliably.
  const res = scanFixture(
    "raw-sql-template.ts",
    [
      "export async function markPaid(id: string) {",
      "  await db.execute(",
      "    sql`UPDATE invoices SET status = 'paid', paid_at = now() WHERE id = ${id}`,",
      "  );",
      BOTH_DISPATCH,
      "}",
      "",
    ].join("\n"),
  );
  assert.equal(res.writeSites, 1);
  assert.equal(res.problems.length, 1);
  assert.match(res.problems[0], /raw-SQL/i);
});

test("guard fixture: db.execute with a plain UPDATE string is flagged", () => {
  const res = scanFixture(
    "raw-sql-string.ts",
    [
      "export async function markPaid(id: string) {",
      '  await db.execute("UPDATE invoices SET paid_at = now(), status = \'paid\' WHERE id = $1");',
      "}",
      "",
    ].join("\n"),
  );
  assert.equal(res.writeSites, 1);
  assert.equal(res.problems.length, 1);
  assert.match(res.problems[0], /raw-SQL/i);
});

test("guard fixture: raw SQL with interpolated status value is flagged", () => {
  // Dynamic evasion: SET status = ${someVar} could be 'paid' at runtime; the
  // guard can't prove otherwise, so it's banned too.
  const res = scanFixture(
    "raw-sql-dynamic.ts",
    [
      "export async function setStatus(id: string, status: string) {",
      "  await db.execute(sql`UPDATE invoices SET status = ${status} WHERE id = ${id}`);",
      "}",
      "",
    ].join("\n"),
  );
  assert.equal(res.writeSites, 1);
  assert.equal(res.problems.length, 1);
  assert.match(res.problems[0], /raw-SQL/i);
});

test("guard fixture: drizzle column-ref raw SQL paid write is flagged", () => {
  const res = scanFixture(
    "raw-sql-colref.ts",
    [
      "export async function markPaid(id: string) {",
      "  await db.execute(sql`UPDATE invoices SET ${invoices.status} = 'paid' WHERE ${invoices.id} = ${id}`);",
      "}",
      "",
    ].join("\n"),
  );
  assert.equal(res.writeSites, 1);
  assert.equal(res.problems.length, 1);
  assert.match(res.problems[0], /raw-SQL/i);
});

test("guard fixture: parameterized $1 bind paid write is flagged", () => {
  // Positional bind: the value arrives at runtime and could be 'paid'.
  const res = scanFixture(
    "raw-sql-positional.ts",
    [
      "export async function setStatus(id: string, status: string) {",
      '  await db.execute("UPDATE invoices SET status = $1 WHERE id = $2", [status, id]);',
      "}",
      "",
    ].join("\n"),
  );
  assert.equal(res.writeSites, 1);
  assert.equal(res.problems.length, 1);
  assert.match(res.problems[0], /raw-SQL/i);
});

test("guard fixture: question-mark bind paid write is flagged", () => {
  const res = scanFixture(
    "raw-sql-qmark.ts",
    [
      "export async function setStatus(id: string, status: string) {",
      '  await db.execute("UPDATE invoices SET status = ? WHERE id = ?", [status, id]);',
      "}",
      "",
    ].join("\n"),
  );
  assert.equal(res.writeSites, 1);
  assert.equal(res.problems.length, 1);
  assert.match(res.problems[0], /raw-SQL/i);
});

test("guard fixture: named bind paid write is flagged", () => {
  const res = scanFixture(
    "raw-sql-named.ts",
    [
      "export async function setStatus(id: string, status: string) {",
      '  await db.execute("UPDATE invoices SET status = :status WHERE id = :id", { status, id });',
      "}",
      "",
    ].join("\n"),
  );
  assert.equal(res.writeSites, 1);
  assert.equal(res.problems.length, 1);
  assert.match(res.problems[0], /raw-SQL/i);
});

test("guard fixture: quoted-identifier paid write is flagged", () => {
  const res = scanFixture(
    "raw-sql-quoted-ident.ts",
    [
      "export async function markPaid(id: string) {",
      "  await db.execute(`UPDATE invoices SET \"status\" = 'paid' WHERE id = $1`);",
      "}",
      "",
    ].join("\n"),
  );
  assert.equal(res.writeSites, 1);
  assert.equal(res.problems.length, 1);
  assert.match(res.problems[0], /raw-SQL/i);
});

test("guard fixture: read-only SQL comparisons are not flagged", () => {
  // CASE WHEN / WHERE comparisons on status='paid' are reads, not writes.
  const res = scanFixture(
    "raw-sql-reads.ts",
    [
      "export async function stats(companyId: string) {",
      "  const rows = await db",
      "    .select({",
      "      paid: sql<number>`sum(case when status='paid' then 1 else 0 end)`,",
      "      effective: sql`(case when ${invoicesTable.status} = 'paid' then coalesce(paid_at, created_at) else created_at end)`,",
      "    })",
      "    .from(invoicesTable)",
      "    .where(sql`status = 'paid'`);",
      "  return rows;",
      "}",
      "",
    ].join("\n"),
  );
  assert.equal(res.writeSites, 0);
  assert.deepEqual(res.problems, []);
});

test("guard fixture: response payloads are not treated as transitions", () => {
  const res = scanFixture(
    "payload.ts",
    [
      "export async function getInvoice(id: string) {",
      '  res.json({ id, status: "paid" });',
      "}",
      "",
    ].join("\n"),
  );
  assert.equal(res.writeSites, 0);
  assert.deepEqual(res.problems, []);
});
