import { describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  Aircraft,
  Airline,
  AirlineSystem,
  BookingStatus,
  CheckInWindowError,
  FixedFareStrategy,
  FlatCancellationFee,
  Flight,
  FlightDepartedError,
  FlightInstanceNotFoundError,
  InvalidBookingRequestError,
  InvalidBookingTransitionError,
  LoadFactorFareStrategy,
  SeatAlreadyAssignedError,
  SeatClass,
  UnknownSeatError,
  type CancellationFeeStrategy,
  type FareStrategy,
} from './index';

const BASE = { [SeatClass.ECONOMY]: 10_000, [SeatClass.BUSINESS]: 40_000, [SeatClass.FIRST]: 90_000 };

function build(options: { fare?: FareStrategy; cancellationFee?: CancellationFeeStrategy } = {}) {
  const clock = new FakeClock('2026-07-01T08:00:00Z');
  const system = new AirlineSystem({
    fareStrategy: options.fare ?? new FixedFareStrategy(BASE),
    cancellationFee: options.cancellationFee,
    clock,
    ids: new SequentialIdGenerator(),
  });
  const aircraft = Aircraft.withLayout('VT-T', 'A320', [
    [SeatClass.FIRST, 1, 'AB'],
    [SeatClass.BUSINESS, 1, 'AB'],
    [SeatClass.ECONOMY, 1, 'ABCD'],
  ]);
  const airline = new Airline('SW', 'Skyway');
  const flight = new Flight('SW101', airline, 'DEL', 'BOM', 130);
  const morning = system.schedule(flight, aircraft, new Date('2026-07-05T03:30:00Z'));
  const evening = system.schedule(flight, aircraft, new Date('2026-07-05T13:00:00Z'));
  system.schedule(flight, aircraft, new Date('2026-07-06T03:30:00Z'));
  system.schedule(new Flight('SW202', airline, 'BOM', 'DEL', 130), aircraft, new Date('2026-07-05T06:00:00Z'));
  return { clock, system, morning, evening };
}

describe('Search', () => {
  it('finds departures by origin, destination and date, earliest first, with seats left', () => {
    const { system, morning, evening } = build();
    const results = system.search('DEL', 'BOM', '2026-07-05');
    expect(results.map((r) => r.instance.id)).toEqual([morning.id, evening.id]);
    expect(results[0].seatsLeft).toEqual({ ECONOMY: 4, BUSINESS: 2, FIRST: 2 });
    expect(system.search('DEL', 'BOM', '2026-07-07')).toEqual([]);
  });
});

describe('Booking and seats', () => {
  it('books several passengers with seat selection and per-class fares', () => {
    const { system, morning } = build();
    const booking = system.book(morning.id, [
      { passengerName: 'Raj', seatNumber: '3A' },
      { passengerName: 'Simran', seatNumber: '2A' },
    ]);
    expect(booking.pnr).toBe('PNR-5');
    expect(booking.status).toBe(BookingStatus.CONFIRMED);
    expect(booking.tickets.map((t) => [t.passenger.name, t.seat.seatClass, t.fare])).toEqual([
      ['Raj', SeatClass.ECONOMY, 10_000],
      ['Simran', SeatClass.BUSINESS, 40_000],
    ]);
    expect(booking.total).toBe(50_000);
  });

  it('never assigns a seat twice on one departure, and assigns all seats or none', () => {
    const { system, morning, evening } = build();
    system.book(morning.id, [{ passengerName: 'Raj', seatNumber: '3A' }]);
    expect(() =>
      system.book(morning.id, [
        { passengerName: 'Om', seatNumber: '3B' },
        { passengerName: 'Nisha', seatNumber: '3A' },
      ]),
    ).toThrow(SeatAlreadyAssignedError);
    expect(morning.isAssigned('3B')).toBe(false);
    expect(system.book(evening.id, [{ passengerName: 'Om', seatNumber: '3A' }]).tickets).toHaveLength(1);
  });

  it('rejects duplicate or unknown seats, empty requests and unknown flights', () => {
    const { system, morning } = build();
    const twice = [
      { passengerName: 'A', seatNumber: '3A' },
      { passengerName: 'B', seatNumber: '3A' },
    ];
    expect(() => system.book(morning.id, twice)).toThrow(InvalidBookingRequestError);
    expect(() => system.book(morning.id, [{ passengerName: 'A', seatNumber: '99Z' }])).toThrow(UnknownSeatError);
    expect(() => system.book(morning.id, [])).toThrow(InvalidBookingRequestError);
    expect(() => system.book('nope', [{ passengerName: 'A', seatNumber: '3A' }])).toThrow(FlightInstanceNotFoundError);
  });

  it('refuses bookings once the flight has departed', () => {
    const { system, morning, clock } = build();
    clock.set('2026-07-05T03:30:00Z');
    expect(() => system.book(morning.id, [{ passengerName: 'A', seatNumber: '3A' }])).toThrow(FlightDepartedError);
  });
});

