import { assertMoney, type Money } from '../shared/money';
import { InsufficientFundsError } from './errors';

export enum TransactionType {
  WITHDRAWAL = 'WITHDRAWAL',
  DEPOSIT = 'DEPOSIT',
  REVERSAL = 'REVERSAL',
}

export interface Transaction {
  id: string;
  accountId: string;
  type: TransactionType;
  amount: Money;
  balanceAfter: Money;
  at: Date;
  /** For a REVERSAL, the withdrawal it undoes. */
  reverses?: string;
}

/** A bank account. It refuses to go negative; every limit beyond that is bank policy. */
export class Account {
  private balanceMinor: Money;

  constructor(
    readonly id: string,
    readonly owner: string,
    openingBalance: Money = 0,
  ) {
    assertMoney(openingBalance, 'opening balance');
    this.balanceMinor = openingBalance;
  }

  get balance(): Money {
    return this.balanceMinor;
  }

  debit(amount: Money): void {
    assertMoney(amount);
    if (amount > this.balanceMinor) throw new InsufficientFundsError(this.id, this.balanceMinor, amount);
    this.balanceMinor -= amount;
  }

  credit(amount: Money): void {
    assertMoney(amount);
    this.balanceMinor += amount;
  }
}
