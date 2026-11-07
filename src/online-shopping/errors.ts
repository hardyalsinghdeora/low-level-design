import { DomainError } from '../shared/errors';
import type { OrderStatus } from './order';

export class ShopError extends DomainError {}

export class ProductNotFoundError extends ShopError {
  constructor(productId: string) {
    super(`No product ${productId}`);
  }
}

export class InvalidQuantityError extends ShopError {
  constructor(quantity: number) {
    super(`Quantity must be a positive integer, got ${quantity}`);
  }
}

export class EmptyCartError extends ShopError {
  constructor(customerId: string) {
    super(`Cart of ${customerId} is empty`);
  }
}

export class InsufficientStockError extends ShopError {
  constructor(
    readonly productId: string,
    readonly requested: number,
    readonly available: number,
  ) {
    super(`Only ${available} of ${productId} available, ${requested} requested`);
  }
}

/** Releasing or committing more than was reserved means a bug upstream, not a customer mistake. */
export class StockReservationError extends ShopError {
  constructor(productId: string, quantity: number, reserved: number) {
    super(`Cannot settle ${quantity} of ${productId}: only ${reserved} reserved`);
  }
}

export class OrderNotFoundError extends ShopError {
  constructor(orderId: string) {
    super(`No order ${orderId}`);
  }
}

export class InvalidOrderTransitionError extends ShopError {
  constructor(orderId: string, from: OrderStatus, to: OrderStatus) {
    super(`Order ${orderId} cannot go from ${from} to ${to}`);
  }
}

export class PaymentDeclinedError extends ShopError {
  constructor(method: string, reason: string) {
    super(`${method} payment declined: ${reason}`);
  }
}

export class CouponNotFoundError extends ShopError {
  constructor(code: string) {
    super(`No coupon ${code}`);
  }
}

export class CouponNotApplicableError extends ShopError {
  constructor(code: string, reason: string) {
    super(`Coupon ${code} does not apply: ${reason}`);
  }
}

export class CouponStackingError extends ShopError {
  constructor(reason: string) {
    super(`Coupons cannot be combined: ${reason}`);
  }
}

export class IdempotencyKeyReusedError extends ShopError {
  constructor(key: string) {
    super(`Idempotency key ${key} was already used for a different request`);
  }
}

export class ReturnWindowExpiredError extends ShopError {
  constructor(orderId: string, days: number) {
    super(`Order ${orderId} was delivered more than ${days} days ago`);
  }
}
