import type { Money } from '../shared/money';
import type { Debt } from './balance-sheet';
import { InvalidAmountError, InvalidSplitError } from './errors';
import type { SplitType } from './strategies/split';

/**
 * One payment shared by several people. Immutable: an edit produces a new
 * version with the same id, which is what makes "recompute balances" safe and
 * gives optimistic concurrency a version number to check.
 */
export class Expense {
  private readonly _shares: Map<string, Money>;

  constructor(
    readonly id: string,
    readonly description: string,
    readonly paidBy: string,
    readonly amount: Money,
    readonly splitType: SplitType,
    shares: ReadonlyMap<string, Money>,
    readonly groupId: string | undefined,
    readonly createdAt: Date,
    readonly version = 1,
  ) {
    if (!Number.isInteger(amount) || amount <= 0) throw new InvalidAmountError(amount);
    if (!description.trim()) throw new InvalidSplitError('An expense needs a description');
    const total = [...shares.values()].reduce((sum, share) => sum + share, 0);
    if (total !== amount) throw new InvalidSplitError(`Shares add up to ${total}, expected ${amount}`);
    this._shares = new Map(shares);
  }

  get shares(): ReadonlyMap<string, Money> {
    return this._shares;
  }

  get participantIds(): string[] {
    return [...this._shares.keys()];
  }

  shareOf(userId: string): Money {
    return this._shares.get(userId) ?? 0;
  }

  /** Everyone except the payer owes the payer their share; the payer's own share is not a debt. */
  debts(): Debt[] {
    return [...this._shares]
      .filter(([userId, share]) => userId !== this.paidBy && share > 0)
      .map(([userId, share]) => ({ from: userId, to: this.paidBy, amount: share }));
  }
}
