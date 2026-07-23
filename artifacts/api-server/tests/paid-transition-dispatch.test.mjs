import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Static guard: every code path that transitions an invoice to "paid" must
// trigger BOTH payment email dispatchers (receipt to the customer + owner
// notification). The awaited-dispatch guard catches un-awaited calls, but a
// future endpoint that flips status -> paid and simply never CALLS the
// dispatchers would ship silently with no emails. This test finds every
// `status: "paid"` write in api-server source and requires awaited calls to
// both dispatchers within the lines that follow it.

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

test("every invoice paid-transition triggers both payment dispatchers", () => {
  const files = collectTsFiles(SRC_ROOT);
  const problems = [];
  let writeSites = 0;

  for (const file of files) {
    const raw = readFileSync(file, "utf8");
    if (!raw.includes("paid")) continue;
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
      const missing = DISPATCHERS.filter(
        (name) => !new RegExp(`await\\s+${name}\\s*\\(`).test(windowText),
      );
      if (missing.length > 0) {
        problems.push(
          `${relative(process.cwd(), file)}:${lineNo} — invoice transitioned to "paid" ` +
            `without awaited call(s) to: ${missing.join(", ")} within ${WINDOW_LINES} lines. ` +
            "Every paid-transition must send the customer receipt AND the owner notification " +
            "(guarded on the transitioned rows, like routes/invoices.ts mark-paid).",
        );
      }
    }
  }

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
