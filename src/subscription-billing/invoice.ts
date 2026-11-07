import type { Money } from '../shared/money';
import { InvalidInvoiceTransitionError, InvoiceLockedError } from './errors';

export enum InvoiceStatus {
  DRAFT = 'DRAFT',
  OPEN = 'OPEN',
  PAID = 'PAID',
  VOID = 'VOID',
  UNCOLLECTIBLE = 'UNCOLLECTIBLE',
}

const TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  [InvoiceStatus.DRAFT]: [InvoiceStatus.OPEN, InvoiceStatus.VOID],
  [InvoiceStatus.OPEN]: [InvoiceStatus.PAID, InvoiceStatus.VOID, InvoiceStatus.UNCOLLECTIBLE],
  [InvoiceStatus.PAID]: [],
  [InvoiceStatus.VOID]: [],
  [InvoiceStatus.UNCOLLECTIBLE]: [],
};

/** Signed amount: charges are positive, credits (proration, account balance) negative. */
export interface LineItem {
  readonly description: string;
  readonly amount: Money;
}

/**
 * What a customer is asked to pay. Lines can only be added while DRAFT; once
 * finalized (OPEN) the total is fixed and only payment state changes. `key`
 * identifies what the invoice is for (a subscription period, a plan change) and is
 * what makes invoice generation idempotent.
 */
export class Invoice {
  private _status = InvoiceStatus.DRAFT;
  private readonly _lines: LineItem[] = [];
  private _attempts = 0;
  private _firstFailedAt: Date | undefined;
  private _nextAttemptAt: Date | undefined;
  private _paidAt: Date | undefined;

  constructor(
    readonly id: string,
    readonly key: string,
    readonly subscriptionId: string,
    readonly customerId: string,
    readonly createdAt: Date,
  ) {}

  get status(): InvoiceStatus {
    return this._status;
  }

  get lines(): readonly LineItem[] {
    return this._lines;
  }

  get total(): Money {
    return this._lines.reduce((sum, line) => sum + line.amount, 0);
  }

  get attempts(): number {
    return this._attempts;
  }

  get firstFailedAt(): Date | undefined {
    return this._firstFailedAt;
  }

  get nextAttemptAt(): Date | undefined {
    return this._nextAttemptAt;
  }

  get paidAt(): Date | undefined {
    return this._paidAt;
  }

  addLine(line: LineItem): void {
    if (this._status !== InvoiceStatus.DRAFT) throw new InvoiceLockedError(this.id);
    if (!Number.isInteger(line.amount)) throw new RangeError(`line amount must be an integer, got ${line.amount}`);
    this._lines.push(line);
  }

  finalize(): void {
    if (this.total < 0) throw new RangeError(`invoice ${this.id} total ${this.total} is negative; move the credit to the balance first`);
    this.transition(InvoiceStatus.OPEN);
  }

  recordAttempt(): number {
    if (this._status !== InvoiceStatus.OPEN) throw new InvalidInvoiceTransitionError(this.id, this._status, 'payment attempt');
    this._attempts += 1;
    return this._attempts;
  }

  markPaid(at: Date): void {
    this.transition(InvoiceStatus.PAID);
    this._paidAt = at;
    this._nextAttemptAt = undefined;
  }

  recordFailure(at: Date, nextAttemptAt: Date | undefined): void {
    this._firstFailedAt ??= at;
    this._nextAttemptAt = nextAttemptAt;
  }

  void(): void {
    this.transition(InvoiceStatus.VOID);
    this._nextAttemptAt = undefined;
  }

  markUncollectible(): void {
    this.transition(InvoiceStatus.UNCOLLECTIBLE);
    this._nextAttemptAt = undefined;
  }

  private transition(to: InvoiceStatus): void {
    if (!TRANSITIONS[this._status].includes(to)) throw new InvalidInvoiceTransitionError(this.id, this._status, to);
    this._status = to;
  }
}
