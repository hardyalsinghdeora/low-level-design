import { assertMoney, type Money } from '../shared/money';
import type { Cinema, Screen, Seat, SeatType } from './cinema';
import { SeatUnavailableError } from './errors';

export class Movie {
  constructor(
    readonly id: string,
    readonly title: string,
    readonly durationMinutes: number,
  ) {}
}

/**
 * One screening of a movie. It owns the durable part of seat state (BOOKED);
 * temporary holds live in the SeatLockService, as they would in Redis vs the database.
 */
export class Show {
  private readonly booked = new Set<string>();

  constructor(
    readonly id: string,
    readonly movie: Movie,
    readonly cinema: Cinema,
    readonly screen: Screen,
    readonly startsAt: Date,
    readonly prices: Record<SeatType, Money>,
  ) {
    for (const price of Object.values(prices)) assertMoney(price, 'seat price');
  }

  isBooked(seatId: string): boolean {
    return this.booked.has(seatId);
  }

  priceOf(seat: Seat): Money {
    return this.prices[seat.type];
  }

  /** All-or-nothing: checks every seat before booking any, so a failure leaves no partial booking. */
  markBooked(seatIds: string[]): void {
    for (const id of seatIds) {
      this.screen.seat(id);
      if (this.booked.has(id)) throw new SeatUnavailableError(id, 'BOOKED');
    }
    for (const id of seatIds) this.booked.add(id);
  }

  releaseSeats(seatIds: string[]): void {
    for (const id of seatIds) this.booked.delete(id);
  }
}
