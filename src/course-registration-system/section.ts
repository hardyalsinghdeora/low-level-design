import { SectionFullError } from './errors';
import type { WeeklySlot } from './schedule';

/**
 * One offering of a course in a term: an instructor, a room-sized capacity,
 * weekly meetings and a FIFO waitlist. It tracks registration ids only, so
 * seat counting stays here and student rules stay in the registrar.
 */
export class Section {
  readonly slots: readonly WeeklySlot[];
  private readonly seated = new Set<string>();
  private readonly waitlist: string[] = [];

  constructor(
    readonly id: string,
    readonly courseCode: string,
    readonly termId: string,
    readonly instructor: string,
    readonly capacity: number,
    slots: readonly WeeklySlot[],
    readonly waitlistCapacity = 10,
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('capacity must be a positive integer');
    if (!Number.isInteger(waitlistCapacity) || waitlistCapacity < 0) throw new RangeError('waitlistCapacity must be >= 0');
    this.slots = [...slots];
  }

  get seatsLeft(): number {
    return this.capacity - this.seated.size;
  }

  get enrolledCount(): number {
    return this.seated.size;
  }

  get waitlistIds(): readonly string[] {
    return [...this.waitlist];
  }

  /** Seats the registration if there is room, else queues it; returns true when seated. */
  admit(registrationId: string): boolean {
    if (this.seatsLeft > 0) {
      this.seated.add(registrationId);
      return true;
    }
    if (this.waitlist.length >= this.waitlistCapacity) throw new SectionFullError(this.id);
    this.waitlist.push(registrationId);
    return false;
  }

  /** Removes a registration from its seat or its place in line; returns true if a seat was freed. */
  release(registrationId: string): boolean {
    if (this.seated.delete(registrationId)) return true;
    const index = this.waitlist.indexOf(registrationId);
    if (index >= 0) this.waitlist.splice(index, 1);
    return false;
  }

  /** Moves the head of the waitlist into a free seat. */
  promoteNext(): string | undefined {
    if (this.seatsLeft === 0) return undefined;
    const next = this.waitlist.shift();
    if (next !== undefined) this.seated.add(next);
    return next;
  }
}
