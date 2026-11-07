import { InvalidTransitionError, PartyTooLargeError, ReservationConflictError } from './errors';

/** Half-open interval [start, end): a booking ending at 20:00 does not clash with one starting at 20:00. */
export interface TimeSlot {
  readonly start: Date;
  readonly end: Date;
}

export function slotOf(start: Date, minutes: number): TimeSlot {
  return { start: new Date(start), end: new Date(start.getTime() + minutes * 60_000) };
}

export function overlaps(a: TimeSlot, b: TimeSlot): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

export enum ReservationStatus {
  BOOKED = 'BOOKED',
  CANCELLED = 'CANCELLED',
}

/** A promise of one table for one slot. Cancelled reservations stay for history but free the slot. */
export class Reservation {
  private _status = ReservationStatus.BOOKED;

  constructor(
    readonly id: string,
    readonly tableId: string,
    readonly guestName: string,
    readonly partySize: number,
    readonly slot: TimeSlot,
  ) {
    if (slot.start.getTime() >= slot.end.getTime()) throw new RangeError('A reservation must end after it starts');
  }

  get status(): ReservationStatus {
    return this._status;
  }

  get isActive(): boolean {
    return this._status === ReservationStatus.BOOKED;
  }

  cancel(): void {
    if (!this.isActive) throw new InvalidTransitionError('Reservation', this.id, this._status, 'cancel');
    this._status = ReservationStatus.CANCELLED;
  }
}

/**
 * A table owns its bookings so the "no double booking" check lives next to
 * the data it protects: `book()` is the compare-and-set.
 */
export class Table {
  private readonly reservations: Reservation[] = [];

  constructor(
    readonly id: string,
    readonly capacity: number,
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError(`capacity must be a positive integer, got ${capacity}`);
  }

  fits(partySize: number): boolean {
    return partySize <= this.capacity;
  }

  isFreeDuring(slot: TimeSlot): boolean {
    return !this.reservations.some((r) => r.isActive && overlaps(r.slot, slot));
  }

  book(reservation: Reservation): void {
    if (!this.fits(reservation.partySize)) throw new PartyTooLargeError(this.id, this.capacity, reservation.partySize);
    if (!this.isFreeDuring(reservation.slot)) {
      throw new ReservationConflictError(this.id, reservation.slot.start, reservation.slot.end);
    }
    this.reservations.push(reservation);
  }

  get bookings(): readonly Reservation[] {
    return this.reservations.filter((r) => r.isActive);
  }
}
