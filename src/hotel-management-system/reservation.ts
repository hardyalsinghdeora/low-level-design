import { assertMoney, type Money } from '../shared/money';
import { InvalidReservationTransitionError, ReservationNotActiveError } from './errors';
import type { Guest } from './guest';
import type { Room } from './room';
import type { StayDates } from './stay-dates';

export enum ReservationStatus {
  RESERVED = 'RESERVED',
  CHECKED_IN = 'CHECKED_IN',
  CHECKED_OUT = 'CHECKED_OUT',
  CANCELLED = 'CANCELLED',
}

const ALLOWED: Record<ReservationStatus, ReservationStatus[]> = {
  [ReservationStatus.RESERVED]: [ReservationStatus.CHECKED_IN, ReservationStatus.CANCELLED],
  [ReservationStatus.CHECKED_IN]: [ReservationStatus.CHECKED_OUT],
  [ReservationStatus.CHECKED_OUT]: [],
  [ReservationStatus.CANCELLED]: [],
};

export interface NightCharge {
  date: string;
  amount: Money;
}

export interface Extra {
  description: string;
  amount: Money;
  at: Date;
}

/**
 * One guest's claim on one room for a date range. The nightly prices are frozen
 * at booking time so a later pricing change never alters an existing booking.
 */
export class Reservation {
  private current = ReservationStatus.RESERVED;
  private readonly extrasList: Extra[] = [];

  constructor(
    readonly id: string,
    readonly guest: Guest,
    readonly room: Room,
    readonly dates: StayDates,
    readonly nightlyCharges: NightCharge[],
    readonly createdAt: Date,
  ) {}

  get status(): ReservationStatus {
    return this.current;
  }

  get roomTotal(): Money {
    return this.nightlyCharges.reduce((sum, night) => sum + night.amount, 0);
  }

  get extras(): readonly Extra[] {
    return this.extrasList;
  }

  checkIn(): void {
    this.transition(ReservationStatus.CHECKED_IN);
  }

  checkOut(): void {
    this.transition(ReservationStatus.CHECKED_OUT);
  }

  cancel(): void {
    this.transition(ReservationStatus.CANCELLED);
  }

  addExtra(description: string, amount: Money, at: Date): void {
    assertMoney(amount, 'extra');
    if (this.current !== ReservationStatus.CHECKED_IN) throw new ReservationNotActiveError(this.id, this.current);
    this.extrasList.push({ description, amount, at });
  }

  private transition(to: ReservationStatus): void {
    if (!ALLOWED[this.current].includes(to)) throw new InvalidReservationTransitionError(this.id, this.current, to);
    this.current = to;
  }
}
