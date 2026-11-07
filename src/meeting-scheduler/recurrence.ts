import { InvalidIntervalError } from './errors';
import type { Interval } from './interval';

/** Expands a weekly series into concrete occurrences, so each can be conflict-checked like a one-off. */
export class WeeklyRecurrence {
  constructor(readonly weeks: number) {
    if (!Number.isInteger(weeks) || weeks < 1) throw new InvalidIntervalError(`weeks must be a positive integer, got ${weeks}`);
  }

  expand(first: Interval): Interval[] {
    return Array.from({ length: this.weeks }, (_, i) => first.shiftDays(7 * i));
  }
}
