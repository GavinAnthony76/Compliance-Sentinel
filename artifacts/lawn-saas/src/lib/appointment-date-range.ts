/**
 * Convert the appointments page's From/To date inputs (local calendar days,
 * `YYYY-MM-DD`) into UTC instants for the API's startDate/endDate params.
 *
 * Both boundaries use the same local-time convention as appointment creation
 * (datetime-local → UTC): From is local start-of-day, To is local end-of-day
 * (inclusive, since the API filters `lte` on scheduled_start).
 */
export function toDateRangeParams(startDate: string, endDate: string): {
  startDate?: string;
  endDate?: string;
} {
  return {
    startDate: startDate ? new Date(`${startDate}T00:00:00.000`).toISOString() : undefined,
    endDate: endDate ? new Date(`${endDate}T23:59:59.999`).toISOString() : undefined,
  };
}
