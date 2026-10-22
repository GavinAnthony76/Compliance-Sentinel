#!/usr/bin/env node
/**
 * Self-test for the mock-surface preflight (tests/mock-surface-check.mjs).
 *
 * The preflight protects every module-mock suite from opaque import-time
 * SyntaxErrors, so it must keep (1) passing a complete mock silently and
 * (2) failing an incomplete one with an actionable message naming the missing
 * export and the production file that imports it. Each case runs in a child
 * process because the preflight calls process.exit(1) on failure.
 *
 * Exit code 0 = all checks passed, 1 = at least one check failed.
 */

import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const CHECK_URL = pathToFileURL(`${TESTS_DIR}/mock-surface-check.mjs`).href;

function runPreflight(call) {
  const script = `const m = await import(${JSON.stringify(CHECK_URL)}); ${call}; console.log("PREFLIGHT_OK");`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: TESTS_DIR, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
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

console.log("Mock-surface preflight self-test\n");

// platform-settings.ts imports exactly { db, platformSettingsTable,
// DEFAULT_STALE_ADMIN_DAYS } from @workspace/db.
const ENTRY = '["../src/lib/platform-settings.ts"]';
{
  const r = runPreflight(
    `m.assertSuiteMocksCover({ testFile: import.meta.url, entryFiles: ${ENTRY}, packageMocks: { "@workspace/db": { db: {}, platformSettingsTable: {}, DEFAULT_STALE_ADMIN_DAYS: 90 } } })`,
  );
  check("a complete mock passes silently", r.status === 0 && r.out.includes("PREFLIGHT_OK"), r.out.trim());
}
{
  const r = runPreflight(
    `m.assertSuiteMocksCover({ testFile: import.meta.url, entryFiles: ${ENTRY}, packageMocks: { "@workspace/db": { db: {}, DEFAULT_STALE_ADMIN_DAYS: 90 } } })`,
  );
  check("a mock missing an export exits non-zero before the suite runs", r.status === 1 && !r.out.includes("PREFLIGHT_OK"), `exit ${r.status}`);
  check("the failure says the mock is out of date", r.out.includes("MOCK OUT OF DATE"), r.out.trim());
  check("the failure names the missing export", /-\s+platformSettingsTable\b/.test(r.out), r.out.trim());
  check("the failure names the importing production file", /platform-settings\.ts/.test(r.out), r.out.trim());
}
{
  const r = runPreflight(
    `m.assertSuiteMocksCover({ testFile: import.meta.url, entryFiles: ["../src/routes/customer-portal.ts"], relativeMocks: { "../src/lib/objectStorage.ts": {} } })`,
  );
  check("a relative-module mock missing an export is also caught", r.status === 1 && /ObjectStorageService/.test(r.out), r.out.trim());
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
