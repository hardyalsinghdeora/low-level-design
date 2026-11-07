import { InvalidRentalPeriodError } from './errors';

const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * Half-open interval [start, end). A rental that ends at 10:00 and the next one
 * that starts at 10:00 do not overlap, so back-to-back bookings are allowed
 * without fiddling with "end minus one second".
 */
export class DateRange {
  readonly start: Date;
  readonly end: Date;

  constructor(start: Date | string, end: Date | string) {
    this.start = new Date(start);
    this.end = new Date(end);
    if (Number.isNaN(this.start.getTime()) || Number.isNaN(this.end.getTime())) {
      throw new InvalidRentalPeriodError('dates must be valid');
    }
    if (this.end.getTime() <= this.start.getTime()) {
      throw new InvalidRentalPeriodError(`return ${this.end.toISOString()} must be after pickup ${this.start.toISOString()}`);
    }
  }

  overlaps(other: DateRange): boolean {
    return this.start.getTime() < other.end.getTime() && other.start.getTime() < this.end.getTime();
  }

  contains(instant: Date): boolean {
    const t = instant.getTime();
    return t >= this.start.getTime() && t < this.end.getTime();
  }

  /** Every started 24-hour block is a billable day. */
  get billableDays(): number {
    return Math.ceil((this.end.getTime() - this.start.getTime()) / DAY_MS);
  }

  toString(): string {
    return `[${this.start.toISOString()}, ${this.end.toISOString()})`;
  }
}
