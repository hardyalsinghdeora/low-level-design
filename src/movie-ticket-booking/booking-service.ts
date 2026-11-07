import { Clock, SystemClock } from '../shared/clock';
import { IdGenerator, UuidGenerator } from '../shared/id-generator';
import type { Money } from '../shared/money';
import { Booking, BookingStatus } from './booking';
import {
  BookingNotFoundError,
  BookingNotOwnedError,
  InvalidBookingTransitionError,
  PaymentFailedError,
  SeatLockedByAnotherUserError,
  SeatLockExpiredError,
  ShowAlreadyStartedError,
  ShowNotFoundError,
} from './errors';
import type { BookingObserver } from './observers';
import { SeatLockService, type SeatStatus } from './seat-lock-service';
import type { Show } from './show';
import type { PaymentStrategy } from './strategies/payment';
import { TimeBasedRefundPolicy, type RefundPolicy } from './strategies/refund';

export interface BookingServiceOptions {
  payment: PaymentStrategy;
  refundPolicy?: RefundPolicy;
  lockTtlSeconds?: number;
  clock?: Clock;
  ids?: IdGenerator;
}

/**
 * Orchestrates lock -> pay -> confirm. It is the only place that moves seats
 * between the lock service (temporary) and the show (durable), and it always
 * re-validates the lock before charging so nobody pays for a seat they lost.
 */
export class BookingService {
  private readonly shows = new Map<string, Show>();
  private readonly bookings = new Map<string, Booking>();
  private readonly observers: BookingObserver[] = [];
  private readonly locks: SeatLockService;
  private readonly payment: PaymentStrategy;
  private readonly refundPolicy: RefundPolicy;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  constructor(options: BookingServiceOptions) {
    this.payment = options.payment;
    this.refundPolicy = options.refundPolicy ?? new TimeBasedRefundPolicy();
    this.clock = options.clock ?? new SystemClock();
    this.ids = options.ids ?? new UuidGenerator();
    this.locks = new SeatLockService(options.lockTtlSeconds ?? 300, this.clock);
  }

  addShow(show: Show): this {
    this.shows.set(show.id, show);
    return this;
  }

  subscribe(observer: BookingObserver): void {
    this.observers.push(observer);
  }

  findShows(cityName: string, movieTitle: string): Show[] {
    const now = this.clock.now().getTime();
    return [...this.shows.values()]
      .filter((s) => s.cinema.city.name === cityName && s.movie.title === movieTitle && s.startsAt.getTime() > now)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }

  seatStatus(showId: string, seatId: string): SeatStatus {
    return this.locks.statusOf(this.show(showId), seatId);
  }

  /** Step 1: lock the seats (all or nothing) and open a booking awaiting payment. */
  holdSeats(userId: string, showId: string, seatIds: string[]): Booking {
    const show = this.show(showId);
    const expiresAt = this.locks.lock(show, seatIds, userId);
    const seats = seatIds.map((id) => show.screen.seat(id));
    const amount: Money = seats.reduce((sum, seat) => sum + show.priceOf(seat), 0);
    const booking = new Booking(this.ids.next('BKG'), userId, show, seats, amount, expiresAt);
    this.bookings.set(booking.id, booking);
    return booking;
  }

  /** Steps 2 and 3: re-check the lock, charge, then convert locks into booked seats. */
  confirm(bookingId: string, userId: string): Booking {
    const booking = this.ownedBooking(bookingId, userId);
    const { show, seatIds } = booking;
    if (booking.status !== BookingStatus.PENDING_PAYMENT) {
      throw new InvalidBookingTransitionError(booking.id, booking.status, BookingStatus.CONFIRMED);
    }
    try {
      this.locks.assertHeldBy(show, seatIds, userId);
    } catch (error) {
      if (error instanceof SeatLockExpiredError || error instanceof SeatLockedByAnotherUserError) booking.expire();
      throw error;
    }

    const result = this.payment.charge({ amount: booking.amount, userId, idempotencyKey: booking.id });
    if (!result.ok) {
      booking.markPaymentFailed();
      this.locks.release(show, seatIds, userId);
      throw new PaymentFailedError(booking.id, result.reason);
    }
    booking.confirm(result.paymentId);
    show.markBooked(seatIds);
    this.locks.release(show, seatIds, userId);
    for (const observer of this.observers) observer.onBookingConfirmed(booking);
    return booking;
  }

  cancel(bookingId: string, userId: string): Money {
    const booking = this.ownedBooking(bookingId, userId);
    const now = this.clock.now();
    if (now.getTime() >= booking.show.startsAt.getTime()) throw new ShowAlreadyStartedError(booking.show.id);
    const refund = this.refundPolicy.refundFor(booking, now);
    booking.cancel(refund);
    booking.show.releaseSeats(booking.seatIds);
    const paymentId = booking.paymentId;
    if (paymentId && refund > 0) this.payment.refund(paymentId, refund);
    for (const observer of this.observers) observer.onBookingCancelled?.(booking, refund);
    return refund;
  }

  private show(id: string): Show {
    const show = this.shows.get(id);
    if (!show) throw new ShowNotFoundError(id);
    return show;
  }

  private ownedBooking(bookingId: string, userId: string): Booking {
    const booking = this.bookings.get(bookingId);
    if (!booking) throw new BookingNotFoundError(bookingId);
    if (booking.userId !== userId) throw new BookingNotOwnedError(bookingId, userId);
    return booking;
  }
}
