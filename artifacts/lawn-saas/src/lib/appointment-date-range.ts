/**
 * Convert the appointments page's From/To date inputs (local calendar days,
 * `YYYY-MM-DD`) into UTC instants for the API's startDate/endDate params.
 *
 * Both boundaries use the same local-time convention as appointment creation
 * (datetime-local → UTC): From is local start-of-day, To is local end-of-day
 * (inclusive, since the API filters `lte` on scheduled_start).
 */
export type DateRangePreset = 'today' | 'week' | 'month';

/** Format a Date as a local `YYYY-MM-DD` calendar day (the date input's value format). */
function toLocalDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Local calendar-day bounds for a quick-filter preset, in the same
 * `YYYY-MM-DD` form as the From/To inputs (so they flow through
 * toDateRangeParams exactly like a manual pick, and the CSV export matches).
 * Weeks run Monday–Sunday, the same convention as the calendar's week view.
 */
export function presetDateRange(preset: DateRangePreset, now: Date = new Date()): { startDate: string; endDate: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  if (preset === 'today') {
    const day = toLocalDay(now);
    return { startDate: day, endDate: day };
  }
  if (preset === 'week') {
    const sinceMonday = (now.getDay() + 6) % 7;
    return {
      startDate: toLocalDay(new Date(y, m, d - sinceMonday)),
      endDate: toLocalDay(new Date(y, m, d - sinceMonday + 6)),
    };
  }
  return { startDate: toLocalDay(new Date(y, m, 1)), endDate: toLocalDay(new Date(y, m + 1, 0)) };
}

/** The preset whose range exactly matches the current From/To inputs, if any. */
export function activeDatePreset(startDate: string, endDate: string, now: Date = new Date()): DateRangePreset | null {
  for (const preset of ['today', 'week', 'month'] as const) {
    const r = presetDateRange(preset, now);
    if (r.startDate === startDate && r.endDate === endDate) return preset;
  }
  return null;
}

export function toDateRangeParams(startDate: string, endDate: string): {
  startDate?: string;
  endDate?: string;
} {
  return {
    startDate: startDate ? new Date(`${startDate}T00:00:00.000`).toISOString() : undefined,
    endDate: endDate ? new Date(`${endDate}T23:59:59.999`).toISOString() : undefined,
  };
}
