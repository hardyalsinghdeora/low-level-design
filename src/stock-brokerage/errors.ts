import { DomainError } from '../shared/errors';
import { formatMoney, type Money } from '../shared/money';

export class BrokerageError extends DomainError {}

export class AccountNotFoundError extends BrokerageError {
  constructor(userId: string) {
    super(`No account for ${userId}`);
  }
}

export class DuplicateAccountError extends BrokerageError {
  constructor(userId: string) {
    super(`Account ${userId} already exists`);
  }
}

export class UnknownSymbolError extends BrokerageError {
  constructor(symbol: string) {
    super(`Symbol ${symbol} is not listed`);
  }
}

export class OrderNotFoundError extends BrokerageError {
  constructor(orderId: string) {
    super(`No order ${orderId}`);
  }
}

/** The order request itself is malformed: bad quantity, missing or unexpected limit price. */
export class InvalidOrderError extends BrokerageError {}

export class InvalidOrderTransitionError extends BrokerageError {
  constructor(orderId: string, from: string, to: string) {
    super(`Order ${orderId} cannot go from ${from} to ${to}`);
  }
}

export class InsufficientFundsError extends BrokerageError {
  constructor(userId: string, available: Money, required: Money) {
    super(`${userId} has ${formatMoney(available)} available but the order needs ${formatMoney(required)}`);
  }
}

export class InsufficientHoldingsError extends BrokerageError {
  constructor(userId: string, symbol: string, available: number, required: number) {
    super(`${userId} has ${available} ${symbol} available to sell but the order needs ${required}`);
  }
}
