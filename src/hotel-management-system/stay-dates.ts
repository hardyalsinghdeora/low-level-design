import { InvalidDateRangeError } from './errors';

const DAY_MS = 86_400_000;

/** Converts YYYY-MM-DD to whole days since the epoch (UTC). The hotel works in calendar days, not instants. */
export function toDayNumber(isoDate: string): number {
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(isoDate) ? Date.parse(`${isoDate}T00:00:00Z`) : Number.NaN;
  if (Number.isNaN(ms)) throw new InvalidDateRangeError(`"${isoDate}" is not a YYYY-MM-DD date`);
  return ms / DAY_MS;
}

export function dayNumberOf(instant: Date): number {
  return Math.floor(instant.getTime() / DAY_MS);
}

export function dayToIso(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** Friday and Saturday nights are the weekend nights hotels usually surcharge. */
export function isWeekendNight(day: number): boolean {
  const weekday = new Date(day * DAY_MS).getUTCDay();
  return weekday === 5 || weekday === 6;
}

/**
 * A stay as the half-open interval [checkIn, checkOut). Half-open is what makes
 * back-to-back bookings work: the check-out day is free for the next guest.
 */
export class StayDates {
  readonly startDay: number;
  readonly endDay: number;

  constructor(
    readonly checkIn: string,
    readonly checkOut: string,
  ) {
    this.startDay = toDayNumber(checkIn);
    this.endDay = toDayNumber(checkOut);
    if (this.endDay <= this.startDay) {
      throw new InvalidDateRangeError(`Check-out ${checkOut} must be after check-in ${checkIn}`);
    }
  }

  get nights(): number {
    return this.endDay - this.startDay;
  }

  overlaps(other: StayDates): boolean {
    return this.startDay < other.endDay && other.startDay < this.endDay;
  }

  /** Day numbers of each night slept, i.e. every day except the check-out day. */
  nightDays(): number[] {
    return Array.from({ length: this.nights }, (_, i) => this.startDay + i);
  }

  toString(): string {
    return `${this.checkIn} -> ${this.checkOut}`;
  }
}
