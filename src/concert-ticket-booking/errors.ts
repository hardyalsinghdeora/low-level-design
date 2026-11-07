import { DomainError } from '../shared/errors';

export class ConcertBookingError extends DomainError {}

export class EventNotFoundError extends ConcertBookingError {
  constructor(eventId: string) {
    super(`No event ${eventId}`);
  }
}

export class CategoryNotFoundError extends ConcertBookingError {
  constructor(eventId: string, tier: string) {
    super(`Event ${eventId} has no ${tier} category`);
  }
}

export class InvalidEventTransitionError extends ConcertBookingError {
  constructor(eventId: string, from: string, to: string) {
    super(`Event ${eventId} cannot move from ${from} to ${to}`);
  }
}

export class EventNotOnSaleError extends ConcertBookingError {
  constructor(eventId: string, status: string) {
    super(`Event ${eventId} is ${status}, not ON_SALE`);
  }
}

export class InvalidOrderError extends ConcertBookingError {}

export class InsufficientInventoryError extends ConcertBookingError {
  constructor(tier: string, requested: number, available: number) {
    super(`${tier}: requested ${requested}, only ${available} left`);
  }
}

export class SeatTakenError extends ConcertBookingError {
  constructor(seatId: string) {
    super(`Seat ${seatId} is not available`);
  }
}

export class PurchaseLimitExceededError extends ConcertBookingError {
  constructor(userId: string, limit: number, wouldHold: number) {
    super(`${userId} would hold ${wouldHold} tickets; the limit per user is ${limit}`);
  }
}

export class OrderNotFoundError extends ConcertBookingError {
  constructor(orderId: string) {
    super(`No order ${orderId}`);
  }
}

export class InvalidOrderTransitionError extends ConcertBookingError {
  constructor(orderId: string, from: string, to: string) {
    super(`Order ${orderId} cannot move from ${from} to ${to}`);
  }
}

export class OrderNotCancellableError extends ConcertBookingError {
  constructor(orderId: string) {
    super(`Order ${orderId} can no longer be cancelled: the event has started`);
  }
}

export class CategoryNotSoldOutError extends ConcertBookingError {
  constructor(tier: string) {
    super(`${tier} still has enough tickets; buy them instead of joining the waitlist`);
  }
}

export class OfferNotFoundError extends ConcertBookingError {
  constructor(offerId: string) {
    super(`No pending offer ${offerId} for this user`);
  }
}

export class OfferExpiredError extends ConcertBookingError {
  constructor(offerId: string) {
    super(`Offer ${offerId} has expired and was passed to the next person in line`);
  }
}
