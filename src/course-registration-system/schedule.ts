export enum Weekday {
  MON = 'MON',
  TUE = 'TUE',
  WED = 'WED',
  THU = 'THU',
  FRI = 'FRI',
}

/** A recurring weekly meeting as minutes since midnight, half-open [start, end). */
export interface WeeklySlot {
  readonly day: Weekday;
  readonly startMinute: number;
  readonly endMinute: number;
}

function toMinutes(hhmm: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) throw new RangeError(`Expected HH:MM, got ${hhmm}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

export function weekly(day: Weekday, from: string, to: string): WeeklySlot {
  const slot = { day, startMinute: toMinutes(from), endMinute: toMinutes(to) };
  if (slot.startMinute >= slot.endMinute) throw new RangeError(`${from}-${to} is empty`);
  return slot;
}

/** A 10:00-11:00 lecture and an 11:00-12:00 lab do not clash. */
export function slotsOverlap(a: WeeklySlot, b: WeeklySlot): boolean {
  return a.day === b.day && a.startMinute < b.endMinute && b.startMinute < a.endMinute;
}

export function schedulesOverlap(a: readonly WeeklySlot[], b: readonly WeeklySlot[]): boolean {
  return a.some((x) => b.some((y) => slotsOverlap(x, y)));
}

export function formatSlot(slot: WeeklySlot): string {
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return `${slot.day} ${hhmm(slot.startMinute)}-${hhmm(slot.endMinute)}`;
}
