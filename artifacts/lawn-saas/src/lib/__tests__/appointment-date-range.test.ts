import { describe, it, expect } from 'vitest';
import { toDateRangeParams, presetDateRange, activeDatePreset } from '../appointment-date-range';

describe('presetDateRange', () => {
  // Wednesday 2026-03-11, mid-afternoon local time.
  const wed = new Date(2026, 2, 11, 15, 30);

  it('Today covers just the current local day', () => {
    expect(presetDateRange('today', wed)).toEqual({ startDate: '2026-03-11', endDate: '2026-03-11' });
  });

  it('This week runs Monday through Sunday (calendar week-view convention)', () => {
    expect(presetDateRange('week', wed)).toEqual({ startDate: '2026-03-09', endDate: '2026-03-15' });
    // Sunday belongs to the week that started the previous Monday.
    expect(presetDateRange('week', new Date(2026, 2, 15, 23, 59))).toEqual({ startDate: '2026-03-09', endDate: '2026-03-15' });
    // Monday starts a new week.
    expect(presetDateRange('week', new Date(2026, 2, 16, 0, 0))).toEqual({ startDate: '2026-03-16', endDate: '2026-03-22' });
  });

  it('This week crosses month and year boundaries correctly', () => {
    expect(presetDateRange('week', new Date(2026, 0, 1, 9))).toEqual({ startDate: '2025-12-29', endDate: '2026-01-04' });
  });

  it('This month covers the first through the last local day', () => {
    expect(presetDateRange('month', wed)).toEqual({ startDate: '2026-03-01', endDate: '2026-03-31' });
    expect(presetDateRange('month', new Date(2028, 1, 10))).toEqual({ startDate: '2028-02-01', endDate: '2028-02-29' });
  });

  it('feeds toDateRangeParams exactly like a manual pick (export parity)', () => {
    const { startDate, endDate } = presetDateRange('today', wed);
    expect(toDateRangeParams(startDate, endDate)).toEqual({
      startDate: new Date(2026, 2, 11, 0, 0, 0, 0).toISOString(),
      endDate: new Date(2026, 2, 11, 23, 59, 59, 999).toISOString(),
    });
  });
});

describe('activeDatePreset', () => {
  const wed = new Date(2026, 2, 11, 15, 30);

  it('highlights the preset whose range matches the inputs', () => {
    expect(activeDatePreset('2026-03-11', '2026-03-11', wed)).toBe('today');
    expect(activeDatePreset('2026-03-09', '2026-03-15', wed)).toBe('week');
    expect(activeDatePreset('2026-03-01', '2026-03-31', wed)).toBe('month');
  });

  it('clears the highlight after a manual edit or when cleared', () => {
    expect(activeDatePreset('2026-03-09', '2026-03-14', wed)).toBeNull();
    expect(activeDatePreset('', '', wed)).toBeNull();
  });
});

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
