import { Clock, SystemClock } from '../shared/clock';
import { IdGenerator, UuidGenerator } from '../shared/id-generator';
import type { Money } from '../shared/money';
import {
  CheckInNotAllowedError,
  GuestNotFoundError,
  InvalidDateRangeError,
  NoRoomAvailableError,
  ReservationNotFoundError,
  RoomTypeNotFoundError,
} from './errors';
import { Guest } from './guest';
import { Invoice, type InvoiceLine } from './invoice';
import { Reservation } from './reservation';
import type { Room, RoomType } from './room';
import { dayNumberOf, dayToIso, StayDates } from './stay-dates';
import { FreeUntilDaysBeforePolicy, type CancellationPolicy } from './strategies/cancellation';
import { StandardPricing, type PricingStrategy } from './strategies/pricing';

export interface HotelOptions {
  pricing?: PricingStrategy;
  cancellationPolicy?: CancellationPolicy;
  /** Tax on the invoice subtotal in basis points (1200 = 12%). */
  taxBps?: number;
  clock?: Clock;
  ids?: IdGenerator;
}

export interface CancellationResult {
  reservationId: string;
  fee: Money;
  cancelledAt: Date;
}

/**
 * Aggregate root for one property. It is the only place that turns a request
 * for a room type into a concrete room hold, so availability and booking stay
 * consistent; pricing and cancellation rules are injected strategies.
 */
export class Hotel {
  private readonly roomTypes = new Map<string, RoomType>();
  private readonly rooms = new Map<string, Room>();
  private readonly guests = new Map<string, Guest>();
  private readonly reservations = new Map<string, Reservation>();
  private pricing: PricingStrategy;
  private readonly cancellationPolicy: CancellationPolicy;
  private readonly taxBps: number;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  constructor(
    readonly name: string,
    options: HotelOptions = {},
  ) {
    this.pricing = options.pricing ?? new StandardPricing();
    this.cancellationPolicy = options.cancellationPolicy ?? new FreeUntilDaysBeforePolicy(2);
    this.taxBps = options.taxBps ?? 0;
    this.clock = options.clock ?? new SystemClock();
    this.ids = options.ids ?? new UuidGenerator();
  }

  addRoomType(type: RoomType): this {
    this.roomTypes.set(type.id, type);
    return this;
  }

  addRoom(room: Room): this {
    if (!this.roomTypes.has(room.type.id)) throw new RoomTypeNotFoundError(room.type.id);
    if (this.rooms.has(room.number)) throw new RangeError(`Room ${room.number} already exists`);
    this.rooms.set(room.number, room);
    return this;
  }

  setPricing(pricing: PricingStrategy): void {
    this.pricing = pricing;
  }

  registerGuest(name: string, email: string): Guest {
    const guest = new Guest(this.ids.next('GST'), name, email);
    this.guests.set(guest.id, guest);
    return guest;
  }

  availableRooms(checkIn: string, checkOut: string, roomTypeId?: string): Room[] {
    const dates = new StayDates(checkIn, checkOut);
    return [...this.rooms.values()].filter(
      (room) => (roomTypeId === undefined || room.type.id === roomTypeId) && room.isFree(dates),
    );
  }

  quote(roomTypeId: string, checkIn: string, checkOut: string): Money {
    const type = this.roomType(roomTypeId);
    return this.pricing.priceNights(type, new StayDates(checkIn, checkOut)).reduce((sum, n) => sum + n.amount, 0);
  }

  /** Books the first free room of the type. Prices are frozen on the reservation. */
  book(guestId: string, roomTypeId: string, checkIn: string, checkOut: string): Reservation {
    const guest = this.guests.get(guestId);
    if (!guest) throw new GuestNotFoundError(guestId);
    const type = this.roomType(roomTypeId);
    const dates = new StayDates(checkIn, checkOut);
    if (dates.startDay < dayNumberOf(this.clock.now())) {
      throw new InvalidDateRangeError(`Check-in ${checkIn} is in the past`);
    }
    const room = [...this.rooms.values()].find((r) => r.type.id === type.id && r.isFree(dates));
    if (!room) throw new NoRoomAvailableError(roomTypeId, checkIn, checkOut);

    const reservation = new Reservation(
      this.ids.next('RES'),
      guest,
      room,
      dates,
      this.pricing.priceNights(type, dates),
      this.clock.now(),
    );
    // Compare-and-set on the room calendar: throws if another booking slipped in.
    room.hold(reservation.id, dates);
    this.reservations.set(reservation.id, reservation);
    return reservation;
  }

  checkIn(reservationId: string): Reservation {
    const reservation = this.reservation(reservationId);
    const today = dayNumberOf(this.clock.now());
    const { dates } = reservation;
    if (today < dates.startDay || today >= dates.endDay) {
      throw new CheckInNotAllowedError(reservationId, dayToIso(today), dates.checkIn, dates.checkOut);
    }
    reservation.checkIn();
    return reservation;
  }

  addExtra(reservationId: string, description: string, amount: Money): void {
    this.reservation(reservationId).addExtra(description, amount, this.clock.now());
  }

  /** Bills every booked night (early departure is not refunded) plus extras, and frees the room. */
  checkOut(reservationId: string): Invoice {
    const reservation = this.reservation(reservationId);
    reservation.checkOut();
    reservation.room.release(reservation.id);
    const lines: InvoiceLine[] = [
      ...reservation.nightlyCharges.map((n) => ({ description: `Room ${reservation.room.number} night of ${n.date}`, amount: n.amount })),
      ...reservation.extras.map((e) => ({ description: e.description, amount: e.amount })),
    ];
    return new Invoice(this.ids.next('INV'), reservation.id, reservation.guest.name, lines, this.taxBps, this.clock.now());
  }

  cancel(reservationId: string): CancellationResult {
    const reservation = this.reservation(reservationId);
    const cancelledAt = this.clock.now();
    const fee = this.cancellationPolicy.fee(reservation, cancelledAt);
    reservation.cancel();
    reservation.room.release(reservation.id);
    return { reservationId, fee, cancelledAt };
  }

  getReservation(reservationId: string): Reservation {
    return this.reservation(reservationId);
  }

  private roomType(id: string): RoomType {
    const type = this.roomTypes.get(id);
    if (!type) throw new RoomTypeNotFoundError(id);
    return type;
  }

  private reservation(id: string): Reservation {
    const reservation = this.reservations.get(id);
    if (!reservation) throw new ReservationNotFoundError(id);
    return reservation;
  }
}
