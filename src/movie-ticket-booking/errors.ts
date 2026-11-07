import { DomainError } from '../shared/errors';

export class MovieBookingError extends DomainError {}

export class ShowNotFoundError extends MovieBookingError {
  constructor(showId: string) {
    super(`No show ${showId}`);
  }
}

export class BookingNotFoundError extends MovieBookingError {
  constructor(bookingId: string) {
    super(`No booking ${bookingId}`);
  }
}

export class UnknownSeatError extends MovieBookingError {
  constructor(seatId: string, screenId: string) {
    super(`Screen ${screenId} has no seat ${seatId}`);
  }
}

export class SeatUnavailableError extends MovieBookingError {
  constructor(seatId: string, status: string) {
    super(`Seat ${seatId} is ${status}`);
  }
}

export class SeatLockExpiredError extends MovieBookingError {
  constructor(seatId: string, userId: string) {
    super(`Lock on seat ${seatId} for ${userId} has expired or does not exist`);
  }
}

export class SeatLockedByAnotherUserError extends MovieBookingError {
  constructor(seatId: string) {
    super(`Seat ${seatId} is now locked by another user`);
  }
}

export class BookingNotOwnedError extends MovieBookingError {
  constructor(bookingId: string, userId: string) {
    super(`Booking ${bookingId} does not belong to ${userId}`);
  }
}

export class PaymentFailedError extends MovieBookingError {
  constructor(bookingId: string, reason: string) {
    super(`Payment for booking ${bookingId} failed: ${reason}`);
  }
}

export class InvalidBookingTransitionError extends MovieBookingError {
  constructor(bookingId: string, from: string, to: string) {
    super(`Booking ${bookingId} cannot move from ${from} to ${to}`);
  }
}

export class ShowAlreadyStartedError extends MovieBookingError {
  constructor(showId: string) {
    super(`Show ${showId} has already started; bookings can no longer be cancelled`);
  }
}
