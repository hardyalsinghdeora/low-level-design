import { BillingInterval, MONTHS_PER_INTERVAL } from './plan';

export const DAY_MS = 86_400_000;

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * Adds calendar months to the ORIGINAL anchor, clamping to the end of short months:
 * 31 Jan + 1 = 28 Feb (29 in a leap year), 31 Jan + 2 = 31 Mar. Always computing from
 * the anchor, never from the previous boundary, stops the day drifting to the 28th.
 * Everything is UTC so day counts never meet a DST change.
 */
export function addMonthsAnchored(anchor: Date, months: number): Date {
  const total = anchor.getUTCFullYear() * 12 + anchor.getUTCMonth() + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  const day = Math.min(anchor.getUTCDate(), daysInMonth(year, month));
  return new Date(
    Date.UTC(year, month, day, anchor.getUTCHours(), anchor.getUTCMinutes(), anchor.getUTCSeconds(), anchor.getUTCMilliseconds()),
  );
}

/** Start of period `index` (0-based) for a subscription anchored at `anchor`. */
export function periodBoundary(anchor: Date, interval: BillingInterval, index: number): Date {
  return addMonthsAnchored(anchor, index * MONTHS_PER_INTERVAL[interval]);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Whole days elapsed; a partly used day counts as not yet elapsed. */
export function wholeDaysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
