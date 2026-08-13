import { describe, it, expect } from 'vitest';
import { toDateRangeParams } from '../appointment-date-range';

describe('toDateRangeParams', () => {
  it('returns undefined for empty inputs', () => {
    expect(toDateRangeParams('', '')).toEqual({ startDate: undefined, endDate: undefined });
  });

  it('uses the same local-time convention for both boundaries', () => {
    const { startDate, endDate } = toDateRangeParams('2026-01-01', '2026-01-01');
    // Both boundaries must be interpreted in the SAME (local) time zone, so a
    // single selected day covers exactly that local calendar day regardless of
    // the browser's UTC offset — matching how datetime-local entry converts.
    expect(startDate).toBe(new Date(2026, 0, 1, 0, 0, 0, 0).toISOString());
    expect(endDate).toBe(new Date(2026, 0, 1, 23, 59, 59, 999).toISOString());
  });

  it('makes the To day inclusive (end-of-day, not midnight)', () => {
    const { startDate, endDate } = toDateRangeParams('2026-03-10', '2026-03-10');
    const spanMs = new Date(endDate!).getTime() - new Date(startDate!).getTime();
    expect(spanMs).toBe(24 * 60 * 60 * 1000 - 1);
    // An appointment at local 5 PM on the To day falls inside the range.
    const fivePmLocal = new Date(2026, 2, 10, 17, 0, 0);
    expect(fivePmLocal.getTime()).toBeGreaterThanOrEqual(new Date(startDate!).getTime());
    expect(fivePmLocal.getTime()).toBeLessThanOrEqual(new Date(endDate!).getTime());
  });
});
