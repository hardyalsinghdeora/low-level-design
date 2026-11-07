import { Clock, SystemClock } from '../shared/clock';
import { IdGenerator, UuidGenerator } from '../shared/id-generator';
import type { Money } from '../shared/money';
import { SeatClass, type Aircraft } from './aircraft';
import { Booking, Passenger, type Ticket } from './booking';
import {
  BookingNotFoundError,
  CheckInWindowError,
  FlightDepartedError,
  FlightInstanceNotFoundError,
  InvalidBookingRequestError,
} from './errors';
import { FlightInstance, type Flight } from './flight';
import { TimeBasedCancellationFee, type CancellationFeeStrategy } from './strategies/cancellation-fee';
import type { FareStrategy } from './strategies/fare';

export interface AirlineSystemOptions {
  fareStrategy: FareStrategy;
  cancellationFee?: CancellationFeeStrategy;
  checkInOpensHoursBefore?: number;
  checkInClosesMinutesBefore?: number;
  clock?: Clock;
  ids?: IdGenerator;
}

export interface SeatRequest {
  passengerName: string;
  seatNumber: string;
}

export interface SearchResult {
  instance: FlightInstance;
  fares: Record<SeatClass, Money>;
  seatsLeft: Record<SeatClass, number>;
}

export interface CancellationResult {
  pnr: string;
  fee: Money;
  refund: Money;
}

const CLASSES = [SeatClass.ECONOMY, SeatClass.BUSINESS, SeatClass.FIRST];

/**
 * Reservation system for one or more airlines: schedules departures, searches,
 * books (all seats or none), cancels with a fee policy and runs check-in inside
 * a window measured with the injected Clock.
 */
export class AirlineSystem {
  private readonly instances = new Map<string, FlightInstance>();
  private readonly bookings = new Map<string, Booking>();
  private fareStrategy: FareStrategy;
  private readonly cancellationFee: CancellationFeeStrategy;
  private readonly checkInOpensMs: number;
  private readonly checkInClosesMs: number;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  constructor(options: AirlineSystemOptions) {
    this.fareStrategy = options.fareStrategy;
    this.cancellationFee = options.cancellationFee ?? new TimeBasedCancellationFee();
    this.checkInOpensMs = (options.checkInOpensHoursBefore ?? 48) * 3_600_000;
    this.checkInClosesMs = (options.checkInClosesMinutesBefore ?? 60) * 60_000;
    this.clock = options.clock ?? new SystemClock();
    this.ids = options.ids ?? new UuidGenerator();
  }

  setFareStrategy(strategy: FareStrategy): void {
    this.fareStrategy = strategy;
  }

  schedule(flight: Flight, aircraft: Aircraft, departureAt: Date): FlightInstance {
    const instance = new FlightInstance(this.ids.next(flight.number), flight, aircraft, departureAt);
    this.instances.set(instance.id, instance);
    return instance;
  }

  /** Departures on a UTC calendar date (YYYY-MM-DD) that have not left yet, earliest first. */
  search(origin: string, destination: string, date: string): SearchResult[] {
    const now = this.clock.now().getTime();
    return [...this.instances.values()]
      .filter(
        (i) =>
          i.flight.origin === origin &&
          i.flight.destination === destination &&
          i.departureAt.toISOString().slice(0, 10) === date &&
          i.departureAt.getTime() > now,
      )
      .sort((a, b) => a.departureAt.getTime() - b.departureAt.getTime())
      .map((instance) => ({
        instance,
        fares: this.byClass((c) => this.fareStrategy.fareFor(instance, c)),
        seatsLeft: this.byClass((c) => instance.availableSeats(c).length),
      }));
  }

  /** Fares are quoted at the load factor before this booking, so a group pays one price per class. */
  book(instanceId: string, requests: SeatRequest[]): Booking {
    const instance = this.instance(instanceId);
    if (requests.length === 0) throw new InvalidBookingRequestError('A booking needs at least one passenger');
    if (this.clock.now().getTime() >= instance.departureAt.getTime()) throw new FlightDepartedError(instanceId);

    const fares = this.byClass((c) => this.fareStrategy.fareFor(instance, c));
    const pnr = this.ids.next('PNR');
    const seats = instance.assignSeats(
      pnr,
      requests.map((r) => r.seatNumber),
    );
    const tickets: Ticket[] = seats.map((seat, i) => ({
      passenger: new Passenger(this.ids.next('PAX'), requests[i].passengerName),
      seat,
      fare: fares[seat.seatClass],
    }));
    const booking = new Booking(pnr, instance, tickets, this.clock.now());
    this.bookings.set(pnr, booking);
    return booking;
  }

  cancel(pnr: string): CancellationResult {
    const booking = this.booking(pnr);
    const now = this.clock.now();
    if (now.getTime() >= booking.instance.departureAt.getTime()) throw new FlightDepartedError(booking.instance.id);
    booking.cancel(this.cancellationFee.feeFor(booking, now));
    booking.instance.releaseSeats(pnr);
    return { pnr, fee: booking.fee, refund: booking.total - booking.fee };
  }

  checkIn(pnr: string): Booking {
    const booking = this.booking(pnr);
    const departure = booking.instance.departureAt.getTime();
    const opensAt = new Date(departure - this.checkInOpensMs);
    const closesAt = new Date(departure - this.checkInClosesMs);
    const now = this.clock.now().getTime();
    if (now < opensAt.getTime() || now >= closesAt.getTime()) throw new CheckInWindowError(pnr, opensAt, closesAt);
    booking.checkIn();
    return booking;
  }

  getBooking(pnr: string): Booking {
    return this.booking(pnr);
  }

  private byClass<T>(fn: (seatClass: SeatClass) => T): Record<SeatClass, T> {
    return Object.fromEntries(CLASSES.map((c) => [c, fn(c)])) as Record<SeatClass, T>;
  }

  private instance(id: string): FlightInstance {
    const instance = this.instances.get(id);
    if (!instance) throw new FlightInstanceNotFoundError(id);
    return instance;
  }

  private booking(pnr: string): Booking {
    const booking = this.bookings.get(pnr);
    if (!booking) throw new BookingNotFoundError(pnr);
    return booking;
  }
}
