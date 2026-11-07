import { describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  BookingNotOwnedError,
  BookingService,
  BookingStatus,
  Cinema,
  City,
  FakePaymentGateway,
  InMemoryNotifier,
  InvalidBookingTransitionError,
  Movie,
  PaymentFailedError,
  Screen,
  Seat,
  SeatLockedByAnotherUserError,
  SeatLockExpiredError,
  SeatStatus,
  SeatType,
  SeatUnavailableError,
  Show,
  ShowAlreadyStartedError,
  UnknownSeatError,
} from './index';

function build(options: { failureRate?: number } = {}) {
  const clock = new FakeClock('2026-05-10T09:00:00Z');
  const ids = new SequentialIdGenerator();
  const gateway = new FakePaymentGateway({ failureRate: options.failureRate ?? 0, rng: () => 0.5, ids });
  const service = new BookingService({ payment: gateway, lockTtlSeconds: 300, clock, ids });
  const notifier = new InMemoryNotifier();
  service.subscribe(notifier);
  const screen = new Screen('S1', 'Screen 1', [
    new Seat('A1', 'A', SeatType.REGULAR),
    new Seat('A2', 'A', SeatType.REGULAR),
    new Seat('A3', 'A', SeatType.REGULAR),
    new Seat('R1', 'R', SeatType.RECLINER),
  ]);
  const cinema = new Cinema('C1', 'Orion', new City('BLR', 'Bengaluru'), [screen]);
  const prices = { [SeatType.REGULAR]: 25_000, [SeatType.PREMIUM]: 35_000, [SeatType.RECLINER]: 60_000 };
  const show = new Show('SHOW-1', new Movie('M1', 'Dune', 160), cinema, screen, new Date('2026-05-11T15:00:00Z'), prices);
  service.addShow(show);
  return { clock, gateway, service, notifier, show };
}

describe('Seat locking', () => {
  it('locks seats for the user and prices them by seat type', () => {
    const { service, show } = build();
    const booking = service.holdSeats('riya', show.id, ['A1', 'R1']);
    expect(booking.amount).toBe(85_000);
    expect(booking.status).toBe(BookingStatus.PENDING_PAYMENT);
    expect(service.seatStatus(show.id, 'A1')).toBe(SeatStatus.LOCKED);
    expect(service.seatStatus(show.id, 'A2')).toBe(SeatStatus.AVAILABLE);
  });

  it('rejects a conflicting lock from another user', () => {
    const { service, show } = build();
    service.holdSeats('riya', show.id, ['A1']);
    expect(() => service.holdSeats('kabir', show.id, ['A1'])).toThrow(SeatUnavailableError);
  });

  it('locks a group all-or-nothing', () => {
    const { service, show } = build();
    service.holdSeats('riya', show.id, ['A2']);
    expect(() => service.holdSeats('kabir', show.id, ['A1', 'A2', 'A3'])).toThrow(SeatUnavailableError);
    expect(service.seatStatus(show.id, 'A1')).toBe(SeatStatus.AVAILABLE);
    expect(service.seatStatus(show.id, 'A3')).toBe(SeatStatus.AVAILABLE);
    expect(() => service.holdSeats('kabir', show.id, ['A1', 'Z9'])).toThrow(UnknownSeatError);
  });

  it('frees a seat once its lock expires, evaluated lazily', () => {
    const { service, show, clock } = build();
    service.holdSeats('riya', show.id, ['A1']);
    clock.advanceSeconds(299);
    expect(service.seatStatus(show.id, 'A1')).toBe(SeatStatus.LOCKED);
    clock.advanceSeconds(1);
    expect(service.seatStatus(show.id, 'A1')).toBe(SeatStatus.AVAILABLE);
    expect(service.holdSeats('kabir', show.id, ['A1']).userId).toBe('kabir');
  });
});

