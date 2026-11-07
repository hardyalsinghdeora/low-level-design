import type { Money } from '../shared/money';
import type { Seat } from './aircraft';
import { InvalidBookingTransitionError } from './errors';
import type { FlightInstance } from './flight';

export class Passenger {
  constructor(
    readonly id: string,
    readonly name: string,
  ) {}
}

export enum BookingStatus {
  CONFIRMED = 'CONFIRMED',
  CHECKED_IN = 'CHECKED_IN',
  CANCELLED = 'CANCELLED',
}

const ALLOWED: Record<BookingStatus, BookingStatus[]> = {
  [BookingStatus.CONFIRMED]: [BookingStatus.CHECKED_IN, BookingStatus.CANCELLED],
  [BookingStatus.CHECKED_IN]: [],
  [BookingStatus.CANCELLED]: [],
};

/** One passenger on one seat at the fare quoted when booking. */
export interface Ticket {
  passenger: Passenger;
  seat: Seat;
  fare: Money;
}

/** A PNR: several passengers travelling together on one flight instance. */
export class Booking {
  private current = BookingStatus.CONFIRMED;
  private cancellationFee: Money = 0;

  constructor(
    readonly pnr: string,
    readonly instance: FlightInstance,
    readonly tickets: readonly Ticket[],
    readonly bookedAt: Date,
  ) {}

  get status(): BookingStatus {
    return this.current;
  }

  get total(): Money {
    return this.tickets.reduce((sum, t) => sum + t.fare, 0);
  }

  get fee(): Money {
    return this.cancellationFee;
  }

  checkIn(): void {
    this.transition(BookingStatus.CHECKED_IN);
  }

  cancel(fee: Money): void {
    this.transition(BookingStatus.CANCELLED);
    this.cancellationFee = Math.min(fee, this.total);
  }

  private transition(to: BookingStatus): void {
    if (!ALLOWED[this.current].includes(to)) throw new InvalidBookingTransitionError(this.pnr, this.current, to);
    this.current = to;
  }
}
