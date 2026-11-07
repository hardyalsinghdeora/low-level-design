import type { Money } from '../shared/money';

export enum EntryDirection {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT',
}

/** One line of a posting request, before the Ledger has accepted it. */
export interface PostingLine {
  accountId: string;
  direction: EntryDirection;
  amount: Money;
}

/**
 * An accepted ledger line. Entries are append-only: they are never edited or
 * deleted, and a mistake is corrected by posting compensating entries
 * (a reversal), so the history always explains every balance.
 */
export class LedgerEntry {
  constructor(
    readonly id: string,
    readonly transactionId: string,
    readonly accountId: string,
    readonly direction: EntryDirection,
    readonly amount: Money,
    readonly postedAt: Date,
  ) {}

  /** Debits count positive and credits negative, so every balanced posting sums to zero. */
  get signedAmount(): Money {
    return this.direction === EntryDirection.DEBIT ? this.amount : -this.amount;
  }
}
