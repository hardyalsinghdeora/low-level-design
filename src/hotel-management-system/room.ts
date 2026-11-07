import { assertMoney, type Money } from '../shared/money';
import { RoomUnavailableError } from './errors';
import type { StayDates } from './stay-dates';

/** A sellable category (Deluxe, Suite). Guests book a type; the hotel assigns a concrete room. */
export class RoomType {
  constructor(
    readonly id: string,
    readonly name: string,
    readonly nightlyRate: Money,
    readonly capacity: number,
  ) {
    assertMoney(nightlyRate, 'nightlyRate');
  }
}

/**
 * A physical room. It owns its booking calendar and refuses an overlapping hold,
 * so the "no double booking" invariant lives with the data it protects.
 */
export class Room {
  private readonly holds = new Map<string, StayDates>();

  constructor(
    readonly number: string,
    readonly type: RoomType,
    readonly floor: number,
  ) {}

  isFree(dates: StayDates): boolean {
    for (const held of this.holds.values()) if (held.overlaps(dates)) return false;
    return true;
  }

  hold(reservationId: string, dates: StayDates): void {
    if (!this.isFree(dates)) throw new RoomUnavailableError(this.number, dates.checkIn, dates.checkOut);
    this.holds.set(reservationId, dates);
  }

  release(reservationId: string): void {
    this.holds.delete(reservationId);
  }

  get bookedStays(): StayDates[] {
    return [...this.holds.values()];
  }
}
