import type { Money } from '../shared/money';
import type { Seat } from './cinema';
import { InvalidBookingTransitionError } from './errors';
import type { Show } from './show';

export enum BookingStatus {
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  CONFIRMED = 'CONFIRMED',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

const ALLOWED: Record<BookingStatus, BookingStatus[]> = {
  [BookingStatus.PENDING_PAYMENT]: [BookingStatus.CONFIRMED, BookingStatus.PAYMENT_FAILED, BookingStatus.EXPIRED],
  [BookingStatus.CONFIRMED]: [BookingStatus.CANCELLED],
  [BookingStatus.PAYMENT_FAILED]: [],
  [BookingStatus.EXPIRED]: [],
  [BookingStatus.CANCELLED]: [],
};

/** A user's purchase of seats for one show, from seat hold to confirmation or cancellation. */
export class Booking {
  private current = BookingStatus.PENDING_PAYMENT;
  private payment: string | undefined;
  private refunded: Money = 0;

  constructor(
    readonly id: string,
    readonly userId: string,
    readonly show: Show,
    readonly seats: Seat[],
    readonly amount: Money,
    readonly lockExpiresAt: Date,
  ) {}

  get status(): BookingStatus {
    return this.current;
  }

  get seatIds(): string[] {
    return this.seats.map((s) => s.id);
  }

  get paymentId(): string | undefined {
    return this.payment;
  }

  get refundedAmount(): Money {
    return this.refunded;
  }

  confirm(paymentId: string): void {
    this.transition(BookingStatus.CONFIRMED);
    this.payment = paymentId;
  }

  markPaymentFailed(): void {
    this.transition(BookingStatus.PAYMENT_FAILED);
  }

  expire(): void {
    this.transition(BookingStatus.EXPIRED);
  }

  cancel(refund: Money): void {
    this.transition(BookingStatus.CANCELLED);
    this.refunded = refund;
  }

  private transition(to: BookingStatus): void {
    if (!ALLOWED[this.current].includes(to)) throw new InvalidBookingTransitionError(this.id, this.current, to);
    this.current = to;
  }
}