describe('Fares', () => {
  it('adds a surge proportional to the cabin load factor', () => {
    const { system, morning } = build({ fare: new LoadFactorFareStrategy(BASE, 5_000) });
    expect(system.search('DEL', 'BOM', '2026-07-05')[0].fares.ECONOMY).toBe(10_000);
    const pair = system.book(morning.id, [
      { passengerName: 'A', seatNumber: '3A' },
      { passengerName: 'B', seatNumber: '3B' },
    ]);
    expect(pair.total).toBe(20_000); // both priced at the pre-booking load
    const next = system.book(morning.id, [{ passengerName: 'C', seatNumber: '3C' }]);
    expect(next.total).toBe(12_500); // half full: +50% * 2/4
    expect(system.search('DEL', 'BOM', '2026-07-05')[0].fares.BUSINESS).toBe(40_000);
  });
});

describe('Cancellation', () => {
  it('charges a fee by notice given, refunds the rest and frees the seats', () => {
    const { system, morning, clock } = build();
    const early = system.book(morning.id, [{ passengerName: 'A', seatNumber: '3A' }]);
    expect(system.cancel(early.pnr)).toEqual({ pnr: early.pnr, fee: 1_000, refund: 9_000 }); // > 72h: 10%
    expect(morning.isAssigned('3A')).toBe(false);

    const late = system.book(morning.id, [{ passengerName: 'B', seatNumber: '3B' }]);
    clock.set('2026-07-04T03:30:00Z'); // exactly 24h: 50%
    expect(system.cancel(late.pnr).fee).toBe(5_000);
    const veryLate = system.book(morning.id, [{ passengerName: 'C', seatNumber: '3C' }]);
    clock.set('2026-07-05T00:00:00Z');
    expect(system.cancel(veryLate.pnr).refund).toBe(0);
    expect(() => system.cancel(veryLate.pnr)).toThrow(InvalidBookingTransitionError);
  });

  it('supports a flat fee per passenger', () => {
    const { system, morning } = build({ cancellationFee: new FlatCancellationFee(3_000) });
    const booking = system.book(morning.id, [
      { passengerName: 'A', seatNumber: '3A' },
      { passengerName: 'B', seatNumber: '3B' },
    ]);
    expect(system.cancel(booking.pnr).refund).toBe(20_000 - 6_000);
  });
});

describe('Check-in', () => {
  it('is allowed only between 48h and 1h before departure, and blocks cancellation afterwards', () => {
    const { system, morning, clock } = build();
    const booking = system.book(morning.id, [{ passengerName: 'A', seatNumber: '1A' }]);
    clock.set('2026-07-03T03:29:00Z');
    expect(() => system.checkIn(booking.pnr)).toThrow(CheckInWindowError);
    clock.set('2026-07-03T03:30:00Z');
    expect(system.checkIn(booking.pnr).status).toBe(BookingStatus.CHECKED_IN);
    expect(() => system.cancel(booking.pnr)).toThrow(InvalidBookingTransitionError);

    const other = system.book(morning.id, [{ passengerName: 'B', seatNumber: '1B' }]);
    clock.set('2026-07-05T02:30:00Z');
    expect(() => system.checkIn(other.pnr)).toThrow(CheckInWindowError);
  });
});
