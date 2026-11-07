import { DomainError } from '../shared/errors';
import type { Money } from '../shared/money';

export class InvalidAtmOperationError extends DomainError {
  constructor(state: string, operation: string) {
    super(`Cannot ${operation} while the ATM is ${state}`);
  }
}

export class InvalidAtmTransitionError extends DomainError {
  constructor(from: string, to: string) {
    super(`Illegal ATM transition ${from} -> ${to}`);
  }
}

export class CardNotFoundError extends DomainError {
  constructor(cardNumber: string) {
    super(`Card ${cardNumber} is not registered`);
  }
}

export class CardExpiredError extends DomainError {
  constructor(cardNumber: string) {
    super(`Card ${cardNumber} has expired`);
  }
}

export class InvalidPinError extends DomainError {
  constructor(readonly attemptsLeft: number) {
    super(`Incorrect PIN, ${attemptsLeft} attempt(s) left`);
  }
}

export class CardBlockedError extends DomainError {
  constructor(cardNumber: string) {
    super(`Card ${cardNumber} is blocked after too many incorrect PINs`);
  }
}

export class InsufficientFundsError extends DomainError {
  constructor(accountId: string, balance: Money, amount: Money) {
    super(`Account ${accountId} has ${balance}, cannot withdraw ${amount}`);
  }
}

export class DailyLimitExceededError extends DomainError {
  constructor(
    readonly limit: Money,
    readonly alreadyWithdrawn: Money,
  ) {
    super(`Daily limit ${limit} reached (${alreadyWithdrawn} already withdrawn today)`);
  }
}

export class InsufficientCashError extends DomainError {
  constructor(requested: Money, available: Money) {
    super(`ATM holds ${available}, cannot dispense ${requested}`);
  }
}

/** The notes in the cassettes cannot add up to the amount (e.g. Rs 150 with Rs 100 as the smallest note). */
export class UnmakeableAmountError extends DomainError {
  constructor(amount: Money) {
    super(`Amount ${amount} cannot be made from the available notes`);
  }
}

export class InvalidReversalError extends DomainError {
  constructor(transactionId: string, reason: string) {
    super(`Cannot reverse ${transactionId}: ${reason}`);
  }
}

export class InvalidDenominationError extends DomainError {
  constructor(denomination: Money) {
    super(`Note of ${denomination} is not accepted`);
  }
}
