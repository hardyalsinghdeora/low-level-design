import { describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  CheckInNotAllowedError,
  FreeUntilDaysBeforePolicy,
  GuestNotFoundError,
  Hotel,
  InvalidDateRangeError,
  InvalidReservationTransitionError,
  NonRefundablePolicy,
  NoRoomAvailableError,
  ReservationNotActiveError,
  ReservationNotFoundError,
  ReservationStatus,
  Room,
  RoomType,
  RoomTypeNotFoundError,
  RoomUnavailableError,
  SeasonalPricing,
  StayDates,
  type CancellationPolicy,
  type PricingStrategy,
} from './index';

const RATE = 10_000;

function build(options: { pricing?: PricingStrategy; cancellationPolicy?: CancellationPolicy; taxBps?: number } = {}) {
  const clock = new FakeClock('2026-03-02T10:00:00Z'); // Monday
  const type = new RoomType('STD', 'Standard', RATE, 2);
  const hotel = new Hotel('Test Hotel', { ...options, clock, ids: new SequentialIdGenerator() });
  hotel.addRoomType(type).addRoom(new Room('101', type, 1));
  const guest = hotel.registerGuest('Asha', 'asha@example.com');
  return { hotel, clock, guest, type };
}

describe('StayDates', () => {
  it('treats stays as half-open intervals and rejects empty ranges', () => {
    const first = new StayDates('2026-03-10', '2026-03-12');
    expect(first.nights).toBe(2);
    expect(first.overlaps(new StayDates('2026-03-12', '2026-03-14'))).toBe(false);
    expect(first.overlaps(new StayDates('2026-03-11', '2026-03-13'))).toBe(true);
    expect(() => new StayDates('2026-03-12', '2026-03-12')).toThrow(InvalidDateRangeError);
    expect(() => new StayDates('12/03/2026', '2026-03-14')).toThrow(InvalidDateRangeError);
  });
});

describe('Hotel booking', () => {
  it('books a free room and freezes standard nightly prices', () => {
    const { hotel, guest } = build();
    const res = hotel.book(guest.id, 'STD', '2026-03-10', '2026-03-13');
    expect(res.id).toBe('RES-2');
    expect(res.room.number).toBe('101');
    expect(res.status).toBe(ReservationStatus.RESERVED);
    expect(res.roomTotal).toBe(3 * RATE);
  });

  it('lets the next guest arrive on the previous guest check-out day', () => {
    const { hotel, guest } = build();
    hotel.book(guest.id, 'STD', '2026-03-10', '2026-03-12');
    expect(hotel.book(guest.id, 'STD', '2026-03-12', '2026-03-14').room.number).toBe('101');
  });

  it('never double books a room for overlapping dates', () => {
    const { hotel, guest, type } = build();
    hotel.book(guest.id, 'STD', '2026-03-10', '2026-03-12');
    expect(() => hotel.book(guest.id, 'STD', '2026-03-11', '2026-03-15')).toThrow(NoRoomAvailableError);
    expect(hotel.availableRooms('2026-03-09', '2026-03-11', 'STD')).toEqual([]);

    const room = new Room('X', type, 1);
    room.hold('A', new StayDates('2026-03-10', '2026-03-12'));
    expect(() => room.hold('B', new StayDates('2026-03-09', '2026-03-11'))).toThrow(RoomUnavailableError);
  });

  it('applies weekend and seasonal surcharges additively per night', () => {
    const pricing = new SeasonalPricing(2_000, [{ from: '2026-03-07', until: '2026-03-09', surchargeBps: 5_000 }]);
    const { hotel } = build({ pricing });
    // Thu 10000, Fri +20% 12000, Sat +20%+50% 17000, Sun +50% 15000
    expect(hotel.quote('STD', '2026-03-05', '2026-03-09')).toBe(54_000);
  });

  it('rejects unknown guests, room types, reservations and past dates', () => {
    const { hotel, guest } = build();
    expect(() => hotel.book('nobody', 'STD', '2026-03-10', '2026-03-11')).toThrow(GuestNotFoundError);
    expect(() => hotel.book(guest.id, 'PENTHOUSE', '2026-03-10', '2026-03-11')).toThrow(RoomTypeNotFoundError);
    expect(() => hotel.book(guest.id, 'STD', '2026-03-01', '2026-03-03')).toThrow(InvalidDateRangeError);
    expect(() => hotel.cancel('RES-404')).toThrow(ReservationNotFoundError);
  });
});

describe('Stay lifecycle', () => {
  it('checks in, records extras and issues an invoice with tax at check-out', () => {
    const { hotel, guest, clock } = build({ taxBps: 1_200 });
    const res = hotel.book(guest.id, 'STD', '2026-03-03', '2026-03-05');
    clock.set('2026-03-03T15:00:00Z');
    hotel.checkIn(res.id);
    hotel.addExtra(res.id, 'Minibar', 1_550);
    clock.set('2026-03-05T10:00:00Z');
    const invoice = hotel.checkOut(res.id);

    expect(invoice.lines).toHaveLength(3);
    expect(invoice.subtotal).toBe(21_550);
    expect(invoice.tax).toBe(2_586);
    expect(invoice.total).toBe(24_136);
    expect(res.status).toBe(ReservationStatus.CHECKED_OUT);
    expect(hotel.availableRooms('2026-03-03', '2026-03-05')).toHaveLength(1);
  });

  it('refuses check-in outside the stay window', () => {
    const { hotel, guest } = build();
    const res = hotel.book(guest.id, 'STD', '2026-03-10', '2026-03-12');
    expect(() => hotel.checkIn(res.id)).toThrow(CheckInNotAllowedError);
  });

  it('validates state transitions and only accepts extras while checked in', () => {
    const { hotel, guest, clock } = build();
    const res = hotel.book(guest.id, 'STD', '2026-03-02', '2026-03-04');
    expect(() => hotel.addExtra(res.id, 'Spa', 5_000)).toThrow(ReservationNotActiveError);
    expect(() => hotel.checkOut(res.id)).toThrow(InvalidReservationTransitionError);
    hotel.checkIn(res.id);
    expect(() => hotel.cancel(res.id)).toThrow(InvalidReservationTransitionError);
    clock.advanceHours(24);
    hotel.checkOut(res.id);
    expect(() => hotel.checkIn(res.id)).toThrow(InvalidReservationTransitionError);
  });
});

describe('Cancellation policies', () => {
  it('is free inside the notice window, charges the first night when late, and frees the room', () => {
    const { hotel, guest, clock } = build({ cancellationPolicy: new FreeUntilDaysBeforePolicy(3) });
    const early = hotel.book(guest.id, 'STD', '2026-03-10', '2026-03-12');
    expect(hotel.cancel(early.id).fee).toBe(0);
    expect(early.status).toBe(ReservationStatus.CANCELLED);

    const late = hotel.book(guest.id, 'STD', '2026-03-10', '2026-03-12');
    clock.set('2026-03-08T09:00:00Z');
    expect(hotel.cancel(late.id).fee).toBe(RATE);
    expect(hotel.availableRooms('2026-03-10', '2026-03-12')).toHaveLength(1);
  });

  it('keeps the whole room total under a non-refundable rate', () => {
    const { hotel, guest } = build({ cancellationPolicy: new NonRefundablePolicy() });
    const res = hotel.book(guest.id, 'STD', '2026-03-20', '2026-03-23');
    expect(hotel.cancel(res.id).fee).toBe(3 * RATE);
  });
});