describe('Confirmation', () => {
  it('charges, books the seats and notifies observers', () => {
    const { service, show, notifier, gateway } = build();
    const booking = service.holdSeats('riya', show.id, ['A1', 'A2']);
    service.confirm(booking.id, 'riya');
    expect(booking.status).toBe(BookingStatus.CONFIRMED);
    expect(booking.paymentId).toBe('PAY-2');
    expect(service.seatStatus(show.id, 'A1')).toBe(SeatStatus.BOOKED);
    expect(gateway.chargeCount).toBe(1);
    expect(notifier.messages).toEqual(['riya: Dune seats A1,A2 confirmed']);
    expect(() => service.holdSeats('kabir', show.id, ['A2'])).toThrow(SeatUnavailableError);
  });

  it('fails after the lock expired without charging the user', () => {
    const { service, show, clock, gateway } = build();
    const booking = service.holdSeats('riya', show.id, ['A1']);
    clock.advanceMinutes(6);
    expect(() => service.confirm(booking.id, 'riya')).toThrow(SeatLockExpiredError);
    expect(booking.status).toBe(BookingStatus.EXPIRED);
    expect(gateway.chargeCount).toBe(0);
  });

  it('fails when the expired seat has been locked by someone else, or the booking is not yours', () => {
    const { service, show, clock } = build();
    const booking = service.holdSeats('riya', show.id, ['A1']);
    expect(() => service.confirm(booking.id, 'kabir')).toThrow(BookingNotOwnedError);
    clock.advanceMinutes(6);
    service.holdSeats('kabir', show.id, ['A1']);
    expect(() => service.confirm(booking.id, 'riya')).toThrow(SeatLockedByAnotherUserError);
    expect(service.seatStatus(show.id, 'A1')).toBe(SeatStatus.LOCKED);
  });

  it('releases the locks when payment fails', () => {
    const { service, show } = build({ failureRate: 1 });
    const booking = service.holdSeats('riya', show.id, ['A1', 'R1']);
    expect(() => service.confirm(booking.id, 'riya')).toThrow(PaymentFailedError);
    expect(booking.status).toBe(BookingStatus.PAYMENT_FAILED);
    expect(service.seatStatus(show.id, 'A1')).toBe(SeatStatus.AVAILABLE);
    expect(service.seatStatus(show.id, 'R1')).toBe(SeatStatus.AVAILABLE);
    expect(() => service.confirm(booking.id, 'riya')).toThrow(InvalidBookingTransitionError);
  });
});

describe('Cancellation', () => {
  it('refunds by how early the user cancels and frees the seats', () => {
    const { service, show, clock, gateway } = build();
    const early = service.holdSeats('riya', show.id, ['A1']);
    service.confirm(early.id, 'riya');
    expect(service.cancel(early.id, 'riya')).toBe(25_000); // > 24h before: full refund
    expect(service.seatStatus(show.id, 'A1')).toBe(SeatStatus.AVAILABLE);

    const late = service.holdSeats('kabir', show.id, ['A3']);
    service.confirm(late.id, 'kabir');
    clock.set('2026-05-11T12:00:00Z'); // 3h before: 50%
    expect(service.cancel(late.id, 'kabir')).toBe(12_500);
    expect(late.status).toBe(BookingStatus.CANCELLED);
    expect(gateway.refunds.map((r) => r.amount)).toEqual([25_000, 12_500]);
  });

  it('rejects cancelling a pending booking or after the show started', () => {
    const { service, show, clock } = build();
    const pending = service.holdSeats('riya', show.id, ['A1']);
    expect(() => service.cancel(pending.id, 'riya')).toThrow(InvalidBookingTransitionError);
    service.confirm(pending.id, 'riya');
    clock.set('2026-05-11T15:30:00Z');
    expect(() => service.cancel(pending.id, 'riya')).toThrow(ShowAlreadyStartedError);
  });

  it('finds upcoming shows by city and movie', () => {
    const { service } = build();
    expect(service.findShows('Bengaluru', 'Dune').map((s) => s.id)).toEqual(['SHOW-1']);
    expect(service.findShows('Mumbai', 'Dune')).toEqual([]);
  });
});
