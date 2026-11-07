import { InvalidIntervalError } from './errors';

const MINUTE_MS = 60_000;

/**
 * Half-open time interval [start, end). A meeting ending at 10:00 and one
 * starting at 10:00 do not conflict, which is how people expect calendars to work.
 */
export class Interval {
  constructor(
    readonly start: Date,
    readonly end: Date,
  ) {
    if (!(end.getTime() > start.getTime())) {
      throw new InvalidIntervalError(`Interval end ${end.toISOString()} must be after start ${start.toISOString()}`);
    }
  }

  static ofMinutes(start: Date, minutes: number): Interval {
    return new Interval(start, new Date(start.getTime() + minutes * MINUTE_MS));
  }

  get durationMinutes(): number {
    return (this.end.getTime() - this.start.getTime()) / MINUTE_MS;
  }

  overlaps(other: Interval): boolean {
    return this.start.getTime() < other.end.getTime() && other.start.getTime() < this.end.getTime();
  }

  shiftDays(days: number): Interval {
    const ms = days * 24 * 60 * MINUTE_MS;
    return new Interval(new Date(this.start.getTime() + ms), new Date(this.end.getTime() + ms));
  }

  toString(): string {
    return `${this.start.toISOString().slice(0, 16)}-${this.end.toISOString().slice(11, 16)}`;
  }
}

/** Sorts and merges overlapping or touching intervals into disjoint blocks. O(n log n). */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: Interval[] = [];
  for (const next of sorted) {
    const last = merged.at(-1);
    if (last && next.start.getTime() <= last.end.getTime()) {
      if (next.end.getTime() > last.end.getTime()) merged[merged.length - 1] = new Interval(last.start, next.end);
    } else {
      merged.push(next);
    }
  }
  return merged;
}
