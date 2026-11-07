import { DomainError } from '../shared/errors';
import { formatMoney, type Money } from '../shared/money';

export class RestaurantError extends DomainError {}

export class TableNotFoundError extends RestaurantError {
  constructor(tableId: string) {
    super(`No table ${tableId}`);
  }
}

export class ReservationNotFoundError extends RestaurantError {
  constructor(reservationId: string) {
    super(`No reservation ${reservationId}`);
  }
}

export class ReservationConflictError extends RestaurantError {
  constructor(tableId: string, start: Date, end: Date) {
    super(`Table ${tableId} is already booked between ${start.toISOString()} and ${end.toISOString()}`);
  }
}

export class NoTableAvailableError extends RestaurantError {
  constructor(partySize: number, start: Date) {
    super(`No table for ${partySize} is free at ${start.toISOString()}`);
  }
}

export class PartyTooLargeError extends RestaurantError {
  constructor(tableId: string, capacity: number, partySize: number) {
    super(`Table ${tableId} seats ${capacity}, party of ${partySize} does not fit`);
  }
}

export class TableOccupiedError extends RestaurantError {
  constructor(tableId: string, orderId: string) {
    super(`Table ${tableId} already has open order ${orderId}`);
  }
}

export class MenuItemNotFoundError extends RestaurantError {
  constructor(itemId: string) {
    super(`No menu item ${itemId}`);
  }
}

export class MenuItemUnavailableError extends RestaurantError {
  constructor(name: string) {
    super(`${name} is not available right now`);
  }
}

export class OrderNotFoundError extends RestaurantError {
  constructor(orderId: string) {
    super(`No order ${orderId}`);
  }
}

/** One error for every state machine here: orders, kitchen tickets and reservations. */
export class InvalidTransitionError extends RestaurantError {
  constructor(entity: string, id: string, state: string, attempted: string) {
    super(`${entity} ${id} cannot ${attempted} while ${state}`);
  }
}

export class EmptyOrderError extends RestaurantError {
  constructor(orderId: string) {
    super(`Order ${orderId} has no items to send to the kitchen`);
  }
}

export class TicketsNotReadyError extends RestaurantError {
  constructor(orderId: string, pending: number) {
    super(`Order ${orderId} still has ${pending} kitchen ticket(s) not ready`);
  }
}

export class TicketNotFoundError extends RestaurantError {
  constructor(ticketId: string) {
    super(`No kitchen ticket ${ticketId}`);
  }
}

export class NothingToCookError extends RestaurantError {
  constructor(station: string) {
    super(`Station ${station} has no queued tickets`);
  }
}

export class NoWaiterOnDutyError extends RestaurantError {
  constructor() {
    super('No waiter is on duty to take the table');
  }
}

export class SplitMismatchError extends RestaurantError {}

export class PaymentMismatchError extends RestaurantError {
  constructor(orderId: string, expected: Money, received: Money) {
    super(`Order ${orderId} totals ${formatMoney(expected)}, received ${formatMoney(received)}`);
  }
}
