import { UnknownSeatError } from './errors';

export enum SeatType {
  REGULAR = 'REGULAR',
  PREMIUM = 'PREMIUM',
  RECLINER = 'RECLINER',
}

/** A physical seat in a screen. Its price is not here: price belongs to the show. */
export class Seat {
  constructor(
    readonly id: string,
    readonly row: string,
    readonly type: SeatType,
  ) {}
}

/** An auditorium with a fixed seat map, reused by every show it hosts. */
export class Screen {
  private readonly seatsById = new Map<string, Seat>();

  constructor(
    readonly id: string,
    readonly name: string,
    seats: Seat[],
  ) {
    for (const seat of seats) this.seatsById.set(seat.id, seat);
  }

  get seats(): Seat[] {
    return [...this.seatsById.values()];
  }

  seat(seatId: string): Seat {
    const seat = this.seatsById.get(seatId);
    if (!seat) throw new UnknownSeatError(seatId, this.id);
    return seat;
  }
}

export class City {
  constructor(
    readonly id: string,
    readonly name: string,
  ) {}
}

/** A venue in a city that owns one or more screens. */
export class Cinema {
  constructor(
    readonly id: string,
    readonly name: string,
    readonly city: City,
    readonly screens: Screen[],
  ) {}
}
