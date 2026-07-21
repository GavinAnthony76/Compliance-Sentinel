import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Static guard: every CALL to dispatchPaymentReceiptEmail /
// dispatchOwnerPaymentNotification in api-server source must be awaited.
// On Autoscale, fire-and-forget sends started after res.json() get
// CPU-throttled away and silently never deliver. A future edit that drops
// an `await` must fail CI here.

const DISPATCHERS = [
  "dispatchPaymentReceiptEmail",
  "dispatchOwnerPaymentNotification",
];

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

function stripCommentsAndStrings(source) {
  // Replace comment/string contents with spaces (preserving newlines) so
  // line numbers stay accurate and mentions inside comments don't count.
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
      const quote = c;
      out += " ";
      i++;
      while (i < n && source[i] !== quote) {
        if (source[i] === "\\") {
          out += " ";
          out += source[i + 1] === "\n" ? "\n" : " ";
          i += 2;
          continue;
        }
        out += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += " ";
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function findViolations(filePath) {
  const raw = readFileSync(filePath, "utf8");
  const code = stripCommentsAndStrings(raw);
  const violations = [];

  for (const name of DISPATCHERS) {
    const re = new RegExp(`\\b${name}\\b`, "g");
    let m;
    while ((m = re.exec(code)) !== null) {
      const idx = m.index;
      const after = code.slice(idx + name.length);
      // Only calls matter: identifier immediately followed by "(".
      // Skips imports, destructuring, exports, type refs, bare mentions.
      if (!/^\s*\(/.test(after)) continue;
      const before = code.slice(0, idx);
      // Function declaration is not a call site.
      if (/function\s+$/.test(before)) continue;
      // Must be directly awaited: `await name(...)` (covers `return await`,
      // `= await`, `await Promise.all` is NOT accepted for direct calls —
      // but a direct `await name(` prefix is the required form).
      if (!/await\s+$/.test(before)) {
        const line = before.split("\n").length;
        violations.push({ name, line });
      }
    }
  }
  return violations;
}

test("all payment dispatcher calls are awaited (no fire-and-forget)", () => {
  const files = collectTsFiles(SRC_ROOT);
  const problems = [];
  let callSites = 0;

  for (const file of files) {
    const raw = readFileSync(file, "utf8");
    if (!DISPATCHERS.some((d) => raw.includes(d))) continue;
    const code = stripCommentsAndStrings(raw);
    for (const name of DISPATCHERS) {
      const re = new RegExp(`\\b${name}\\s*\\(`, "g");
      let m;
      while ((m = re.exec(code)) !== null) {
        if (/function\s+$/.test(code.slice(0, m.index))) continue;
        callSites++;
      }
    }
    for (const v of findViolations(file)) {
      problems.push(`${relative(process.cwd(), file)}:${v.line} — ${v.name}(...) is not awaited`);
    }
  }

  // Sanity check: the guard must actually be seeing the known call sites.
  // If dispatchers are renamed/removed, this test must be updated, not
  // silently pass on zero matches.
  assert.ok(
    callSites >= 5,
    `Expected at least 5 dispatcher call sites in src/, found ${callSites}. ` +
      "If the dispatchers were renamed, update tests/awaited-dispatch.test.mjs.",
  );

  assert.deepEqual(
    problems,
    [],
    "Un-awaited payment dispatcher calls found (fire-and-forget emails are " +
      "dropped on Autoscale after the response is sent):\n" +
      problems.join("\n"),
  );
});
