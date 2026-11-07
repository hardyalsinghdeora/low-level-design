import type { Money } from '../shared/money';

export interface Debt {
  readonly from: string;
  readonly to: string;
  readonly amount: Money;
}

/**
 * Pairwise net debts. Between any two people at most one direction is non-zero:
 * recording "B owes A 40" when A already owes B 100 leaves "A owes B 60".
 * It is a derived view, rebuilt from expenses and settlements, never edited by hand.
 */
export class BalanceSheet {
  private readonly owed = new Map<string, Map<string, Money>>();

  record(debtor: string, creditor: string, amount: Money): void {
    if (!Number.isInteger(amount) || amount < 0) throw new RangeError(`amount must be a non-negative integer, got ${amount}`);
    if (debtor === creditor || amount === 0) return;
    const reverse = this.owes(creditor, debtor);
    const offset = Math.min(reverse, amount);
    this.set(creditor, debtor, reverse - offset);
    this.set(debtor, creditor, this.owes(debtor, creditor) + amount - offset);
  }

  owes(debtor: string, creditor: string): Money {
    return this.owed.get(debtor)?.get(creditor) ?? 0;
  }

  /** Positive: the user is owed money overall. Negative: the user owes. */
  netBalance(userId: string): Money {
    return this.netBalances().get(userId) ?? 0;
  }

  /** Non-zero nets only, keyed by user id in sorted order. Always sums to zero. */
  netBalances(): Map<string, Money> {
    const nets = new Map<string, Money>();
    for (const { from, to, amount } of this.debts()) {
      nets.set(from, (nets.get(from) ?? 0) - amount);
      nets.set(to, (nets.get(to) ?? 0) + amount);
    }
    return new Map([...nets].filter(([, net]) => net !== 0).sort(([a], [b]) => a.localeCompare(b)));
  }

  debts(): Debt[] {
    const debts: Debt[] = [];
    for (const [from, row] of this.owed) for (const [to, amount] of row) debts.push({ from, to, amount });
    return debts.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  }

  /** Settled means every net is zero. Off-plan payments can leave a pairwise cycle whose nets cancel out. */
  get isSettled(): boolean {
    return this.netBalances().size === 0;
  }

  private set(debtor: string, creditor: string, amount: Money): void {
    const row = this.owed.get(debtor) ?? new Map<string, Money>();
    if (amount === 0) row.delete(creditor);
    else row.set(creditor, amount);
    if (row.size === 0) this.owed.delete(debtor);
    else this.owed.set(debtor, row);
  }
}
