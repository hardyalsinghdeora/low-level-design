import { DomainError } from '../shared/errors';
import type { Money } from '../shared/money';

/** The current state does not allow this action (e.g. dispensing before paying). */
export class InvalidActionError extends DomainError {
  constructor(
    readonly state: string,
    readonly action: string,
  ) {
    super(`Cannot ${action} while the machine is ${state}`);
  }
}

export class InvalidStateTransitionError extends DomainError {
  constructor(from: string, to: string) {
    super(`Illegal state transition ${from} -> ${to}`);
  }
}

export class InvalidDenominationError extends DomainError {
  constructor(readonly denomination: Money) {
    super(`Denomination ${denomination} is not accepted`);
  }
}

export class ProductNotFoundError extends DomainError {
  constructor(slotCode: string) {
    super(`No slot with code ${slotCode}`);
  }
}

export class ProductOutOfStockError extends DomainError {
  constructor(slotCode: string) {
    super(`Slot ${slotCode} is empty`);
  }
}

export class InsufficientFundsError extends DomainError {
  constructor(
    readonly price: Money,
    readonly inserted: Money,
  ) {
    super(`Price is ${price} but only ${inserted} was inserted`);
  }
}

/** Change cannot be made from the coin stock; the inserted coins are handed back in `refund`. */
export class InsufficientChangeError extends DomainError {
  constructor(
    readonly changeDue: Money,
    readonly refund: readonly Money[],
  ) {
    super(`Cannot return change of ${changeDue}; refunding the inserted coins`);
  }
}

export class SlotCapacityExceededError extends DomainError {
  constructor(slotCode: string, capacity: number) {
    super(`Slot ${slotCode} holds at most ${capacity} items`);
  }
}
