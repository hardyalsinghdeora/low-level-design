import { DomainError } from '../shared/errors';
import { formatMoney, type Money } from '../shared/money';

export class WalletError extends DomainError {}

export class InvalidAmountError extends WalletError {
  constructor(amount: number) {
    super(`Amount must be a positive integer number of paise, got ${amount}`);
  }
}

export class WalletNotFoundError extends WalletError {
  constructor(userId: string) {
    super(`No wallet for user ${userId}`);
  }
}

export class WalletAlreadyExistsError extends WalletError {
  constructor(userId: string) {
    super(`User ${userId} already has a wallet`);
  }
}

export class AccountNotFoundError extends WalletError {
  constructor(accountId: string) {
    super(`No ledger account ${accountId}`);
  }
}

export class SameWalletTransferError extends WalletError {
  constructor(userId: string) {
    super(`User ${userId} cannot transfer to their own wallet`);
  }
}

export class InsufficientBalanceError extends WalletError {
  constructor(accountId: string, balance: Money, required: Money) {
    super(`Account ${accountId} has ${formatMoney(balance)} but needs ${formatMoney(required)}`);
  }
}

export class DailyLimitExceededError extends WalletError {
  constructor(userId: string, type: string, requested: Money, limit: Money, usedToday: Money) {
    super(
      `${type} of ${formatMoney(requested)} exceeds ${userId}'s daily limit of ${formatMoney(limit)} ` +
        `(${formatMoney(usedToday)} already used today)`,
    );
  }
}

export class UnbalancedPostingError extends WalletError {
  constructor(transactionId: string, debits: Money, credits: Money) {
    super(`Posting for ${transactionId} is unbalanced: debits ${debits} != credits ${credits}`);
  }
}

/** Reconciliation found a cached balance that disagrees with the entries. Never expected; always a bug. */
export class LedgerIntegrityError extends WalletError {}

export class TransactionNotFoundError extends WalletError {
  constructor(transactionId: string) {
    super(`No transaction ${transactionId}`);
  }
}

export class InvalidTransactionStateError extends WalletError {
  constructor(transactionId: string, from: string, to: string) {
    super(`Transaction ${transactionId} cannot move from ${from} to ${to}`);
  }
}

export class TransactionNotReversibleError extends WalletError {
  constructor(transactionId: string, reason: string) {
    super(`Transaction ${transactionId} cannot be reversed: ${reason}`);
  }
}

export class IdempotencyKeyReusedError extends WalletError {
  constructor(key: string) {
    super(`Idempotency key "${key}" was already used for a different request`);
  }
}
