import type { Interval } from './interval';

export interface BusyBlock {
  interval: Interval;
  label: string;
  meetingId?: string;
}

/** Busy time for a person or a room. Owners differ; the overlap rule is the same. */
export class Calendar {
  private readonly blocks: BusyBlock[] = [];

  addBusy(interval: Interval, label: string, meetingId?: string): void {
    this.blocks.push({ interval, label, meetingId });
  }

  removeMeeting(meetingId: string): void {
    for (let i = this.blocks.length - 1; i >= 0; i -= 1) if (this.blocks[i].meetingId === meetingId) this.blocks.splice(i, 1);
  }

  conflicts(interval: Interval): BusyBlock[] {
    return this.blocks.filter((b) => b.interval.overlaps(interval));
  }

  isFree(interval: Interval): boolean {
    return this.conflicts(interval).length === 0;
  }

  busyWithin(window: Interval): Interval[] {
    return this.conflicts(window).map((b) => b.interval);
  }
}

/** A person with a calendar. Busy blocks can be meetings or personal time (focus, travel). */
export class User {
  readonly calendar = new Calendar();

  constructor(
    readonly id: string,
    readonly name: string,
  ) {}
}
