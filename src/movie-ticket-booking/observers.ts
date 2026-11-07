import type { Money } from '../shared/money';
import type { Booking } from './booking';

/** Observer: tickets by email, analytics, loyalty points react to bookings without the service knowing them. */
export interface BookingObserver {
  onBookingConfirmed(booking: Booking): void;
  onBookingCancelled?(booking: Booking, refund: Money): void;
}

/** Collects notifications in memory; stands in for an email or SMS sender. */
export class InMemoryNotifier implements BookingObserver {
  readonly messages: string[] = [];

  onBookingConfirmed(booking: Booking): void {
    this.messages.push(`${booking.userId}: ${booking.show.movie.title} seats ${booking.seatIds.join(',')} confirmed`);
  }

  onBookingCancelled(booking: Booking, refund: Money): void {
    this.messages.push(`${booking.userId}: booking ${booking.id} cancelled, refund ${refund}`);
  }
}
