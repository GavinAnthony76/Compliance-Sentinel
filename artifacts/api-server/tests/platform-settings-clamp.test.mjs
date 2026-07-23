#!/usr/bin/env node
/**
 * Unit test for the defense-in-depth clamp in updatePlatformSettings()
 * (src/lib/platform-settings.ts).
 *
 * The PUT /admin/settings zod schema is the FIRST line of defense against an
 * out-of-range lockout threshold (covered over HTTP by
 * tests/admin-settings-threshold.e2e.mjs). This suite pins the SECOND layer:
 * even if a future caller bypasses the route validation, updatePlatformSettings
 * must clamp staleAdminDays into [MIN_STALE_ADMIN_DAYS, MAX_STALE_ADMIN_DAYS]
 * (1..3650) before persisting — a stored 0 would lock every admin out
 * instantly on the next sweep.
 *
 * @workspace/db is mocked (thenable query-builder stub following the
 * admin-sweep-toggle.test.mjs pattern) so we can capture exactly what value
 * the function writes to the settings row.
 *
 * Run: node --experimental-test-module-mocks tests/platform-settings-clamp.test.mjs
 * Exit code 0 = all checks passed, 1 = at least one check failed.
 */

import { register } from "node:module";
import { mock } from "node:test";

// Resolve api-server's extensionless relative .ts imports the way esbuild does.
register("./ts-resolve.loader.mjs", import.meta.url);

// ---------------------------------------------------------------------------
// Mock @workspace/db: capture the `set` payload of updates to platform_settings.
// ---------------------------------------------------------------------------
function tableProxy(name) {
  return new Proxy(
    { __table: name },
    {
      get(target, prop) {
        if (prop === "__table") return name;
        if (typeof prop !== "string" || prop === "then") return undefined;
        return `${name}.${prop}`;
      },
    },
  );
}

const platformSettingsTable = tableProxy("platform_settings");

// The existing settings row returned by selects.
let settingsRow = { id: 1, staleAdminDays: 90, staleAdminSweepEnabled: true };
// Every `set` payload written by db.update(platform_settings).
const settingsUpdates = [];

function chain(resolveRows) {
  const c = {};
  const passthrough = [
    "from", "where", "limit", "values", "returning",
    "onConflictDoNothing", "orderBy", "leftJoin", "innerJoin", "groupBy",
  ];
  for (const m of passthrough) c[m] = () => c;
  c.set = () => c;
  c.then = (onFulfilled, onRejected) =>
    Promise.resolve().then(resolveRows).then(onFulfilled, onRejected);
  return c;
}

const dbMock = {
  select: () => chain(() => [settingsRow]),
  update: (t) => {
    const c = chain(() => {
      const last = settingsUpdates[settingsUpdates.length - 1] || {};
      return [{ ...settingsRow, ...last }];
    });
    c.set = (vals) => {
      if (t.__table === "platform_settings") settingsUpdates.push(vals);
      return c;
    };
    return c;
  },
  insert: () => chain(() => []),
};

mock.module("@workspace/db", {
  namedExports: {
    db: dbMock,
    platformSettingsTable,
    DEFAULT_STALE_ADMIN_DAYS: 90,
  },
});

const { updatePlatformSettings, MIN_STALE_ADMIN_DAYS, MAX_STALE_ADMIN_DAYS } =
  await import("../src/lib/platform-settings.ts");

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

async function writtenDays(input) {
  settingsUpdates.length = 0;
  const updated = await updatePlatformSettings({ staleAdminDays: input });
  const set = settingsUpdates[settingsUpdates.length - 1] || {};
  return { stored: set.staleAdminDays, returned: updated.staleAdminDays };
}

console.log("updatePlatformSettings() clamp (defense-in-depth):\n");

check("MIN_STALE_ADMIN_DAYS is 1", MIN_STALE_ADMIN_DAYS === 1, `got ${MIN_STALE_ADMIN_DAYS}`);
check("MAX_STALE_ADMIN_DAYS is 3650", MAX_STALE_ADMIN_DAYS === 3650, `got ${MAX_STALE_ADMIN_DAYS}`);

{
  const { stored } = await writtenDays(0);
  check("staleAdminDays: 0 is clamped up to the 1-day floor (never stored as 0)", stored === 1, `stored ${stored}`);
}
{
  const { stored } = await writtenDays(-50);
  check("negative staleAdminDays is clamped up to 1", stored === 1, `stored ${stored}`);
}
{
  const { stored } = await writtenDays(999999);
  check("staleAdminDays above the ceiling is clamped down to 3650", stored === 3650, `stored ${stored}`);
}
{
  const { stored } = await writtenDays(45.7);
  check("fractional staleAdminDays is rounded to an integer", stored === 46, `stored ${stored}`);
}
{
  const { stored } = await writtenDays(180);
  check("in-range staleAdminDays (180) is stored unchanged", stored === 180, `stored ${stored}`);
}
{
  const { stored } = await writtenDays(1);
  check("boundary value 1 is stored unchanged", stored === 1, `stored ${stored}`);
}
{
  const { stored } = await writtenDays(3650);
  check("boundary value 3650 is stored unchanged", stored === 3650, `stored ${stored}`);
}
{
  // Omitting the field must not touch the stored threshold at all.
  settingsUpdates.length = 0;
  await updatePlatformSettings({ staleAdminSweepEnabled: false });
  const set = settingsUpdates[settingsUpdates.length - 1] || {};
  check(
    "omitting staleAdminDays leaves the threshold column out of the update",
    !("staleAdminDays" in set),
    `set=${JSON.stringify(set)}`,
  );
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
