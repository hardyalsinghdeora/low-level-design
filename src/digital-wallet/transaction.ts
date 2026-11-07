import type { Money } from '../shared/money';
import { InvalidTransactionStateError } from './errors';

export enum TransactionType {
  TOP_UP = 'TOP_UP',
  TRANSFER = 'TRANSFER',
  WITHDRAWAL = 'WITHDRAWAL',
  REVERSAL = 'REVERSAL',
}

export enum TransactionStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REVERSED = 'REVERSED',
}

const ALLOWED_TRANSITIONS: Record<TransactionStatus, readonly TransactionStatus[]> = {
  [TransactionStatus.PENDING]: [TransactionStatus.COMPLETED, TransactionStatus.FAILED],
  [TransactionStatus.COMPLETED]: [TransactionStatus.REVERSED],
  [TransactionStatus.FAILED]: [],
  [TransactionStatus.REVERSED]: [],
};

export interface TransactionDetails {
  type: TransactionType;
  /** The user who asked for it; null for operator actions such as reversals. */
  initiatedBy: string | null;
  /** The account debited (for a top-up, the bank clearing account). */
  fromAccountId: string;
  /** The account credited (for a withdrawal, the bank clearing account). */
  toAccountId: string;
  amount: Money;
  fee: Money;
  reversalOf: string | null;
}

/**
 * The business view of one money movement and its lifecycle. The ledger
 * entries it posts are the financial truth; the transaction says why they
 * exist and whether they were later compensated. PENDING is the window between
 * "accepted" and "posted", which in production spans a bank or card call.
 */
export class Transaction {
  readonly type: TransactionType;
  readonly initiatedBy: string | null;
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly amount: Money;
  readonly fee: Money;
  readonly reversalOf: string | null;
  private _status = TransactionStatus.PENDING;
  private _failureReason: string | null = null;
  private _reversedBy: string | null = null;
  private _updatedAt: Date;

  constructor(
    readonly id: string,
    /** Monotonic position, used as a stable keyset-pagination cursor. */
    readonly sequence: number,
    details: TransactionDetails,
    readonly createdAt: Date,
  ) {
    this.type = details.type;
    this.initiatedBy = details.initiatedBy;
    this.fromAccountId = details.fromAccountId;
    this.toAccountId = details.toAccountId;
    this.amount = details.amount;
    this.fee = details.fee;
    this.reversalOf = details.reversalOf;
    this._updatedAt = createdAt;
  }

  get status(): TransactionStatus {
    return this._status;
  }

  get failureReason(): string | null {
    return this._failureReason;
  }

  get reversedBy(): string | null {
    return this._reversedBy;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  canTransitionTo(next: TransactionStatus): boolean {
    return ALLOWED_TRANSITIONS[this._status].includes(next);
  }

  assertCanTransitionTo(next: TransactionStatus): void {
    if (!this.canTransitionTo(next)) throw new InvalidTransactionStateError(this.id, this._status, next);
  }

  complete(at: Date): void {
    this.transitionTo(TransactionStatus.COMPLETED, at);
  }

  fail(reason: string, at: Date): void {
    this.transitionTo(TransactionStatus.FAILED, at);
    this._failureReason = reason;
  }

  markReversed(reversalId: string, at: Date): void {
    this.transitionTo(TransactionStatus.REVERSED, at);
    this._reversedBy = reversalId;
  }

  private transitionTo(next: TransactionStatus, at: Date): void {
    this.assertCanTransitionTo(next);
    this._status = next;
    this._updatedAt = at;
  }
}
