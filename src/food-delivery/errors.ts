import { DomainError } from '../shared/errors';
import type { FoodOrderStatus } from './food-order';

export class FoodDeliveryError extends DomainError {}

export class NotFoundError extends FoodDeliveryError {
  constructor(kind: string, id: string) {
    super(`No ${kind} ${id}`);
  }
}

export class RestaurantClosedError extends FoodDeliveryError {
  constructor(restaurantId: string, at: Date) {
    super(`Restaurant ${restaurantId} is closed at ${at.toISOString()}`);
  }
}

export class MenuItemUnavailableError extends FoodDeliveryError {
  constructor(restaurantId: string, itemId: string) {
    super(`Item ${itemId} is not available at ${restaurantId}`);
  }
}

export class InvalidQuantityError extends FoodDeliveryError {
  constructor(quantity: number) {
    super(`Quantity must be a positive integer, got ${quantity}`);
  }
}

export class InvalidOrderTransitionError extends FoodDeliveryError {
  constructor(orderId: string, from: FoodOrderStatus, to: FoodOrderStatus) {
    super(`Order ${orderId} cannot go from ${from} to ${to}`);
  }
}

export class UnauthorizedActorError extends FoodDeliveryError {
  constructor(orderId: string, actor: string, to: FoodOrderStatus) {
    super(`${actor} may not move order ${orderId} to ${to}`);
  }
}

export class PartnerUnavailableError extends FoodDeliveryError {
  constructor(partnerId: string, status: string) {
    super(`Partner ${partnerId} is ${status}`);
  }
}

export class NoPartnerAvailableError extends FoodDeliveryError {
  constructor(orderId: string) {
    super(`No delivery partner available for order ${orderId}`);
  }
}
