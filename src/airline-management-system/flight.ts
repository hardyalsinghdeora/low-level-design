import type { Aircraft, Airline, Seat, SeatClass } from './aircraft';
import { InvalidBookingRequestError, SeatAlreadyAssignedError } from './errors';

/** A scheduled route, e.g. AI-101 DEL -> BOM, independent of any date. */
export class Flight {
  constructor(
    readonly number: string,
    readonly airline: Airline,
    readonly origin: string,
    readonly destination: string,
    readonly durationMinutes: number,
  ) {}
}

/**
 * One departure of a flight on a date with a specific aircraft. It owns seat
 * assignments, so "no seat assigned twice on one departure" is enforced here.
 */
export class FlightInstance {
  private readonly assignedTo = new Map<string, string>();

  constructor(
    readonly id: string,
    readonly flight: Flight,
    readonly aircraft: Aircraft,
    readonly departureAt: Date,
  ) {}

  isAssigned(seatNumber: string): boolean {
    return this.assignedTo.has(seatNumber);
  }

  availableSeats(seatClass: SeatClass): Seat[] {
    return this.aircraft.seatsIn(seatClass).filter((s) => !this.assignedTo.has(s.number));
  }

  /** Share of the cabin already sold, 0..1. Drives dynamic fares. */
  loadFactor(seatClass: SeatClass): number {
    const total = this.aircraft.seatsIn(seatClass).length;
    return total === 0 ? 1 : (total - this.availableSeats(seatClass).length) / total;
  }

  /** All-or-nothing: validates every seat before assigning any. */
  assignSeats(bookingId: string, seatNumbers: string[]): Seat[] {
    if (new Set(seatNumbers).size !== seatNumbers.length) {
      throw new InvalidBookingRequestError('The same seat appears twice in one booking');
    }
    const seats = seatNumbers.map((n) => this.aircraft.seat(n));
    for (const seat of seats) if (this.assignedTo.has(seat.number)) throw new SeatAlreadyAssignedError(seat.number, this.id);
    for (const seat of seats) this.assignedTo.set(seat.number, bookingId);
    return seats;
  }

  releaseSeats(bookingId: string): void {
    for (const [seat, owner] of this.assignedTo) if (owner === bookingId) this.assignedTo.delete(seat);
  }
}
