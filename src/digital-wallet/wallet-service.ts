import { Clock, SystemClock } from '../shared/clock';
import { DomainError } from '../shared/errors';
import { IdGenerator, UuidGenerator } from '../shared/id-generator';
import type { Money } from '../shared/money';
import { type Account, AccountType } from './account';
import {
  DailyLimitExceededError,
  InvalidAmountError,
  SameWalletTransferError,
  TransactionNotFoundError,
  TransactionNotReversibleError,
  WalletAlreadyExistsError,
  WalletNotFoundError,
} from './errors';
import { IdempotencyStore } from './idempotency-store';
import { Ledger } from './ledger';
import { EntryDirection, type PostingLine } from './ledger-entry';
import { type DailyLimitPolicy, NoDailyLimitPolicy, startOfUtcDay } from './strategies/daily-limit';
import { type FeePolicy, NoFeePolicy } from './strategies/fee';
import { Transaction, type TransactionDetails, TransactionStatus, TransactionType } from './transaction';

export const BANK_CLEARING_ACCOUNT_ID = 'BANK_CLEARING';
export const FEES_ACCOUNT_ID = 'FEES';

export interface WalletServiceOptions {
  clock?: Clock;
  ids?: IdGenerator;
  feePolicy?: FeePolicy;
  limitPolicy?: DailyLimitPolicy;
}

export interface TopUpRequest {
  userId: string;
  amount: Money;
  idempotencyKey: string;
}

export interface TransferRequest {
  fromUserId: string;
  toUserId: string;
  amount: Money;
  idempotencyKey: string;
}

export interface WithdrawalRequest {
  userId: string;
  amount: Money;
  idempotencyKey: string;
}

export interface ReversalRequest {
  transactionId: string;
  idempotencyKey: string;
}

export interface HistoryQuery {
  limit?: number;
  /** `nextCursor` from the previous page. */
  cursor?: string;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

interface PreparedTransaction {
  details: TransactionDetails;
  lines: PostingLine[];
}

function positiveAmount(amount: Money): Money {
  if (!Number.isInteger(amount) || amount <= 0) throw new InvalidAmountError(amount);
  return amount;
}

/**
 * Aggregate root for wallets. Every movement is a Transaction that posts
 * balanced entries to the Ledger; this class adds the rules around posting:
 * idempotency, daily limits, fees and reversals. It is the only writer of the
 * ledger, so the zero-sum invariant has exactly one gate.
 */
export class WalletService {
  readonly ledger = new Ledger();
  private readonly walletByUser = new Map<string, Account>();
  private readonly transactions = new Map<string, Transaction>();
  private readonly historyByAccount = new Map<string, Transaction[]>();
  private readonly idempotency = new IdempotencyStore();
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly feePolicy: FeePolicy;
  private readonly limitPolicy: DailyLimitPolicy;
  private sequence = 0;

  constructor(options: WalletServiceOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.ids = options.ids ?? new UuidGenerator();
    this.feePolicy = options.feePolicy ?? new NoFeePolicy();
    this.limitPolicy = options.limitPolicy ?? new NoDailyLimitPolicy();
    this.ledger.openAccount(BANK_CLEARING_ACCOUNT_ID, AccountType.BANK_CLEARING);
    this.ledger.openAccount(FEES_ACCOUNT_ID, AccountType.FEES);
  }

  openWallet(userId: string): Account {
    if (this.walletByUser.has(userId)) throw new WalletAlreadyExistsError(userId);
    const wallet = this.ledger.openAccount(this.ids.next('WAL'), AccountType.USER_WALLET, userId);
    this.walletByUser.set(userId, wallet);
    return wallet;
  }

  walletOf(userId: string): Account {
    const wallet = this.walletByUser.get(userId);
    if (!wallet) throw new WalletNotFoundError(userId);
    return wallet;
  }

  balanceOf(userId: string): Money {
    return this.walletOf(userId).balance;
  }

  transaction(id: string): Transaction {
    const transaction = this.transactions.get(id);
    if (!transaction) throw new TransactionNotFoundError(id);
    return transaction;
  }

  /** Money arrives from the user's bank: debit clearing (our asset grows), credit the wallet. */
  topUp(request: TopUpRequest): Transaction {
    const fingerprint = [TransactionType.TOP_UP, request.userId, request.amount];
    return this.execute(request.idempotencyKey, fingerprint, () => {
      const wallet = this.walletOf(request.userId);
      const bank = this.ledger.account(BANK_CLEARING_ACCOUNT_ID);
      return this.prepare(TransactionType.TOP_UP, request.userId, bank, wallet, positiveAmount(request.amount));
    });
  }

  transfer(request: TransferRequest): Transaction {
    const fingerprint = [TransactionType.TRANSFER, request.fromUserId, request.toUserId, request.amount];
    return this.execute(request.idempotencyKey, fingerprint, () => {
      if (request.fromUserId === request.toUserId) throw new SameWalletTransferError(request.fromUserId);
      const from = this.walletOf(request.fromUserId);
      const to = this.walletOf(request.toUserId);
      return this.prepare(TransactionType.TRANSFER, request.fromUserId, from, to, positiveAmount(request.amount));
    });
  }

  /** Money leaves to the user's bank: debit the wallet, credit clearing. */
  withdraw(request: WithdrawalRequest): Transaction {
    const fingerprint = [TransactionType.WITHDRAWAL, request.userId, request.amount];
    return this.execute(request.idempotencyKey, fingerprint, () => {
      const wallet = this.walletOf(request.userId);
      const bank = this.ledger.account(BANK_CLEARING_ACCOUNT_ID);
      return this.prepare(TransactionType.WITHDRAWAL, request.userId, wallet, bank, positiveAmount(request.amount));
    });
  }

