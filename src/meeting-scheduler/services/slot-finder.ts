import type { Calendar } from '../calendar';
import { Interval, mergeIntervals } from '../interval';

export interface WorkingHours {
  /** Hours in UTC; the code assumes one shared time zone. */
  startHour: number;
  endHour: number;
  /** 0 = Sunday ... 6 = Saturday. */
  days: number[];
}

export const DEFAULT_WORKING_HOURS: WorkingHours = { startHour: 9, endHour: 17, days: [1, 2, 3, 4, 5] };

const DAY_MS = 86_400_000;

/**
 * Suggests common free slots: merge everyone's busy intervals once, then walk
 * each working day and offer back-to-back candidates in every gap long enough.
 * O(n log n) for n busy blocks.
 */
export class SlotFinder {
  constructor(private readonly hours: WorkingHours = DEFAULT_WORKING_HOURS) {}

  suggest(calendars: Calendar[], durationMinutes: number, window: Interval, limit = 5): Interval[] {
    const busy = mergeIntervals(calendars.flatMap((c) => c.busyWithin(window)));
    const needMs = durationMinutes * 60_000;
    const slots: Interval[] = [];
    const firstDay = Math.floor(window.start.getTime() / DAY_MS) * DAY_MS;
    // Back-to-back candidates inside each gap, so a long free afternoon offers several choices.
    const emitGap = (from: number, to: number) => {
      for (let start = from; start + needMs <= to && slots.length < limit; start += needMs) {
        slots.push(Interval.ofMinutes(new Date(start), durationMinutes));
      }
    };

    for (let day = firstDay; day < window.end.getTime() && slots.length < limit; day += DAY_MS) {
      if (!this.hours.days.includes(new Date(day).getUTCDay())) continue;
      const from = Math.max(day + this.hours.startHour * 3_600_000, window.start.getTime());
      const to = Math.min(day + this.hours.endHour * 3_600_000, window.end.getTime());
      let cursor = from;
      for (const block of busy) {
        if (block.end.getTime() <= cursor || block.start.getTime() >= to) continue;
        emitGap(cursor, Math.min(block.start.getTime(), to));
        cursor = Math.max(cursor, block.end.getTime());
      }
      emitGap(cursor, to);
    }
    return slots.slice(0, limit);
  }
}
