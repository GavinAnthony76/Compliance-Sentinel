#!/usr/bin/env node
/**
 * Preflight guard for module-mock test suites (--experimental-test-module-mocks).
 *
 * Suites like billing-status-email.test.mjs and payment-receipt-email.test.mjs
 * replace `@workspace/db` / `drizzle-orm` with mock.module(...) named exports.
 * When production code later adds a NEW named import from a mocked module, the
 * suite crashes at import time with an opaque
 *   SyntaxError: The requested module '@workspace/db' does not provide an
 *   export named 'X'
 * long before any test runs. This helper turns that crash into an actionable
 * failure: BEFORE importing production code, call assertMockCovers(...) with
 * the names your mock provides. It statically walks the production import
 * graph (the same extensionless-.ts resolution ts-resolve.loader.mjs uses),
 * collects every runtime named import from the target package, and — if the
 * mock is missing any — prints exactly which names to add and exits 1.
 *
 * Type-only imports (`import type {...}` and inline `type X` specifiers) are
 * ignored: the TS transpile step erases them, so they never need a runtime
 * export. Relative modules the suite itself mocks are not traversed (their
 * real imports are irrelevant — the mock intercepts them).
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));

/** Resolve an extensionless relative specifier the way ts-resolve.loader.mjs does. */
function resolveRelative(fromFile, specifier) {
  const base = pathResolve(dirname(fromFile), specifier);
  const candidates = /\.[cm]?[jt]s$/.test(specifier)
    ? [base]
    : [base + ".ts", pathResolve(base, "index.ts")];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

// Strip comments and string/template literals so import regexes can't match
// inside them. Keeps offsets simple by replacing with spaces of any length.
function stripNoise(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/`(?:\\.|[^\\`])*`/g, '""');
}

const IMPORT_RE =
  /import\s+(type\s+)?(?:([\w$]+)\s*,\s*)?(?:\{([^}]*)\}|\*\s+as\s+[\w$]+|[\w$]+)?\s*from\s*["']([^"']+)["']/g;
const BARE_IMPORT_RE = /import\s*["']([^"']+)["']/g;
const EXPORT_FROM_RE = /export\s+(type\s+)?(?:\{([^}]*)\}|\*)\s*from\s*["']([^"']+)["']/g;
// Dynamic imports:
//   const { a, b } = await import("../lib/stripe");   -> named runtime imports
//   (await import("../lib/x")).default                -> traversal only
const DYNAMIC_DESTRUCTURE_RE =
  /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*await\s+import\(\s*["']([^"']+)["']\s*\)/g;
const DYNAMIC_IMPORT_RE = /import\(\s*["']([^"']+)["']\s*\)/g;

/**
 * Walk the runtime import graph starting from entryFiles and collect every
 * named import from `packageName`.
 *
 * @param {object} opts
 * @param {string[]} opts.entryFiles   absolute paths of production entry modules
 * @param {string}   [opts.packageName]  e.g. "@workspace/db" or "drizzle-orm"
 * @param {string}   [opts.targetFile]  absolute path of a mocked RELATIVE module;
 *   imports are matched by resolved file path instead of bare specifier
 * @param {string[]} [opts.skipModules] absolute paths of relative modules the
 *   suite mocks (not traversed)
 * @returns {{ names: Set<string>, importers: Map<string, string[]> }}
 *   names: all runtime named imports from the target;
 *   importers: name -> list of files that import it
 */
export function collectNamedImports({ entryFiles, packageName, targetFile, skipModules = [] }) {
  const skip = new Set(skipModules);
  const visited = new Set();
  const queue = [...entryFiles];
  const names = new Set();
  const importers = new Map();

  const record = (name, file) => {
    names.add(name);
    if (!importers.has(name)) importers.set(name, []);
    importers.get(name).push(file);
  };

  while (queue.length > 0) {
    const file = queue.pop();
    if (visited.has(file) || skip.has(file)) continue;
    visited.add(file);

    let source;
    try {
      source = stripNoise(readFileSync(file, "utf8"));
    } catch {
      continue;
    }

    const handleSpecifier = (spec) => {
      if (spec.startsWith("./") || spec.startsWith("../")) {
        const resolved = resolveRelative(file, spec);
        if (resolved && !visited.has(resolved) && !skip.has(resolved)) queue.push(resolved);
      }
    };

    const isTarget = (spec) => {
      if (packageName !== undefined) return spec === packageName;
      if (targetFile !== undefined && (spec.startsWith("./") || spec.startsWith("../"))) {
        return resolveRelative(file, spec) === targetFile;
      }
      return false;
    };

    for (const m of source.matchAll(IMPORT_RE)) {
      const [, typeOnly, defaultName, namedBlock, spec] = m;
      if (isTarget(spec) && !typeOnly) {
        if (defaultName) record("default", file);
        if (namedBlock) {
          for (const raw of namedBlock.split(",")) {
            const entry = raw.trim();
            if (!entry || entry.startsWith("type ")) continue;
            const name = entry.split(/\s+as\s+/)[0].trim();
            if (name) record(name, file);
          }
        }
      }
      handleSpecifier(spec);
    }
    for (const m of source.matchAll(EXPORT_FROM_RE)) {
      const [, typeOnly, namedBlock, spec] = m;
      if (isTarget(spec) && !typeOnly && namedBlock) {
        for (const raw of namedBlock.split(",")) {
          const entry = raw.trim();
          if (!entry || entry.startsWith("type ")) continue;
          const name = entry.split(/\s+as\s+/)[0].trim();
          if (name) record(name, file);
        }
      }
      handleSpecifier(spec);
    }
    for (const m of source.matchAll(DYNAMIC_DESTRUCTURE_RE)) {
      const [, namedBlock, spec] = m;
      if (isTarget(spec) && namedBlock) {
        for (const raw of namedBlock.split(",")) {
          const entry = raw.trim();
          if (!entry) continue;
          // `{ a: localName }` destructuring renames — the export is `a`.
          const name = entry.split(":")[0].trim();
          if (name && !name.startsWith("...")) record(name, file);
        }
      }
      handleSpecifier(spec);
    }
    for (const m of source.matchAll(BARE_IMPORT_RE)) {
      handleSpecifier(m[1]);
    }
    for (const m of source.matchAll(DYNAMIC_IMPORT_RE)) {
      handleSpecifier(m[1]);
    }
  }

  return { names, importers };
}

/**
 * Assert that a mock's provided export names cover every runtime named import
 * of `packageName` reachable from `entryFiles`. On a gap, prints an actionable
 * "add X to the mock" message and exits 1 — instead of the opaque SyntaxError
 * node throws mid-import.
 *
 * @param {object} opts
 * @param {string} opts.testFile     import.meta.url of the calling test (for the message)
 * @param {string} opts.packageName
 * @param {Iterable<string>} opts.providedNames names the mock.module call exports
 * @param {string[]} opts.entryFiles paths relative to tests/ (e.g. "../src/routes/invoices.ts")
 * @param {string[]} [opts.skipModules] relative-to-tests/ paths of modules the suite mocks
 */
export function assertMockCovers({ testFile, packageName, providedNames, entryFiles, skipModules = [] }) {
  const abs = (p) => pathResolve(TESTS_DIR, p);
  const { names, importers } = collectNamedImports({
    entryFiles: entryFiles.map(abs),
    packageName,
    skipModules: skipModules.map(abs),
  });

  const provided = new Set(providedNames);
  const missing = [...names].filter((n) => !provided.has(n)).sort();
  if (missing.length === 0) return;

  const testName = testFile ? fileURLToPath(testFile).split("/").pop() : "this test";
  console.error(
    `\nMOCK OUT OF DATE: the "${packageName}" mock in ${testName} is missing ` +
      `named export(s) production code now imports:\n`,
  );
  for (const name of missing) {
    const files = [...new Set(importers.get(name) || [])].map((f) =>
      f.replace(TESTS_DIR.replace(/\/tests$/, "") + "/", ""),
    );
    console.error(`  - ${name}  (imported by ${files.join(", ")})`);
  }
  console.error(
    `\nFix: add the name(s) above to the mock.module("${packageName}", { namedExports: {...} }) ` +
      `call in ${testName}. Without this, the suite would crash at import time with ` +
      `"SyntaxError: The requested module '${packageName}' does not provide an export named '...'".\n`,
  );
  process.exit(1);
}

/**
 * Same guarantee as assertMockCovers, but for RELATIVE modules the suite mocks
 * (e.g. "../src/lib/stripe.ts"). Imports are matched by resolved file path, so
 * "../lib/stripe" from a route and "./stripe" from a sibling both count.
 *
 * @param {object} opts
 * @param {string} opts.testFile      import.meta.url of the calling test
 * @param {string} opts.modulePath    the mocked module, relative to tests/ (as passed to mock.module)
 * @param {Iterable<string>} opts.providedNames names the mock.module call exports
 * @param {string[]} opts.entryFiles  paths relative to tests/
 * @param {string[]} [opts.skipModules] relative-to-tests/ paths of ALL mocked modules
 */
export function assertRelativeMockCovers({ testFile, modulePath, providedNames, entryFiles, skipModules = [] }) {
  const abs = (p) => pathResolve(TESTS_DIR, p);
  // Accept extensionless specifiers the same way import matching does.
  const targetFile =
    resolveRelative(pathResolve(TESTS_DIR, "x.mjs"), modulePath) ?? abs(modulePath);
  if (!existsSync(targetFile)) {
    console.error(
      `\nMOCK TARGET MISSING: ${modulePath} (mocked in ${testFile ? fileURLToPath(testFile).split("/").pop() : "this test"}) ` +
        `does not exist — the mock.module path is stale.\n`,
    );
    process.exit(1);
  }
  const { names, importers } = collectNamedImports({
    entryFiles: entryFiles.map(abs),
    targetFile,
    skipModules: skipModules.map(abs),
  });

  const provided = new Set(providedNames);
  const missing = [...names].filter((n) => !provided.has(n)).sort();
  if (missing.length === 0) return;

  const testName = testFile ? fileURLToPath(testFile).split("/").pop() : "this test";
  console.error(
    `\nMOCK OUT OF DATE: the "${modulePath}" mock in ${testName} is missing ` +
      `named export(s) production code now imports:\n`,
  );
  for (const name of missing) {
    const files = [...new Set(importers.get(name) || [])].map((f) =>
      f.replace(TESTS_DIR.replace(/\/tests$/, "") + "/", ""),
    );
    console.error(`  - ${name}  (imported by ${files.join(", ")})`);
  }
  console.error(
    `\nFix: add the name(s) above to the mock.module("${modulePath}", { namedExports: {...} }) ` +
      `call in ${testName}. Without this, the suite would crash at import time with ` +
      `"SyntaxError: The requested module ... does not provide an export named '...'".\n`,
  );
  process.exit(1);
}