  /**
   * Compensating entries: every line of the original with debit and credit
   * swapped (the fee is refunded too). Nothing is deleted, so the history
   * still shows what happened and when it was undone.
   */
  reverse(request: ReversalRequest): Transaction {
    const fingerprint = [TransactionType.REVERSAL, request.transactionId];
    return this.execute(request.idempotencyKey, fingerprint, () => {
      const original = this.transaction(request.transactionId);
      if (original.type === TransactionType.REVERSAL) {
        throw new TransactionNotReversibleError(original.id, 'a reversal is never reversed; post a new transaction');
      }
      original.assertCanTransitionTo(TransactionStatus.REVERSED);
      const lines = this.ledger.entriesFor(original.id).map((entry) => ({
        accountId: entry.accountId,
        direction: entry.direction === EntryDirection.DEBIT ? EntryDirection.CREDIT : EntryDirection.DEBIT,
        amount: entry.amount,
      }));
      const details: TransactionDetails = {
        type: TransactionType.REVERSAL,
        initiatedBy: null,
        fromAccountId: original.toAccountId,
        toAccountId: original.fromAccountId,
        amount: original.amount,
        fee: original.fee,
        reversalOf: original.id,
      };
      return { details, lines };
    });
  }

  /** Newest first, keyset-paginated on the transaction sequence so new activity never shifts a page. */
  history(userId: string, query: HistoryQuery = {}): Page<Transaction> {
    const limit = query.limit ?? 20;
    if (!Number.isInteger(limit) || limit <= 0) throw new RangeError(`limit must be a positive integer, got ${limit}`);
    const before = query.cursor === undefined ? Number.POSITIVE_INFINITY : Number(query.cursor);
    if (Number.isNaN(before)) throw new RangeError(`Invalid cursor ${query.cursor}`);

    const newestFirst = (this.historyByAccount.get(this.walletOf(userId).id) ?? [])
      .filter((txn) => txn.sequence < before)
      .reverse();
    const items = newestFirst.slice(0, limit);
    const hasMore = newestFirst.length > limit;
    return { items, nextCursor: hasMore ? String(items[items.length - 1].sequence) : undefined };
  }

  private prepare(
    type: TransactionType,
    initiatedBy: string,
    from: Account,
    to: Account,
    amount: Money,
  ): PreparedTransaction {
    const fee = this.feePolicy.feeFor(type, amount);
    const lines: PostingLine[] = [
      { accountId: from.id, direction: EntryDirection.DEBIT, amount: amount + fee },
      { accountId: to.id, direction: EntryDirection.CREDIT, amount },
    ];
    if (fee > 0) lines.push({ accountId: FEES_ACCOUNT_ID, direction: EntryDirection.CREDIT, amount: fee });
    const details = { type, initiatedBy, fromAccountId: from.id, toAccountId: to.id, amount, fee, reversalOf: null };
    return { details, lines };
  }

  /**
   * The only place a transaction is created and posted. A replayed key returns
   * the stored outcome without touching the ledger. A business-rule failure
   * leaves a FAILED transaction with no entries, then rethrows.
   */
  private execute(
    idempotencyKey: string,
    request: ReadonlyArray<string | number>,
    prepare: () => PreparedTransaction,
  ): Transaction {
    if (!idempotencyKey.trim()) throw new RangeError('idempotencyKey is required');
    const fingerprint = JSON.stringify(request);
    const previous = this.idempotency.lookup(idempotencyKey, fingerprint);
    if (previous) {
      if (previous.error) throw previous.error;
      return this.transaction(previous.transactionId);
    }

    // Malformed requests (unknown wallet, bad amount, nothing to reverse) throw here, before
    // anything is stored, so the client can fix the request and retry with the same key.
    const { details, lines } = prepare();
    const now = this.clock.now();
    const txn = new Transaction(this.ids.next('TXN'), ++this.sequence, details, now);
    this.record(txn);
    try {
      this.enforceDailyLimit(txn);
      this.ledger.post(txn.id, lines, now);
      txn.complete(now);
      if (txn.reversalOf) this.transaction(txn.reversalOf).markReversed(txn.id, now);
      this.idempotency.save(idempotencyKey, fingerprint, txn.id);
      return txn;
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      txn.fail(error.message, now);
      this.idempotency.save(idempotencyKey, fingerprint, txn.id, error);
      throw error;
    }
  }

  private record(txn: Transaction): void {
    this.transactions.set(txn.id, txn);
    for (const accountId of new Set([txn.fromAccountId, txn.toAccountId])) {
      const list = this.historyByAccount.get(accountId) ?? [];
      list.push(txn);
      this.historyByAccount.set(accountId, list);
    }
  }

  private enforceDailyLimit(txn: Transaction): void {
    if (txn.initiatedBy === null) return;
    const limit = this.limitPolicy.limitFor(txn.initiatedBy, txn.type);
    if (limit === undefined) return;
    const used = this.usedToday(txn.initiatedBy, txn.type, txn.createdAt);
    if (used + txn.amount > limit) {
      throw new DailyLimitExceededError(txn.initiatedBy, txn.type, txn.amount, limit, used);
    }
  }

  /** Completed movements of `type` the user started since 00:00 UTC. Reversed ones no longer count. */
  private usedToday(userId: string, type: TransactionType, now: Date): Money {
    const dayStart = startOfUtcDay(now).getTime();
    return (this.historyByAccount.get(this.walletOf(userId).id) ?? [])
      .filter(
        (txn) =>
          txn.initiatedBy === userId &&
          txn.type === type &&
          txn.status === TransactionStatus.COMPLETED &&
          txn.createdAt.getTime() >= dayStart,
      )
      .reduce((sum, txn) => sum + txn.amount, 0);
  }
}
