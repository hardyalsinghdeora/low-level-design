import { UnknownSeatError } from './errors';

export enum SeatClass {
  ECONOMY = 'ECONOMY',
  BUSINESS = 'BUSINESS',
  FIRST = 'FIRST',
}

export class Seat {
  constructor(
    readonly number: string,
    readonly seatClass: SeatClass,
  ) {}
}

/** The carrier. Flights belong to it; aircraft are its fleet. */
export class Airline {
  constructor(
    readonly code: string,
    readonly name: string,
  ) {}
}

/**
 * A physical aircraft and its cabin layout. The seat map is static; which seat
 * is taken depends on the flight instance, not the aircraft.
 */
export class Aircraft {
  private readonly seatsByNumber = new Map<string, Seat>();

  constructor(
    readonly registration: string,
    readonly model: string,
    seats: Seat[],
  ) {
    for (const seat of seats) this.seatsByNumber.set(seat.number, seat);
  }

  /** Builds rows like 1A..1D: `layout` lists [class, rows, seat letters]. */
  static withLayout(registration: string, model: string, layout: [SeatClass, number, string][]): Aircraft {
    const seats: Seat[] = [];
    let row = 1;
    for (const [seatClass, rows, letters] of layout) {
      for (let r = 0; r < rows; r += 1, row += 1) {
        for (const letter of letters) seats.push(new Seat(`${row}${letter}`, seatClass));
      }
    }
    return new Aircraft(registration, model, seats);
  }

  get seats(): Seat[] {
    return [...this.seatsByNumber.values()];
  }

  seat(number: string): Seat {
    const seat = this.seatsByNumber.get(number);
    if (!seat) throw new UnknownSeatError(number, this.registration);
    return seat;
  }

  seatsIn(seatClass: SeatClass): Seat[] {
    return this.seats.filter((s) => s.seatClass === seatClass);
  }
}
