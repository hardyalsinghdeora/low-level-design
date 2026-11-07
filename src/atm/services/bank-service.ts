import { createHash, randomBytes } from 'node:crypto';
import { Clock, SystemClock } from '../../shared/clock';
import { IdGenerator, UuidGenerator } from '../../shared/id-generator';
import { assertMoney, type Money } from '../../shared/money';
import { Account, TransactionType, type Transaction } from '../account';
import type { Card } from '../card';
import {
  CardBlockedError,
  CardNotFoundError,
  DailyLimitExceededError,
  InvalidPinError,
  InvalidReversalError,
} from '../errors';

/**
 * What the ATM needs from the bank. In production this is a network call
 * (ISO 8583 to the switch); the ATM only depends on the interface.
 */
export interface BankService {
  /** Returns the account id behind the card, or throws InvalidPinError / CardBlockedError. */
  authenticate(cardNumber: string, pin: string): string;
  balance(accountId: string): Money;
  /** Idempotent on requestId: a retried request returns the original transaction. */
  withdraw(accountId: string, amount: Money, requestId: string): Transaction;
  deposit(accountId: string, amount: Money, requestId: string): Transaction;
  reverse(transactionId: string): Transaction;
  statement(accountId: string, last: number): Transaction[];
}

export interface InMemoryBankOptions {
  dailyWithdrawalLimit: Money;
  maxPinAttempts?: number;
  clock?: Clock;
  ids?: IdGenerator;
}

interface CardRecord {
  accountId: string;
  salt: string;
  pinHash: string;
  failedAttempts: number;
  blocked: boolean;
}

function hashPin(salt: string, pin: string): string {
  return createHash('sha256').update(`${salt}:${pin}`).digest('hex');
}

/** In-memory bank: accounts, PIN verification with lockout, daily limits, ledger and reversals. */
export class InMemoryBankService implements BankService {
  private readonly accounts = new Map<string, Account>();
  private readonly cards = new Map<string, CardRecord>();
  private readonly ledger: Transaction[] = [];
  private readonly byRequestId = new Map<string, Transaction>();
  private readonly reversed = new Set<string>();
  private readonly withdrawnByDay = new Map<string, Money>();
  private readonly maxPinAttempts: number;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  constructor(private readonly options: InMemoryBankOptions) {
    this.maxPinAttempts = options.maxPinAttempts ?? 3;
    this.clock = options.clock ?? new SystemClock();
    this.ids = options.ids ?? new UuidGenerator();
  }

  openAccount(account: Account): this {
    this.accounts.set(account.id, account);
    return this;
  }

  registerCard(card: Card, accountId: string, pin: string, salt = randomBytes(8).toString('hex')): this {
    this.account(accountId);
    this.cards.set(card.number, { accountId, salt, pinHash: hashPin(salt, pin), failedAttempts: 0, blocked: false });
    return this;
  }

  authenticate(cardNumber: string, pin: string): string {
    const record = this.cards.get(cardNumber);
    if (!record) throw new CardNotFoundError(cardNumber);
    if (record.blocked) throw new CardBlockedError(cardNumber);
    if (hashPin(record.salt, pin) === record.pinHash) {
      record.failedAttempts = 0;
      return record.accountId;
    }
    record.failedAttempts += 1;
    if (record.failedAttempts >= this.maxPinAttempts) {
      record.blocked = true;
      throw new CardBlockedError(cardNumber);
    }
    throw new InvalidPinError(this.maxPinAttempts - record.failedAttempts);
  }

  balance(accountId: string): Money {
    return this.account(accountId).balance;
  }

  withdraw(accountId: string, amount: Money, requestId: string): Transaction {
    const replay = this.byRequestId.get(requestId);
    if (replay) return replay;
    assertMoney(amount);
    const account = this.account(accountId);
    const key = this.dayKey(accountId);
    const today = this.withdrawnByDay.get(key) ?? 0;
    if (today + amount > this.options.dailyWithdrawalLimit) {
      throw new DailyLimitExceededError(this.options.dailyWithdrawalLimit, today);
    }
    account.debit(amount);
    this.withdrawnByDay.set(key, today + amount);
    return this.record(account, TransactionType.WITHDRAWAL, amount, requestId);
  }

  deposit(accountId: string, amount: Money, requestId: string): Transaction {
    const replay = this.byRequestId.get(requestId);
    if (replay) return replay;
    const account = this.account(accountId);
    account.credit(amount);
    return this.record(account, TransactionType.DEPOSIT, amount, requestId);
  }

  /** Compensating entry for a withdrawal whose cash never left the machine. */
  reverse(transactionId: string): Transaction {
    const original = this.ledger.find((t) => t.id === transactionId);
    if (!original) throw new InvalidReversalError(transactionId, 'not found');
    if (original.type !== TransactionType.WITHDRAWAL) throw new InvalidReversalError(transactionId, 'not a withdrawal');
    if (this.reversed.has(transactionId)) throw new InvalidReversalError(transactionId, 'already reversed');
    const account = this.account(original.accountId);
    account.credit(original.amount);
    const key = this.dayKey(account.id, original.at);
    this.withdrawnByDay.set(key, (this.withdrawnByDay.get(key) ?? 0) - original.amount);
    this.reversed.add(transactionId);
    return this.record(account, TransactionType.REVERSAL, original.amount, `REV:${transactionId}`, transactionId);
  }

  /** Newest first. */
  statement(accountId: string, last: number): Transaction[] {
    return this.ledger
      .filter((t) => t.accountId === accountId)
      .slice(-last)
      .reverse();
  }

  private account(id: string): Account {
    const account = this.accounts.get(id);
    if (!account) throw new RangeError(`Unknown account ${id}`);
    return account;
  }

  private dayKey(accountId: string, at: Date = this.clock.now()): string {
    return `${accountId}:${at.toISOString().slice(0, 10)}`;
  }

  private record(
    account: Account,
    type: TransactionType,
    amount: Money,
    requestId: string,
    reverses?: string,
  ): Transaction {
    const tx: Transaction = {
      id: this.ids.next('TXN'),
      accountId: account.id,
      type,
      amount,
      balanceAfter: account.balance,
      at: this.clock.now(),
      ...(reverses ? { reverses } : {}),
    };
    this.ledger.push(tx);
    this.byRequestId.set(requestId, tx);
    return tx;
  }
}
